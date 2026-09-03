// WEAVE addition (not upstream Revyme) — see src/weave/README.md.
//
// store.ts — Jotai atoms for the WEAVE agent layer: WebMCP availability, the
// tool-activity feed the Agent panel renders, the pending publish approval
// that gates weave_publish_site behind a human click, and the last validation
// report. Every value here is produced by a real event; nothing is simulated.

import { atom } from 'jotai';
import { leftPanelAtom } from '@/code/stores/left-panel-store';
import { trace } from '@/shared/debug-trace';
import type { ValidationReport } from './validate';

/** How WEAVE tools are exposed right now.
 *  - 'native'      — the browser exposes a WebMCP runtime and every tool is
 *                    registered with it; an external agent can call them.
 *  - 'unavailable' — no runtime detected. Tools still work through the in-app
 *                    WebMCP Test Console (same implementations), but no
 *                    external agent can reach them. The panel says exactly
 *                    that rather than implying a connection. */
export type WebMcpStatus = 'native' | 'unavailable';
export const webMcpStatusAtom = atom<WebMcpStatus>('unavailable');

/** Bumped whenever the registered tool surface changes (adaptive surface). */
export const toolSurfaceVersionAtom = atom(0);

// ─── Activity feed ──────────────────────────────────────────────────────────

export type ActivityKind = 'read' | 'write' | 'proposal' | 'approval' | 'system';

/** One row of the Agent panel's activity feed. Append-only, bounded. */
export interface WeaveActivityEntry {
  id: number;
  at: number;
  tool: string;
  /** One-line human summary, e.g. `Updated hero headline`. */
  summary: string;
  ok: boolean;
  kind: ActivityKind;
  /** 'agent' = arrived through the WebMCP runtime (external agent);
   *  'console' = the in-app developer Test Console;
   *  'human' = a human action in the editor chrome (approval, amendment). */
  source: 'agent' | 'console' | 'human';
  /** Element ids this entry touched — click-to-locate selects them. */
  targets?: string[];
  /** Project revision after the entry, when it changed one. */
  revision?: number;
  durationMs?: number;
}

const MAX_ACTIVITY = 60;
export const weaveActivityAtom = atom<WeaveActivityEntry[]>([]);

let nextActivityId = 1;
export function makeActivityEntry(
  tool: string,
  summary: string,
  ok: boolean,
  source: WeaveActivityEntry['source'],
  extra: Partial<Pick<WeaveActivityEntry, 'kind' | 'targets' | 'revision' | 'durationMs'>> = {},
): WeaveActivityEntry {
  return {
    id: nextActivityId++, at: Date.now(), tool, summary, ok, source,
    kind: extra.kind ?? 'system',
    targets: extra.targets,
    revision: extra.revision,
    durationMs: extra.durationMs,
  };
}

export function appendActivity(prev: WeaveActivityEntry[], entry: WeaveActivityEntry): WeaveActivityEntry[] {
  const next = [...prev, entry];
  return next.length > MAX_ACTIVITY ? next.slice(next.length - MAX_ACTIVITY) : next;
}

// ─── Publish approval ───────────────────────────────────────────────────────

/** A publish request waiting for the human. `weave_publish_site` NEVER
 *  publishes — it writes this atom and the Agent panel renders the approval
 *  card. Only the human's click runs the real operation. */
export interface PendingPublish {
  requestedAt: number;
  note?: string;
  source: 'agent' | 'console';
  /** Revision the agent asked to publish. */
  revision: number;
  /** What has changed since the last publish, summarised for the human. */
  changeSummary: string[];
}

const _pendingPublishAtom = atom<PendingPublish | null>(null);

/** Write-through: an incoming publish request also opens the Agent panel so
 *  the approval card is visible without hunting for it. */
export const pendingPublishAtom = atom(
  (get) => get(_pendingPublishAtom),
  (get, set, pending: PendingPublish | null) => {
    set(_pendingPublishAtom, pending);
    if (pending) set(leftPanelAtom, 'agent');
    trace.action('weave:pending-publish', { pending: !!pending });
  },
);

// ─── Validation ─────────────────────────────────────────────────────────────

/** The most recent validation report, so the readiness surface and the
 *  publish card show the same numbers a tool call returned. */
export const lastValidationAtom = atom<ValidationReport | null>(null);

// ─── Context ────────────────────────────────────────────────────────────────

/** Bumped (debounced) whenever agent-visible context changes. Agents re-read
 *  through weave_get_context; the panel shows it as the context version. */
export const weaveContextVersionAtom = atom(0);

/** Whether the WebMCP Inspector overlay is open. */
export const inspectorOpenAtom = atom(false);
