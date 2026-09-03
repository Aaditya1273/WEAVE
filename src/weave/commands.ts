// WEAVE addition (not upstream Revyme) — see src/weave/README.md.
//
// commands.ts — THE UNIFIED ACTION PIPELINE.
//
// Every authoring action in WEAVE — a WebMCP tool call from an external agent,
// a run from the developer Test Console, or an operation inside an applied
// ChangeSet — is expressed as a `WeaveOperation` and executed here. There is
// no second implementation anywhere: the tools are thin schema wrappers over
// this module, and this module drives the editor's own page-agent executors,
// which wrap `queueMutation` + `flushNow` — the exact path the human panels
// use. So a human drag and an agent move produce the same mutation, the same
// generated source, the same history entry and the same canvas render.
//
//   human panels ──► queueMutation ──► generators ──► ProjectFS ──► canvas
//                          ▲
//   WebMCP tool ──┐        │
//   ChangeSet   ──┼──► WeaveOperation ──► executeTool ──┘
//   Test console ─┘        (this file)
//
// Operations are pure data: they can be validated, previewed, described to a
// human, amended, skipped and replayed without being executed.

import { getDefaultStore } from 'jotai';
import { nodesAtom, selectedIdsAtom } from '@/code/stores/store';
import { executeTool } from '@/ai/page-agent/tool-executors';
import { flushNow, syncQueueCode, getCurrentCode } from '@/code/mutation/mutation-queue';
import { projectFS, projectVersionAtom } from '@/code/project/project-fs';
import { activeFilePathAtom } from '@/code/project/active-file-store';
import { dragStateOps } from '@/canvas/drag/drag-state-store';
import { insertSectionBlueprint } from '@/canvas/section-insert';
import { getSectionBlueprint } from '@/shared/sections-library';
import type { CanvasNode } from '@/code/parsing/parser';
import { trace } from '@/shared/debug-trace';

const store = getDefaultStore();

// ─── Operation model ────────────────────────────────────────────────────────

/** Semantic authoring operations. Product-level intent, not DOM surgery. */
export type WeaveOperation =
  | { op: 'update_text'; target: string; value: string }
  | { op: 'update_style'; target: string; styles: Record<string, string> }
  | { op: 'update_attrs'; target: string; attrs: Record<string, string> }
  | { op: 'rename'; target: string; name: string }
  | { op: 'set_visible'; target: string; visible: boolean }
  | { op: 'move'; target: string; parent?: string; index?: number }
  | { op: 'add_section'; sectionType: string; afterElementId?: string }
  | { op: 'delete'; target: string };

export type WeaveOperationKind = WeaveOperation['op'];

export const OPERATION_KINDS: WeaveOperationKind[] = [
  'update_text', 'update_style', 'update_attrs', 'rename',
  'set_visible', 'move', 'add_section', 'delete',
];

/** Operations that destroy content. Surfaced in proposals and tool hints. */
export const DESTRUCTIVE_KINDS = new Set<WeaveOperationKind>(['delete']);

export interface CommandError { code: string; message: string }
export type CommandResult =
  | { ok: true; detail: Record<string, unknown> }
  | { ok: false; error: CommandError };

const fail = (code: string, message: string): CommandResult => ({ ok: false, error: { code, message } });

// ─── Safety allow-lists ─────────────────────────────────────────────────────
// Enforced HERE, at the pipeline, so no caller (tool, changeset, console) can
// route around them. Visual and layout properties only: nothing that loads or
// executes code, and no positioning that could hide content off-canvas.

export const ALLOWED_STYLE_KEYS = new Set([
  'color', 'backgroundColor', 'background', 'backgroundImage', 'backgroundSize', 'backgroundPosition',
  'fontSize', 'fontWeight', 'fontFamily', 'lineHeight', 'letterSpacing', 'textAlign', 'textTransform',
  'display', 'flexDirection', 'alignItems', 'justifyContent', 'gap', 'flexWrap',
  'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'border', 'borderRadius', 'borderColor', 'borderWidth', 'boxShadow',
  'opacity', 'overflow', 'objectFit', 'aspectRatio', 'gridTemplateColumns',
]);

/** `url(...)` values are allowed to reference http(s) images only — never a
 *  `javascript:` or `data:text/html` payload smuggled through a style. */
