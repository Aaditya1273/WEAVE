// WEAVE addition (not upstream Revyme) — see src/weave/README.md.
//
// revision.ts — the authoritative project revision counter.
//
// A revision is "how many settled changes has this project seen". It is the
// concurrency token every ChangeSet is pinned to: an agent proposes against
// revision 42, the human then drags a section (revision 43), and the proposal
// is refused as STALE rather than silently applied against state the agent
// never saw.
//
// Both humans and agents move the number, because both write through the same
// mutation queue and every queue flush bumps `projectVersionAtom`. A short
// trailing debounce coalesces a drag's per-frame writes into ONE revision;
// `settleRevision()` force-flushes that window so a ChangeSet created or
// applied right after an edit always pins the settled number.

import { getDefaultStore } from 'jotai';
import { atom } from 'jotai';
import { projectVersionAtom } from '@/code/project/project-fs';
import { trace } from '@/shared/debug-trace';

const store = getDefaultStore();

/** Monotonic count of settled project changes. Starts at 1 (the loaded state). */
export const revisionAtom = atom(1);

/** Who caused the current revision — drives the history/activity labelling. */
export type RevisionAuthor = 'human' | 'agent';
export const lastRevisionAuthorAtom = atom<RevisionAuthor>('human');

export function currentRevision(): number {
  return store.get(revisionAtom);
}

// ─── Bumping ────────────────────────────────────────────────────────────────

const SETTLE_MS = 250;
let timer: ReturnType<typeof setTimeout> | null = null;
let pendingAuthor: RevisionAuthor = 'human';
let listeners: Array<(rev: number) => void> = [];

function commit(): void {
  if (timer) { clearTimeout(timer); timer = null; }
  const next = store.get(revisionAtom) + 1;
  store.set(revisionAtom, next);
  store.set(lastRevisionAuthorAtom, pendingAuthor);
  trace.action('weave:revision', { revision: next, author: pendingAuthor });
  for (const fn of listeners) fn(next);
  pendingAuthor = 'human';
}

/** Schedule a revision bump. Repeated calls inside the settle window coalesce
 *  into one revision (a drag is one change, not sixty). */
export function bumpRevision(author: RevisionAuthor = 'human'): void {
  // An agent commit inside a window opened by a human edit still counts as an
  // agent revision — it is the later, more specific cause.
  if (author === 'agent') pendingAuthor = 'agent';
  if (timer) clearTimeout(timer);
  timer = setTimeout(commit, SETTLE_MS);
}

/** Force any pending bump to land NOW and return the settled revision. Call
 *  before pinning or checking a ChangeSet's baseRevision. */
export function settleRevision(): number {
  if (timer) commit();
  return store.get(revisionAtom);
}

/** Subscribe to settled revision changes (used by the context loop). */
export function onRevision(fn: (rev: number) => void): () => void {
  listeners.push(fn);
  return () => { listeners = listeners.filter((l) => l !== fn); };
}

// ─── Wiring ─────────────────────────────────────────────────────────────────

let subscribed = false;

/** Bump the revision whenever the project's files change. `projectVersionAtom`
 *  is bumped by every mutation-queue flush and every direct ProjectFS write,
 *  so this covers human edits, agent commits and CMS/preset writes alike. */
export function subscribeRevision(): void {
  if (subscribed) return;
  subscribed = true;
  store.sub(projectVersionAtom, () => bumpRevision());
}

/** Test seam: reset to a known state. */
export function resetRevisionForTest(rev = 1): void {
  if (timer) { clearTimeout(timer); timer = null; }
  pendingAuthor = 'human';
  store.set(revisionAtom, rev);
  store.set(lastRevisionAuthorAtom, 'human');
}
