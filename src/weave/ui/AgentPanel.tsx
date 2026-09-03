// WEAVE addition (not upstream Revyme) — see src/weave/README.md.
//
// AgentPanel.tsx — the human's window onto the agent.
//
// An observability and control surface for the real WebMCP integration, not a
// chat. It shows how tools are exposed right now, the shared context an agent
// reads, proposals waiting for a decision, the publish gate, an explainable
// agent-readiness score, and a timeline of what actually happened — each entry
// labelled with its true source and clickable to select the element it
// touched. When no WebMCP runtime is present it says so plainly.

import { useCallback, useMemo, useState } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { nodesAtom, selectedIdsAtom } from '@/code/stores/store';
import { activeFilePathAtom } from '@/code/project/active-file-store';
import Button from '@/design-system/Button';
import { trace } from '@/shared/debug-trace';
import {
  webMcpStatusAtom, weaveActivityAtom, pendingPublishAtom, lastValidationAtom,
  inspectorOpenAtom, type WeaveActivityEntry,
} from '../store';
import { approvePublish, cancelPublish } from '../publish';
import { executeWeaveTool, applicableTools, getWeaveTools, logHumanActivity, type WeaveToolResult } from '../webmcp/registry';
import { pageFileToRoute } from '../context';
import { revisionAtom } from '../revision';
import { changesetsAtom, activeChangesetIdAtom, type ChangeSet } from '../changeset';
import { validateSite } from '../validate';

// ─── Small parts ────────────────────────────────────────────────────────────

function StatusChip({ native }: { native: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 cut-corners text-[10px] font-semibold tracking-wide"
      style={{
        backgroundColor: native ? 'color-mix(in srgb, #10B981 18%, transparent)' : 'var(--bg-hover)',
        color: native ? '#10B981' : 'var(--text-secondary)',
      }}
    >
      <span aria-hidden className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: native ? '#10B981' : 'var(--text-secondary)' }} />
      {native ? 'WebMCP connected' : 'No WebMCP runtime'}
    </span>
  );
}

function SectionHeading({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-1.5">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] m-0">{children}</h3>
      {action}
    </div>
  );
}

