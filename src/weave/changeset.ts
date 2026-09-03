// WEAVE addition (not upstream Revyme) — see src/weave/README.md.
//
// changeset.ts — ChangeSets: multi-operation proposals a human negotiates.
//
// An agent asked to "make this homepage feel more premium" should not fire six
// unrelated mutations at the canvas one at a time. It submits ONE proposal —
// a typed ChangeSet pinned to the project revision it was reasoning about —
// and the human inspects it, edits individual values, skips operations it
// dislikes, and applies the rest. The accepted operations then commit
// ATOMICALLY (all or nothing, one undo step) as a new revision.
//
//   agent intent → ChangeSet(proposed) → human amends/skips → apply
//        → atomic commit → receipt → one undoable revision
//
// Concurrency is explicit. A ChangeSet carries `baseRevision`; if the human
// edits the page in the meantime the project moves to a new revision and the
// proposal is marked STALE rather than applied against state the agent never
// saw. Staleness is a first-class outcome with a real UI, not a crash.

import { atom, getDefaultStore } from 'jotai';
import { trace } from '@/shared/debug-trace';
import {
  sealPendingHistory, pushHistoryImmediate,
} from '@/code/mutation/history';
import {
  applyOperations, validateOperation, describeOperation, captureBefore,
  amendOperationValue, isTextEditable, operationValue,
  type WeaveOperation, type CommandError,
} from './commands';
import { currentRevision, settleRevision, bumpRevision, onRevision } from './revision';
import { leftPanelAtom } from '@/code/stores/left-panel-store';

const store = getDefaultStore();

// ─── Model ──────────────────────────────────────────────────────────────────

/**
 * Lifecycle:
 *   proposed ─┬─► amended ─┬─► applied
 *             │            ├─► rejected
 *             ├────────────┴─► stale     (project moved underneath it)
 *             └─► rejected
 */
export type ChangeSetStatus = 'proposed' | 'amended' | 'applied' | 'rejected' | 'stale';

export interface ChangeSetOperation {
  id: string;
  operation: WeaveOperation;
  /** One-line human summary, recomputed on amendment. */
  description: string;
  /** The value this operation replaces, captured when the proposal was made. */
  before: unknown;
  /** The value it writes (what the human sees and may edit). */
  after: unknown;
  /** Human excluded this operation from the commit. */
  skipped: boolean;
  /** Human edited this operation's value. */
  amended: boolean;
  /** What the agent originally proposed, retained once amended. */
  original?: WeaveOperation;
  /** Whether the human can retype this operation's value in the proposal UI. */
  editable: boolean;
  /** Post-apply outcome. */
  outcome?: 'applied' | 'skipped' | 'failed';
  error?: CommandError;
}

export interface ChangeSet {
  id: string;
  /** The project revision this proposal was reasoning about. */
  baseRevision: number;
  createdAt: number;
  /** Where the proposal came from — never fabricated. */
  source: 'agent' | 'console';
  summary: string;
  operations: ChangeSetOperation[];
  status: ChangeSetStatus;
  /** True once the human edited or skipped anything — surfaced in the receipt. */
  amendedByHuman: boolean;
  /** Revision created by the commit. */
  appliedRevision?: number;
  /** Why it was rejected or went stale. */
  reason?: string;
}

// ─── Store ──────────────────────────────────────────────────────────────────

const MAX_CHANGESETS = 20;
export const changesetsAtom = atom<ChangeSet[]>([]);

/** The proposal the panel is showing. Null when nothing needs review. */
export const activeChangesetIdAtom = atom<string | null>(null);

let nextId = 1;
const newId = (prefix: string) => `${prefix}_${nextId++}`;

export function getChangeSet(id: string): ChangeSet | null {
  return store.get(changesetsAtom).find((c) => c.id === id) ?? null;
}

/** Proposals still awaiting a human decision. */
export function pendingChangeSets(): ChangeSet[] {
  return store.get(changesetsAtom).filter((c) => c.status === 'proposed' || c.status === 'amended');
}

function update(id: string, patch: (cs: ChangeSet) => ChangeSet): ChangeSet | null {
  let next: ChangeSet | null = null;
  store.set(changesetsAtom, store.get(changesetsAtom).map((cs) => {
    if (cs.id !== id) return cs;
    next = patch(cs);
    return next;
  }));
  return next;
}

// ─── Serialization for tools ────────────────────────────────────────────────

/** Bounded, agent-facing view of a ChangeSet. */
export function serializeChangeSet(cs: ChangeSet): Record<string, unknown> {
  return {
    id: cs.id,
    status: cs.status,
    summary: cs.summary,
    baseRevision: cs.baseRevision,
    appliedRevision: cs.appliedRevision,
    amendedByHuman: cs.amendedByHuman,
    reason: cs.reason,
    operations: cs.operations.map((o) => ({
      id: o.id,
      op: o.operation.op,
      description: o.description,
      before: o.before,
      after: o.after,
      skipped: o.skipped,
      amended: o.amended,
      outcome: o.outcome,
      error: o.error,
    })),
  };
}

