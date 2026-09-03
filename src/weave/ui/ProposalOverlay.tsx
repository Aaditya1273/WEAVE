// WEAVE addition (not upstream Revyme) — see src/weave/README.md.
//
// ProposalOverlay.tsx — where the human negotiates with the agent.
//
// A ChangeSet arrives as ONE proposal with several operations. This surface
// shows, per operation, what the agent intends, what the value is now, and
// what it would become; lets the human retype editable values or skip
// individual operations; and applies only what they accepted, atomically.
// The three states the brief asks for are literally the three columns of each
// row: AGENT INTENT · WHAT YOU CHANGED · WHAT WILL BE APPLIED.

import { useEffect, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useSetAtom } from 'jotai';
import { selectedIdsAtom } from '@/code/stores/store';
import Button from '@/design-system/Button';
import { trace } from '@/shared/debug-trace';
import {
  activeChangesetIdAtom, changesetsAtom, amendOperation, toggleOperationSkip,
  applyChangeSet, rejectChangeSet, type ChangeSet, type ChangeSetOperation,
} from '../changeset';
import { currentRevision } from '../revision';
import { logHumanActivity } from '../webmcp/registry';

function valueText(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value || '(empty)';
  if (typeof value === 'boolean') return value ? 'visible' : 'hidden';
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '—';
    return entries.map(([k, v]) => `${k}: ${v === null ? '—' : String(v)}`).join(', ');
  }
  return String(value);
}

const KIND_LABEL: Record<string, string> = {
  update_text: 'Text', update_style: 'Style', update_attrs: 'Attributes',
  rename: 'Name', set_visible: 'Visibility', move: 'Order',
  add_section: 'New section', delete: 'Delete',
};