const SAFE_URL = /^(https?:)?\/\//i;
function styleValueIsSafe(key: string, value: string): boolean {
  if (typeof value !== 'string') return false;
  if (/expression\s*\(|javascript:/i.test(value)) return false;
  const urls = value.match(/url\(\s*['"]?([^'")]+)/gi);
  if (urls && key !== 'backgroundImage' && key !== 'background') return false;
  if (urls) {
    for (const raw of urls) {
      const url = raw.replace(/^url\(\s*['"]?/i, '');
      if (!SAFE_URL.test(url)) return false;
    }
  }
  return true;
}

/** Tags that are genuinely navigable in this editor's dialect. */
export const LINK_TAGS = new Set(['a', 'Link', 'MotionLink']);

export const ALLOWED_ATTRS: Record<string, (v: string) => boolean> = {
  // Destinations must be a real page route or an absolute http(s) URL — never
  // a javascript:/data: URI, which is the classic injection route for an
  // agent-supplied string.
  href: (v) => /^(\/|#|https?:\/\/|mailto:|tel:)/i.test(v),
  src: (v) => /^(\/|https?:\/\/)/i.test(v),
  alt: () => true,
  title: () => true,
  target: (v) => v === '_blank' || v === '_self',
  rel: () => true,
  'aria-label': () => true,
};

// ─── Section vocabulary ─────────────────────────────────────────────────────
// section_type → oracle-validated blueprint. Humans insert the same set from
// the Insert panel, so both actors share one section vocabulary.

export const SECTION_TYPE_TO_BLUEPRINT: Record<string, string> = {
  header: 'header-editorial',
  hero: 'hero-editorial',
  features: 'features-grid',
  products: 'product-grid',
  testimonials: 'testimonials-cards',
  pricing: 'pricing-tiers',
  faq: 'faq-list',
  cta: 'cta-banner',
  contact: 'contact-panel',
  footer: 'footer-columns',
};
export const SECTION_TYPES = Object.keys(SECTION_TYPE_TO_BLUEPRINT);

// ─── Helpers ────────────────────────────────────────────────────────────────

export function getNode(id: unknown): CanvasNode | null {
  if (typeof id !== 'string' || !id) return null;
  return store.get(nodesAtom).get(id) ?? null;
}

/**
 * Bring the mutation queue's code reference up to the ACTIVE FILE before a
 * programmatic mutation. Between human gestures the queue's `currentCode` can
 * lag ProjectFS; an agent call would then apply its mutation to a stale base
 * and replace the page. Same rule `modifyProjectFile` uses: during a live drag
 * the queue is authoritative, otherwise flush and reseed from ProjectFS.
 */
export function syncQueueToActiveFile(): void {
  if (dragStateOps.get()) return;
  flushNow();
  const fresh = projectFS.readFile(store.get(activeFilePathAtom));
  if (fresh && fresh !== getCurrentCode()) syncQueueCode(fresh);
}

function viaExecutor(name: string, args: Record<string, unknown>): CommandResult {
  const { response, isError } = executeTool(name, args);
  if (isError) {
    const message = String(response.error ?? 'Mutation failed');
    const code = /No node with data-id/i.test(message) ? 'ELEMENT_NOT_FOUND' : 'MUTATION_FAILED';
    return fail(code, message);
  }
  return { ok: true, detail: response };
}

// ─── Validation ─────────────────────────────────────────────────────────────

/** Static + live validation of one operation. Returns null when it is
 *  applicable to the CURRENT project state. */
export function validateOperation(operation: WeaveOperation): CommandError | null {
  const op = operation as WeaveOperation & { target?: string };
  if (!operation || typeof operation !== 'object' || !('op' in operation)) {
    return { code: 'INVALID_OPERATION', message: 'Operation must be an object with an "op" field.' };
  }
  if (!OPERATION_KINDS.includes(operation.op)) {
    return { code: 'UNSUPPORTED_OPERATION', message: `Unsupported operation "${String(operation.op)}". Supported: ${OPERATION_KINDS.join(', ')}.` };
  }
  if (operation.op !== 'add_section') {
    if (typeof op.target !== 'string' || !op.target) {
      return { code: 'INVALID_OPERATION', message: `Operation "${operation.op}" requires a target element id.` };
    }
    if (!getNode(op.target)) {
      return { code: 'ELEMENT_NOT_FOUND', message: `Element "${op.target}" no longer exists on the current page.` };
    }
  }

  switch (operation.op) {
    case 'update_text':
      if (typeof operation.value !== 'string') {
        return { code: 'INVALID_OPERATION', message: 'update_text requires a string "value".' };
      }
      return null;
    case 'update_style': {
      const entries = Object.entries(operation.styles ?? {});
      if (entries.length === 0) return { code: 'INVALID_OPERATION', message: 'update_style requires at least one style property.' };
      for (const [k, v] of entries) {
        if (!ALLOWED_STYLE_KEYS.has(k)) return { code: 'UNSUPPORTED_STYLE', message: `Style property "${k}" is not editable through WEAVE tools.` };
        if (typeof v !== 'string' || !styleValueIsSafe(k, v)) return { code: 'UNSUPPORTED_STYLE', message: `Value for "${k}" is not an accepted CSS value.` };
      }
      return null;
    }
    case 'update_attrs': {
      const entries = Object.entries(operation.attrs ?? {});
      if (entries.length === 0) return { code: 'INVALID_OPERATION', message: 'update_attrs requires at least one attribute.' };
      const node = getNode(operation.target)!;
      for (const [k, v] of entries) {
        const check = ALLOWED_ATTRS[k];
        if (!check) return { code: 'UNSUPPORTED_ATTR', message: `Attribute "${k}" is not editable through WEAVE tools.` };
        if (typeof v !== 'string' || !check(v)) return { code: 'UNSUPPORTED_ATTR', message: `Value for "${k}" is not accepted (destinations must be a page route or an http(s) URL).` };
        if (k === 'href' && !LINK_TAGS.has(node.type)) {
          return {
            code: 'NOT_A_LINK',
            message: `"${node.name ?? operation.target}" is a <${node.type}>, not a link, so it cannot take an href. ` +
              'In this builder a navigating element must be a Next.js Link: a human turns an element into one ' +
              'with the Link tool, and an agent can then set its destination.',
          };
        }
      }
      return null;
    }
    case 'rename':
      if (typeof operation.name !== 'string' || !operation.name.trim()) {
        return { code: 'INVALID_OPERATION', message: 'rename requires a non-empty "name".' };
      }
      return null;
    case 'set_visible':
      if (typeof operation.visible !== 'boolean') {
        return { code: 'INVALID_OPERATION', message: 'set_visible requires a boolean "visible".' };
      }
      return null;
    case 'move': {
      const node = getNode(operation.target)!;
      const nodes = store.get(nodesAtom);
      if (operation.parent !== undefined) {
        if (!getNode(operation.parent)) return { code: 'ELEMENT_NOT_FOUND', message: `Element "${operation.parent}" no longer exists on the current page.` };
        if (operation.parent === operation.target) return { code: 'INVALID_MOVE', message: 'An element cannot become its own parent.' };
        let cursor: string | null | undefined = nodes.get(operation.parent)!.parentId;
        while (cursor) {
          if (cursor === operation.target) return { code: 'INVALID_MOVE', message: 'Cannot move an element into its own descendant.' };
          cursor = nodes.get(cursor)?.parentId;
        }
      } else if (typeof operation.index !== 'number') {
        return { code: 'INVALID_OPERATION', message: 'move requires "parent" and/or "index".' };
      } else if (!node.parentId || !nodes.has(node.parentId)) {
        return { code: 'INVALID_MOVE', message: 'This element has no parent to reorder within.' };
      }
      if (operation.index !== undefined && (typeof operation.index !== 'number' || !Number.isFinite(operation.index) || operation.index < 0)) {
        return { code: 'INVALID_OPERATION', message: '"index" must be a non-negative number.' };
      }
      return null;
    }
    case 'add_section': {
      const blueprint = SECTION_TYPE_TO_BLUEPRINT[operation.sectionType];
      if (!blueprint || !getSectionBlueprint(blueprint)) {
        return { code: 'UNSUPPORTED_SECTION', message: `No section blueprint for type "${String(operation.sectionType)}". Supported: ${SECTION_TYPES.join(', ')}.` };
      }
      if (operation.afterElementId !== undefined && !getNode(operation.afterElementId)) {
        return { code: 'ELEMENT_NOT_FOUND', message: `Element "${operation.afterElementId}" no longer exists on the current page.` };
      }
      return null;
    }
    case 'delete':
      return null;
  }
}

// ─── Description + before-state capture ─────────────────────────────────────

function label(id: string): string {
  const node = getNode(id);
  return node?.name || node?.type || id;
}

/** One-line human summary of an operation — what the proposal UI shows. */
export function describeOperation(operation: WeaveOperation): string {
  switch (operation.op) {
    case 'update_text': return `Set text of ${label(operation.target)}`;
    case 'update_style': return `Restyle ${label(operation.target)} (${Object.keys(operation.styles).join(', ')})`;
    case 'update_attrs': return `Set ${Object.keys(operation.attrs).join(', ')} on ${label(operation.target)}`;
    case 'rename': return `Rename ${label(operation.target)} to “${operation.name}”`;
    case 'set_visible': return `${operation.visible ? 'Show' : 'Hide'} ${label(operation.target)}`;
    case 'move': return operation.parent
      ? `Move ${label(operation.target)} into ${label(operation.parent)}`
      : `Reorder ${label(operation.target)} to position ${(operation.index ?? 0) + 1}`;
    case 'add_section': return `Add a ${operation.sectionType} section`;
    case 'delete': return `Delete ${label(operation.target)}`;
  }
}

/** The current value an operation would replace — shown as "before" in a
 *  proposal so the human sees the change, not just the intent. */
export function captureBefore(operation: WeaveOperation): unknown {
  const node = operation.op === 'add_section' ? null : getNode((operation as { target: string }).target);
  if (!node) return null;
  switch (operation.op) {
    case 'update_text': return node.textContent ?? '';
    case 'update_style': {
      const out: Record<string, string> = {};
      for (const k of Object.keys(operation.styles)) out[k] = node.styles?.[k] ?? '';
      return out;
    }
    case 'update_attrs': {
      const out: Record<string, string> = {};
      for (const k of Object.keys(operation.attrs)) out[k] = node.attrs?.[k] ?? '';
      return out;
    }
    case 'rename': return node.name ?? '';
    case 'set_visible': return node.styles?.display !== 'none';
    case 'move': {
      const nodes = store.get(nodesAtom);
      const parent = node.parentId && nodes.has(node.parentId) ? nodes.get(node.parentId)! : null;
      return { parent: parent?.id ?? null, index: parent ? parent.children.indexOf(node.id) : null };
    }
    case 'delete': return { id: node.id, tag: node.type, name: node.name ?? null, text: node.textContent ?? null };
    default: return null;
  }
}

/** The value an operation writes — the editable half of an amendable op. */
export function operationValue(operation: WeaveOperation): unknown {
  switch (operation.op) {
    case 'update_text': return operation.value;
    case 'rename': return operation.name;
    case 'update_style': return operation.styles;
    case 'update_attrs': return operation.attrs;
    case 'set_visible': return operation.visible;
    case 'move': return { parent: operation.parent ?? null, index: operation.index ?? null };
    case 'add_section': return { sectionType: operation.sectionType, afterElementId: operation.afterElementId ?? null };
    case 'delete': return null;
  }
}

/** Operations whose value a human can retype in the proposal UI. */
export function isTextEditable(operation: WeaveOperation): boolean {
  return operation.op === 'update_text' || operation.op === 'rename';
}

/** Apply a human amendment to a text-editable operation. */
export function amendOperationValue(operation: WeaveOperation, value: string): WeaveOperation {
  if (operation.op === 'update_text') return { ...operation, value };
  if (operation.op === 'rename') return { ...operation, name: value };
  return operation;
}

// ─── Execution ──────────────────────────────────────────────────────────────

/**
 * Execute ONE validated operation against the live project. Returns a
 * structured result; never throws. Callers that need atomicity across several
 * operations use `applyOperations`.
 */
export function executeOperation(operation: WeaveOperation): CommandResult {
  const invalid = validateOperation(operation);
  if (invalid) return { ok: false, error: invalid };
  syncQueueToActiveFile();
  trace.action('weave:command', { op: operation.op });

  switch (operation.op) {
    case 'update_text':
      return viaExecutor('update_node_text', { nodeId: operation.target, text: operation.value });
    case 'update_style':
      return viaExecutor('update_node_styles', { nodeId: operation.target, styles: operation.styles });
    case 'update_attrs':
      return viaExecutor('update_html_attrs', { nodeId: operation.target, attrs: operation.attrs });
    case 'rename':
      return viaExecutor('rename_node', { nodeId: operation.target, name: operation.name });
    case 'set_visible':
      // Empty string DELETES the property (upstream invariant #3), so showing
      // an element removes `display:none` rather than guessing a display value.
      return viaExecutor('update_node_styles', { nodeId: operation.target, styles: { display: operation.visible ? '' : 'none' } });
    case 'move': {
      if (operation.parent) {
        return viaExecutor('move_node', {
          nodeId: operation.target, newParentId: operation.parent,
          ...(typeof operation.index === 'number' ? { index: Math.max(0, Math.floor(operation.index)) } : {}),
        });
      }
      const parentId = getNode(operation.target)!.parentId!;
      return viaExecutor('reorder_node', { nodeId: operation.target, parentId, index: Math.max(0, Math.floor(operation.index!)) });
    }
    case 'delete': {
      const result = viaExecutor('remove_node', { nodeId: operation.target });
      if (result.ok) {
        store.set(selectedIdsAtom, store.get(selectedIdsAtom).filter((id) => id !== operation.target));
      }
      return result;
    }
    case 'add_section': {
      const blueprintId = SECTION_TYPE_TO_BLUEPRINT[operation.sectionType];
      const nodes = store.get(nodesAtom);
      let anchorId: string | null = operation.afterElementId ?? null;
      if (!anchorId) {
        const kids = (nodes.get('root')?.children ?? []).filter((c) => nodes.has(c));
        anchorId = kids.length > 0 ? kids[kids.length - 1] : null;
      }
      // Placement rides the paste rules: with a top-level section selected the
      // blueprint lands as its next sibling.
      const prevSelection = store.get(selectedIdsAtom);
      store.set(selectedIdsAtom, anchorId ? [anchorId] : []);
      syncQueueToActiveFile();
      const created = insertSectionBlueprint(blueprintId);
      flushNow();
      if (created.length === 0) {
        store.set(selectedIdsAtom, prevSelection);
        return fail('INSERT_FAILED', `Could not insert a "${operation.sectionType}" section.`);
      }
      // Select what was just created — the human immediately sees WHERE the
      // agent worked.
      store.set(selectedIdsAtom, created);
      return { ok: true, detail: { created } };
    }
  }
}

/**
 * Execute several operations as ONE atomic unit.
 *
 * The whole ProjectFS is snapshotted first; if any operation fails the
 * snapshot is restored, so a half-applied proposal can never reach the canvas.
 * On success the caller is responsible for the history entry — see
 * `changeset.ts`, which wraps this in a single undoable step.
 */
export function applyOperations(operations: WeaveOperation[]): {
  ok: boolean;
  results: CommandResult[];
  failedIndex?: number;
  error?: CommandError;
} {
  const snapshot = projectFS.getSnapshot();
  const results: CommandResult[] = [];
  for (let i = 0; i < operations.length; i++) {
    const result = executeOperation(operations[i]);
    results.push(result);
    if (!result.ok) {
      // ROLLBACK — restore every file, then re-seed the mutation queue from the
      // restored active file so the next write does not apply to the abandoned
      // intermediate state.
      projectFS.loadSnapshot(snapshot);
      const restored = projectFS.readFile(store.get(activeFilePathAtom));
      if (restored) syncQueueCode(restored);
      // Restoring FILES is not enough: `nodesAtom` memoises on the project
      // version, so without this bump the canvas and every subsequent
      // validation would still be reading the abandoned intermediate tree.
      store.set(projectVersionAtom, (v) => v + 1);
      trace.error('weave:changeset-rollback', { failedIndex: i, code: result.error.code });
      return { ok: false, results, failedIndex: i, error: result.error };
    }
  }
  return { ok: true, results };
}