// ─── Propose ────────────────────────────────────────────────────────────────

export interface ProposeResult {
  ok: boolean;
  changeset?: ChangeSet;
  error?: CommandError;
}

/**
 * Create a proposal. Every operation is validated against the CURRENT project
 * before the proposal is accepted, so a human never reviews a proposal that
 * could not possibly apply. Nothing is written to the project here.
 */
export function proposeChangeSet(input: {
  summary: string;
  operations: WeaveOperation[];
  source: 'agent' | 'console';
}): ProposeResult {
  const operations = input.operations ?? [];
  if (!Array.isArray(operations) || operations.length === 0) {
    return { ok: false, error: { code: 'EMPTY_CHANGESET', message: 'A proposal needs at least one operation.' } };
  }
  if (operations.length > 25) {
    return { ok: false, error: { code: 'CHANGESET_TOO_LARGE', message: 'A proposal may contain at most 25 operations.' } };
  }
  if (typeof input.summary !== 'string' || !input.summary.trim()) {
    return { ok: false, error: { code: 'INVALID_ARGS', message: 'A proposal needs a one-line "summary" describing the intent.' } };
  }

  for (let i = 0; i < operations.length; i++) {
    const invalid = validateOperation(operations[i]);
    if (invalid) {
      return { ok: false, error: { code: invalid.code, message: `Operation ${i + 1} (${String(operations[i]?.op ?? 'unknown')}): ${invalid.message}` } };
    }
  }

  const baseRevision = settleRevision();
  const cs: ChangeSet = {
    id: newId('cs'),
    baseRevision,
    createdAt: Date.now(),
    source: input.source,
    summary: input.summary.trim(),
    status: 'proposed',
    amendedByHuman: false,
    operations: operations.map((operation) => ({
      id: newId('op'),
      operation,
      description: describeOperation(operation),
      before: captureBefore(operation),
      after: operationValue(operation),
      skipped: false,
      amended: false,
      editable: isTextEditable(operation),
    })),
  };

  const list = [...store.get(changesetsAtom), cs];
  store.set(changesetsAtom, list.length > MAX_CHANGESETS ? list.slice(list.length - MAX_CHANGESETS) : list);
  // Surface the proposal where the human will see it — but do NOT throw a
  // modal over whatever they are doing. An agent proposing mid-gesture must
  // not steal the canvas; the panel card is impossible to miss and the human
  // opens the review when they are ready.
  store.set(leftPanelAtom, 'agent');
  trace.action('weave:changeset-proposed', { id: cs.id, ops: cs.operations.length, baseRevision });
  return { ok: true, changeset: cs };
}

// ─── Human negotiation ──────────────────────────────────────────────────────

/** Human retypes an operation's value. Keeps the agent's original for the receipt. */
export function amendOperation(changesetId: string, operationId: string, value: string): ChangeSet | null {
  const cs = getChangeSet(changesetId);
  if (!cs || (cs.status !== 'proposed' && cs.status !== 'amended')) return null;
  const next = update(changesetId, (c) => ({
    ...c,
    status: 'amended',
    amendedByHuman: true,
    operations: c.operations.map((o) => {
      if (o.id !== operationId || !o.editable) return o;
      const amended = amendOperationValue(o.operation, value);
      return {
        ...o,
        original: o.original ?? o.operation,
        operation: amended,
        description: describeOperation(amended),
        after: operationValue(amended),
        amended: true,
      };
    }),
  }));
  trace.action('weave:changeset-amended', { id: changesetId, operationId });
  return next;
}

/** Human includes/excludes one operation from the commit. */
export function toggleOperationSkip(changesetId: string, operationId: string): ChangeSet | null {
  const cs = getChangeSet(changesetId);
  if (!cs || (cs.status !== 'proposed' && cs.status !== 'amended')) return null;
  const next = update(changesetId, (c) => ({
    ...c,
    status: 'amended',
    amendedByHuman: true,
    operations: c.operations.map((o) => (o.id === operationId ? { ...o, skipped: !o.skipped } : o)),
  }));
  trace.action('weave:changeset-skip-toggle', { id: changesetId, operationId });
  return next;
}

export function rejectChangeSet(changesetId: string, reason = 'Rejected by the human reviewer'): ChangeSet | null {
  const cs = getChangeSet(changesetId);
  if (!cs || cs.status === 'applied') return null;
  const next = update(changesetId, (c) => ({ ...c, status: 'rejected', reason }));
  if (store.get(activeChangesetIdAtom) === changesetId) store.set(activeChangesetIdAtom, null);
  trace.action('weave:changeset-rejected', { id: changesetId });
  return next;
}

// ─── Apply ──────────────────────────────────────────────────────────────────