function OperationRow({
  changesetId, operation, locked,
}: { changesetId: string; operation: ChangeSetOperation; locked: boolean }) {
  const [draft, setDraft] = useState(typeof operation.after === 'string' ? operation.after : '');
  const setSelected = useSetAtom(selectedIdsAtom);
  useEffect(() => {
    if (typeof operation.after === 'string') setDraft(operation.after);
  }, [operation.after]);

  const target = (operation.operation as { target?: string }).target;
  const isDelete = operation.operation.op === 'delete';

  return (
    <div
      className="flex flex-col gap-2 py-3 border-t border-[var(--border-light)] first:border-t-0"
      style={{ opacity: operation.skipped ? 0.45 : 1 }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="shrink-0 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider cut-corners"
            style={{
              backgroundColor: isDelete ? 'rgba(239,68,68,0.14)' : 'var(--bg-hover)',
              color: isDelete ? '#ef4444' : 'var(--text-secondary)',
            }}
          >
            {KIND_LABEL[operation.operation.op] ?? operation.operation.op}
          </span>
          <span className="text-[12px] text-[var(--text-primary)] truncate">{operation.description}</span>
          {operation.amended && (
            <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>
              edited by you
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {target && (
            <button
              onClick={() => { setSelected([target]); trace.action('weave:proposal-locate', { target }); }}
              className="px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cut-corners transition-colors"
              title={`Select ${target} on the canvas`}
            >
              Show me
            </button>
          )}
          {!locked && (
            <button
              onClick={() => toggleOperationSkip(changesetId, operation.id)}
              aria-pressed={operation.skipped}
              className="px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cut-corners transition-colors"
            >
              {operation.skipped ? 'Include' : 'Skip'}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-[1fr_1fr] gap-3 pl-1">
        <div className="min-w-0">
          <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Now</div>
          <div className="text-[11px] leading-snug text-[var(--text-secondary)] break-words line-through decoration-[var(--text-secondary)]/40">
            {valueText(operation.before)}
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">
            {operation.editable && !locked ? 'Will become (editable)' : 'Will become'}
          </div>
          {operation.editable && !locked ? (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => { if (draft !== operation.after) amendOperation(changesetId, operation.id, draft); }}
              rows={2}
              aria-label={`Edit value for ${operation.description}`}
              className="w-full px-1.5 py-1 text-[11px] leading-snug cut-corners bg-[var(--bg-hover)] text-[var(--text-primary)] border border-[var(--border-light)] outline-none focus:border-[var(--accent)] resize-y"
            />
          ) : (
            <div className="text-[11px] leading-snug text-[var(--text-primary)] break-words">{valueText(operation.after)}</div>
          )}
        </div>
      </div>

      {operation.error && (
        <div className="text-[10px] text-red-400 pl-1">{operation.error.code}: {operation.error.message}</div>
      )}
    </div>
  );
}

function ProposalBody({ changeset, onClose }: { changeset: ChangeSet; onClose: () => void }) {
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = changeset.status !== 'proposed' && changeset.status !== 'amended';
  const accepted = changeset.operations.filter((o) => !o.skipped).length;
  const stale = changeset.status === 'stale';

  return (
    <div className="flex flex-col max-h-[78vh]">
      <div className="px-5 pt-4 pb-3 border-b border-[var(--border-light)] shrink-0">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider cut-corners"
            style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 16%, transparent)', color: 'var(--accent)' }}>
            Agent proposal
          </span>
          <span className="text-[10px] text-[var(--text-secondary)] tabular-nums">
            based on revision {changeset.baseRevision} · now {currentRevision()}
          </span>
        </div>
        <h2 className="text-[16px] font-semibold tracking-tight text-[var(--text-primary)] m-0">{changeset.summary}</h2>
        <p className="text-[11px] leading-relaxed text-[var(--text-secondary)] m-0 mt-1.5">
          {stale
            ? 'The page changed after this proposal was made, so it can no longer be applied safely. Ask the agent to re-read the context and propose again.'
            : `${changeset.operations.length} operations. Edit any value, skip what you do not want, then apply. Accepted operations commit together as one undoable change — nothing has changed yet.`}
        </p>
      </div>

      {stale && (
        <div className="mx-5 mt-3 px-3 py-2 cut-corners text-[11px] leading-relaxed shrink-0"
          style={{ backgroundColor: 'rgba(239,68,68,0.10)', color: '#f87171' }}>
          <strong className="font-semibold">Stale proposal.</strong> {changeset.reason}
        </div>
      )}

      <div className="px-5 overflow-y-auto flex-1 min-h-0">
        {changeset.operations.map((operation) => (
          <OperationRow key={operation.id} changesetId={changeset.id} operation={operation} locked={locked || stale} />
        ))}
      </div>

      {error && <div className="px-5 pt-2 text-[11px] text-red-400 shrink-0">{error}</div>}

      <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-[var(--border-light)] shrink-0">
        <span className="text-[11px] text-[var(--text-secondary)]">
          {stale ? 'Cannot be applied' : `${accepted} of ${changeset.operations.length} will be applied`}
          {changeset.amendedByHuman && !stale && ' · amended by you'}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary" size="sm" className="cut-corners"
            onClick={() => {
              rejectChangeSet(changeset.id);
              logHumanActivity('changeset', `Rejected proposal “${changeset.summary}”`);
              onClose();
            }}
          >
            {stale ? 'Dismiss' : 'Reject'}
          </Button>
          <Button
            variant="primary" size="sm" className="cut-corners"
            disabled={applying || locked || stale || accepted === 0}
            onClick={() => {
              setApplying(true);
              setError(null);
              const result = applyChangeSet(changeset.id);
              setApplying(false);
              if (!result.ok) { setError(`${result.error?.code}: ${result.error?.message}`); return; }
              logHumanActivity(
                'changeset',
                `Applied “${changeset.summary}” — ${accepted} operation(s)${changeset.amendedByHuman ? ', amended' : ''}`,
                { revision: result.changeset?.appliedRevision },
              );
              onClose();
            }}
          >
            {applying ? 'Applying…' : `Apply ${accepted} change${accepted === 1 ? '' : 's'}`}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function ProposalOverlay() {
  const [activeId, setActiveId] = useAtom(activeChangesetIdAtom);
  const changesets = useAtomValue(changesetsAtom);
  const changeset = changesets.find((c) => c.id === activeId) ?? null;

  useEffect(() => {
    if (!changeset) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setActiveId(null); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [changeset, setActiveId]);

  return createPortal(
    <AnimatePresence>
      {changeset && (
        <div data-modal-root className="fixed inset-0 flex items-center justify-center" style={{ zIndex: 100010 }}>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            className="absolute inset-0 bg-black/50"
            onClick={() => setActiveId(null)}
          />
          <motion.div
            role="dialog" aria-modal="true" aria-label={`Agent proposal: ${changeset.summary}`}
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ type: 'spring', bounce: 0.16, duration: 0.3 }}
            className="relative cut-corners cut-lg border border-[var(--border-light)] bg-[var(--bg-surface)] shadow-2xl"
            style={{ width: 620, maxWidth: 'calc(100vw - 48px)' }}
          >
            <ProposalBody changeset={changeset} onClose={() => setActiveId(null)} />
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