function timeAgo(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

const SOURCE_LABEL: Record<WeaveActivityEntry['source'], string> = {
  agent: 'agent', console: 'console', human: 'you',
};

// ─── Readiness ──────────────────────────────────────────────────────────────

function ReadinessCard() {
  const [report, setReport] = useAtom(lastValidationAtom);
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const setSelected = useSetAtom(selectedIdsAtom);

  const run = useCallback(() => {
    setRunning(true);
    const next = validateSite();
    setReport(next);
    setRunning(false);
    setOpen(true);
    logHumanActivity('weave_validate_site', `Checked agent readiness — ${next.score}%, ${next.issues.length} finding(s)`, { kind: 'read' });
  }, [setReport]);

  if (!report) {
    return (
      <div className="flex flex-col gap-1.5">
        <SectionHeading>Agent readiness</SectionHeading>
        <p className="text-[10px] leading-relaxed text-[var(--text-secondary)] m-0">
          Score how legible this site is to an agent: labels, link destinations, section
          semantics and metadata.
        </p>
        <Button variant="secondary" size="sm" className="cut-corners" onClick={run} disabled={running}>
          {running ? 'Checking…' : 'Check readiness'}
        </Button>
      </div>
    );
  }

  const tone = report.score >= 90 ? '#10B981' : report.score >= 70 ? 'var(--accent)' : '#f59e0b';
  return (
    <div className="flex flex-col gap-1.5">
      <SectionHeading action={
        <button onClick={run} className="text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
          Recheck
        </button>
      }>Agent readiness</SectionHeading>

      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-baseline gap-2 text-left hover:opacity-80 transition-opacity"
      >
        <span className="text-[28px] font-semibold leading-none tabular-nums" style={{ color: tone }}>{report.score}</span>
        <span className="text-[12px] text-[var(--text-secondary)]">/ 100</span>
        <span className="ml-auto text-[10px] text-[var(--text-secondary)]">{open ? 'Hide checks' : 'Show checks'}</span>
      </button>

      <div className="h-1 w-full cut-corners" style={{ backgroundColor: 'var(--bg-hover)' }}>
        <div className="h-full transition-[width] duration-300" style={{ width: `${report.score}%`, backgroundColor: tone }} />
      </div>

      {open && (
        <div className="flex flex-col gap-1 mt-1">
          {report.checks.map((check) => (
            <div key={check.id} className="flex items-start gap-1.5">
              <span aria-hidden className="text-[10px] leading-4 shrink-0" style={{ color: check.passed ? '#10B981' : '#f59e0b' }}>
                {check.passed ? '✓' : '!'}
              </span>
              <span className="flex-1 min-w-0">
                <span className="text-[10px] text-[var(--text-primary)]">{check.label}</span>
                <span className="block text-[9px] leading-snug text-[var(--text-secondary)]">{check.detail}</span>
              </span>
              <span className="text-[9px] tabular-nums text-[var(--text-secondary)] shrink-0">{check.earned}/{check.weight}</span>
            </div>
          ))}
          {report.issues.length > 0 && (
            <div className="mt-1.5 pt-1.5 border-t border-[var(--border-light)] flex flex-col gap-1">
              {report.issues.slice(0, 6).map((issue, i) => (
                <button
                  key={i}
                  onClick={() => { if (issue.target) setSelected([issue.target]); }}
                  disabled={!issue.target}
                  className="text-left text-[9px] leading-snug text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:hover:text-[var(--text-secondary)] transition-colors"
                >
                  <span style={{ color: issue.severity === 'warning' ? '#f59e0b' : 'var(--text-secondary)' }}>
                    {issue.severity === 'warning' ? '⚠' : 'ⓘ'}
                  </span>{' '}{issue.message}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Proposal summary ───────────────────────────────────────────────────────

function ProposalCard({ changeset }: { changeset: ChangeSet }) {
  const setActive = useSetAtom(activeChangesetIdAtom);
  const stale = changeset.status === 'stale';
  return (
    <div
      className="flex flex-col gap-2 p-2.5 cut-corners border"
      style={{
        borderColor: stale ? '#ef4444' : 'var(--accent)',
        backgroundColor: stale ? 'rgba(239,68,68,0.07)' : 'color-mix(in srgb, var(--accent) 8%, transparent)',
      }}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] font-semibold text-[var(--text-primary)]">
          {stale ? 'Proposal went stale' : 'Agent proposed changes'}
        </span>
      </div>
      <p className="text-[10px] leading-relaxed text-[var(--text-primary)] m-0">“{changeset.summary}”</p>
      <p className="text-[10px] leading-relaxed text-[var(--text-secondary)] m-0">
        {stale
          ? `Built on revision ${changeset.baseRevision}; the page has moved on. Ask the agent to re-read context.`
          : `${changeset.operations.length} operations, based on revision ${changeset.baseRevision}. Nothing has changed yet.`}
      </p>
      <Button variant={stale ? 'secondary' : 'primary'} size="sm" className="cut-corners" onClick={() => setActive(changeset.id)}>
        {stale ? 'Review and dismiss' : 'Review proposal'}
      </Button>
    </div>
  );
}

// ─── Test console ───────────────────────────────────────────────────────────

const CONSOLE_PRESETS: Record<string, string> = {
  weave_get_context: '{}',
  weave_get_selection: '{}',
  weave_add_section: '{ "section_type": "testimonials" }',
  weave_update_element: '{ "text": "Objects for slow rooms" }',
  weave_move_element: '{ "index": 0 }',
  weave_delete_element: '{ "element_id": "" }',
  weave_validate_site: '{}',
  weave_publish_site: '{ "note": "The site looks ready — ship it?" }',
  weave_propose_changes: JSON.stringify({
    summary: 'Make the homepage feel more premium',
    operations: [
      { op: 'update_text', target: 'hfr-title', value: 'Objects for slow rooms' },
      { op: 'update_text', target: 'hfr-lead', value: 'Hand-thrown stoneware, made to outlast us.' },
      { op: 'add_section', sectionType: 'testimonials' },
    ],
  }, null, 2),
};

function TestConsole() {
  const tools = useMemo(() => getWeaveTools(), []);
  const [tool, setTool] = useState('weave_propose_changes');
  const [args, setArgs] = useState(CONSOLE_PRESETS.weave_propose_changes);
  const [output, setOutput] = useState('');
  const [running, setRunning] = useState(false);
  const revision = useAtomValue(revisionAtom);

  const run = async () => {
    if (running) return;
    let parsed: unknown;
    try {
      parsed = args.trim() ? JSON.parse(args) : {};
    } catch {
      setOutput(JSON.stringify({ ok: false, error: { code: 'INVALID_ARGS', message: 'Arguments are not valid JSON.' } }, null, 2));
      return;
    }
    setRunning(true);
    trace.action('weave:console-run', { tool });
    try {
      const result: WeaveToolResult = await executeWeaveTool(tool, parsed, 'console');
      setOutput(JSON.stringify(result, null, 2));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="sr-only" htmlFor="weave-console-tool">Tool to run</label>
      <select
        id="weave-console-tool"
        value={tool}
        onChange={(e) => { setTool(e.target.value); setArgs(CONSOLE_PRESETS[e.target.value] ?? '{}'); setOutput(''); }}
        className="w-full h-7 px-1.5 text-[11px] cut-corners bg-[var(--bg-hover)] text-[var(--text-primary)] border border-[var(--border-light)] outline-none"
      >
        {tools.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
      </select>
      <label className="sr-only" htmlFor="weave-console-args">Tool arguments as JSON</label>
      <textarea
        id="weave-console-args"
        value={args} onChange={(e) => setArgs(e.target.value)} rows={4} spellCheck={false}
        className="w-full px-1.5 py-1 text-[10px] font-mono cut-corners bg-[var(--bg-hover)] text-[var(--text-primary)] border border-[var(--border-light)] outline-none resize-y"
      />
      <Button variant="primary" size="sm" className="cut-corners" onClick={() => void run()} disabled={running}>
        {running ? 'Running…' : 'Run tool'}
      </Button>
      {output && (
        <>
          <div className="text-[9px] text-[var(--text-secondary)] tabular-nums">revision {revision}</div>
          <pre className="max-h-56 overflow-auto px-1.5 py-1 text-[9px] leading-relaxed font-mono cut-corners bg-[var(--bg-hover)] text-[var(--text-secondary)] whitespace-pre-wrap break-all m-0">
            {output}
          </pre>
        </>
      )}
    </div>
  );
}

// ─── Panel ──────────────────────────────────────────────────────────────────

export default function AgentPanel() {
  const status = useAtomValue(webMcpStatusAtom);
  const activity = useAtomValue(weaveActivityAtom);
  const pendingPublish = useAtomValue(pendingPublishAtom);
  const revision = useAtomValue(revisionAtom);
  const [selection, setSelection] = useAtom(selectedIdsAtom);
  const nodes = useAtomValue(nodesAtom);
  const activeFile = useAtomValue(activeFilePathAtom);
  const changesets = useAtomValue(changesetsAtom);
  const setInspectorOpen = useSetAtom(inspectorOpenAtom);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [approving, setApproving] = useState(false);

  const native = status === 'native';
  const exposed = applicableTools();
  const allTools = getWeaveTools();
  const hidden = allTools.length - exposed.length;
  const sectionCount = nodes.get('root')?.children.length ?? 0;
  const openProposals = changesets.filter((c) => c.status === 'proposed' || c.status === 'amended' || c.status === 'stale');
  const selectionLabel = selection.length === 0
    ? 'none'
    : selection.length === 1
      ? (nodes.get(selection[0])?.name || selection[0])
      : `${selection.length} elements`;

  trace.fn('AgentPanel.render', { status, activity: activity.length, proposals: openProposals.length });

  return (
    <div className="flex h-full flex-col overflow-y-auto px-3 pt-3 pb-4 gap-4 text-[var(--text-primary)]">
      {/* Identity + connection state */}
      <header className="flex flex-col gap-1.5 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-semibold tracking-tight">WEAVE Agent</span>
          <StatusChip native={native} />
        </div>
        <p className="text-[10px] leading-relaxed text-[var(--text-secondary)] m-0">
          {native
            ? 'An external agent can read this project and propose changes through WebMCP. You approve what lands.'
            : 'No WebMCP runtime in this browser, so no external agent can connect. Every tool below still runs from the Test Console, against the same project.'}
        </p>
      </header>

      {/* Decisions first: proposals, then publish */}
      {openProposals.length > 0 && (
        <div className="flex flex-col gap-2 shrink-0">
          {openProposals.slice(-2).map((cs) => <ProposalCard key={cs.id} changeset={cs} />)}
        </div>
      )}

      {pendingPublish && (
        <div
          className="flex flex-col gap-2 p-2.5 cut-corners border shrink-0"
          style={{ borderColor: 'var(--accent)', backgroundColor: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}
        >
          <span className="text-[11px] font-semibold">Agent requested publish</span>
          {pendingPublish.note && (
            <p className="text-[10px] leading-relaxed text-[var(--text-primary)] m-0">“{pendingPublish.note}”</p>
          )}
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-[var(--text-secondary)]">Revision {pendingPublish.revision}</span>
            {pendingPublish.changeSummary.map((line, i) => (
              <span key={i} className="text-[10px] leading-snug text-[var(--text-secondary)]">· {line}</span>
            ))}
          </div>
          <p className="text-[10px] leading-relaxed text-[var(--text-secondary)] m-0">
            Approving persists the project and downloads the agent-ready bundle: your Next.js source,
            a WebMCP capability manifest and the published-site runtime.
          </p>
          <div className="flex gap-1.5">
            <Button
              variant="primary" size="sm" className="flex-1 cut-corners" disabled={approving}
              onClick={() => { setApproving(true); void approvePublish().finally(() => setApproving(false)); }}
            >
              {approving ? 'Publishing…' : 'Approve & publish'}
            </Button>
            <Button variant="secondary" size="sm" className="cut-corners" onClick={cancelPublish} disabled={approving}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* The state both actors share */}
      <section className="flex flex-col gap-1 shrink-0">
        <SectionHeading>Shared context</SectionHeading>
        <div className="flex flex-col gap-1 text-[10px] text-[var(--text-secondary)]">
          <div className="flex justify-between gap-2"><span>Page</span><span className="text-[var(--text-primary)] truncate">{pageFileToRoute(activeFile)}</span></div>
          <div className="flex justify-between gap-2"><span>Selection</span><span className="text-[var(--text-primary)] truncate">{selectionLabel}</span></div>
          <div className="flex justify-between gap-2"><span>Sections</span><span className="text-[var(--text-primary)] tabular-nums">{sectionCount}</span></div>
          <div className="flex justify-between gap-2"><span>Revision</span><span className="text-[var(--text-primary)] tabular-nums">{revision}</span></div>
        </div>
        <p className="text-[9px] leading-relaxed text-[var(--text-secondary)] m-0 mt-0.5">
          Every edit — yours or the agent&rsquo;s — makes a new revision. A proposal built on an older
          one is refused rather than applied blind.
        </p>
      </section>

      <ReadinessCard />

      {/* Capabilities */}
      <section className="flex flex-col gap-1 shrink-0">
        <SectionHeading action={
          <button onClick={() => setInspectorOpen(true)} className="text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
            Inspect
          </button>
        }>Available tools</SectionHeading>
        <div className="flex flex-col">
          {exposed.map((t) => (
            <div key={t.name} className="flex items-center justify-between gap-2 py-[3px]">
              <span className="text-[10px] font-mono text-[var(--text-primary)] truncate">{t.name}</span>
              <span className="text-[9px] font-semibold uppercase tracking-wider shrink-0"
                style={{ color: t.annotations.readOnlyHint ? 'var(--text-secondary)' : t.annotations.destructiveHint ? '#ef4444' : 'var(--accent)' }}>
                {t.annotations.readOnlyHint ? 'read' : t.annotations.destructiveHint ? 'destructive' : t.annotations.requiresHumanApproval ? 'gated' : 'write'}
              </span>
            </div>
          ))}
        </div>
        {hidden > 0 && (
          <p className="text-[9px] leading-relaxed text-[var(--text-secondary)] m-0 mt-0.5">
            {hidden} element tool{hidden === 1 ? '' : 's'} hidden — select something on the canvas to expose {hidden === 1 ? 'it' : 'them'}.
          </p>
        )}
      </section>

      {/* What actually happened */}
      <section className="flex flex-col gap-1 shrink-0">
        <SectionHeading>Activity</SectionHeading>
        {activity.length === 0 ? (
          <p className="text-[10px] leading-relaxed text-[var(--text-secondary)] m-0">
            Nothing yet. Agent calls, console runs and your approvals all appear here.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5 max-h-64 overflow-y-auto pr-0.5 list-none p-0 m-0">
            {[...activity].reverse().map((e) => {
              const locatable = (e.targets ?? []).filter((t) => nodes.has(t));
              return (
                <li key={e.id} className="flex flex-col gap-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-mono truncate" style={{ color: e.ok ? 'var(--text-primary)' : '#ef4444' }}>
                      {e.tool}
                    </span>
                    <span className="text-[9px] text-[var(--text-secondary)] shrink-0 tabular-nums">
                      {SOURCE_LABEL[e.source]} · {timeAgo(e.at)}
                    </span>
                  </div>
                  {locatable.length > 0 ? (
                    <button
                      onClick={() => { setSelection(locatable); trace.action('weave:activity-locate', { targets: locatable }); }}
                      className="text-left text-[9px] leading-snug text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                      title="Select the elements this touched"
                    >
                      → {e.summary} <span className="opacity-60">· show me</span>
                    </button>
                  ) : (
                    <span className="text-[9px] leading-snug text-[var(--text-secondary)]">→ {e.summary}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Developer surface — explicitly not an agent */}
      <section className="flex flex-col gap-1.5 border-t border-[var(--border-light)] pt-3 shrink-0">
        <button
          onClick={() => setConsoleOpen((v) => !v)}
          aria-expanded={consoleOpen}
          className="flex items-center justify-between text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
        >
          <span>WebMCP Test Console</span>
          <span aria-hidden>{consoleOpen ? '−' : '+'}</span>
        </button>
        <p className="text-[9px] leading-relaxed text-[var(--text-secondary)] m-0">
          Developer tool. Runs the same implementations an external agent calls; entries are
          labelled “console” in the activity list, never as agent calls.
        </p>
        {consoleOpen && <TestConsole />}
      </section>
    </div>
  );
}