export interface ApplyResult {
  ok: boolean;
  changeset?: ChangeSet;
  error?: CommandError;
}

/**
 * Commit the accepted operations of a ChangeSet, atomically.
 *
 * Refuses when the project has moved since the proposal was made (STALE), and
 * revalidates every operation against live state first. The whole commit is
 * ONE history entry, so a human undo reverses the entire agent transaction —
 * never half of it.
 */
export function applyChangeSet(changesetId: string): ApplyResult {
  const cs = getChangeSet(changesetId);
  if (!cs) return { ok: false, error: { code: 'CHANGESET_NOT_FOUND', message: `No proposal with id "${changesetId}".` } };
  if (cs.status === 'applied') return { ok: false, error: { code: 'CHANGESET_ALREADY_APPLIED', message: 'This proposal has already been applied.' } };
  if (cs.status === 'rejected') return { ok: false, error: { code: 'CHANGESET_REJECTED', message: 'This proposal was rejected.' } };

  const revision = settleRevision();
  if (revision !== cs.baseRevision) {
    const reason = `This proposal was created against revision ${cs.baseRevision}, but the page is now revision ${revision}. Ask the agent for fresh context and a new proposal.`;
    update(changesetId, (c) => ({ ...c, status: 'stale', reason }));
    trace.error('weave:changeset-stale', { id: changesetId, baseRevision: cs.baseRevision, revision });
    return { ok: false, error: { code: 'CHANGESET_STALE', message: reason } };
  }

  const accepted = cs.operations.filter((o) => !o.skipped);
  if (accepted.length === 0) {
    return { ok: false, error: { code: 'CHANGESET_EMPTY', message: 'Every operation in this proposal is skipped — nothing to apply.' } };
  }

  // Revalidate against LIVE state: the pin above proves the project has not
  // moved, but an operation can still be invalid (e.g. the agent proposed a
  // move whose target it had already proposed deleting).
  for (const op of accepted) {
    const invalid = validateOperation(op.operation);
    if (invalid) {
      update(changesetId, (c) => ({
        ...c,
        operations: c.operations.map((o) => (o.id === op.id ? { ...o, outcome: 'failed', error: invalid } : o)),
      }));
      return { ok: false, error: invalid };
    }
  }

  // Checkpoint FIRST, so the agent transaction below is exactly one additional
  // undo step and any human edit made since the last checkpoint stays its own.
  // `sealPendingHistory` commits a pending debounced group; the immediate push
  // then catches anything not yet pushed at all (it no-ops when there are no
  // diffs). Without the second call, an un-pushed human edit would be folded
  // into the agent's entry and a single undo would revert the human's work too.
  sealPendingHistory();
  pushHistoryImmediate('');

  const result = applyOperations(accepted.map((o) => o.operation));
  if (!result.ok) {
    const failed = accepted[result.failedIndex ?? 0];
    update(changesetId, (c) => ({
      ...c,
      operations: c.operations.map((o) => (o.id === failed?.id ? { ...o, outcome: 'failed', error: result.error } : o)),
    }));
    trace.error('weave:changeset-apply-failed', { id: changesetId, code: result.error?.code });
    return { ok: false, error: result.error };
  }

  // ONE undo step for the whole transaction.
  pushHistoryImmediate('');
  bumpRevision('agent');
  const appliedRevision = settleRevision();

  const next = update(changesetId, (c) => ({
    ...c,
    status: 'applied',
    appliedRevision,
    operations: c.operations.map((o) => ({ ...o, outcome: o.skipped ? 'skipped' as const : 'applied' as const })),
  }));
  if (store.get(activeChangesetIdAtom) === changesetId) store.set(activeChangesetIdAtom, null);
  trace.action('weave:changeset-applied', {
    id: changesetId, applied: accepted.length,
    skipped: cs.operations.length - accepted.length, revision: appliedRevision,
  });
  return { ok: true, changeset: next ?? undefined };
}

// ─── Staleness watch ────────────────────────────────────────────────────────

let watching = false;

/** Mark every open proposal stale as soon as the project moves under it. */
export function watchChangeSetStaleness(): void {
  if (watching) return;
  watching = true;
  onRevision((revision) => {
    const open = store.get(changesetsAtom).filter(
      (c) => (c.status === 'proposed' || c.status === 'amended') && c.baseRevision !== revision,
    );
    if (open.length === 0) return;
    for (const cs of open) {
      update(cs.id, (c) => ({
        ...c,
        status: 'stale',
        reason: `The page changed to revision ${revision} after this proposal was made against revision ${c.baseRevision}.`,
      }));
      trace.action('weave:changeset-went-stale', { id: cs.id, revision });
    }
  });
}

/** Test seam. */
export function resetChangeSetsForTest(): void {
  store.set(changesetsAtom, []);
  store.set(activeChangesetIdAtom, null);
}

export { currentRevision };
