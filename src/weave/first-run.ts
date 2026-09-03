// WEAVE addition (not upstream Revyme) — see src/weave/README.md.
//
// first-run.ts — what a judge sees in the first two seconds.
//
// The editor's default camera fits ALL content. On the EMBER starter that is
// seven full-bleed sections across three breakpoints, so fit-all lands near
// 10% and the site reads as a thumbnail. This focuses the hero of the primary
// viewport instead, once — a readable, composed first screen.
//
// Deliberately additive and fail-safe: it only runs for a project WEAVE just
// seeded (never for a saved one, whose camera the user owns), it gives up
// after a few render cycles, and if the rect cache never produces bounds it
// does nothing at all — leaving the editor's own fit-all result in place.

import { getDefaultStore } from 'jotai';
import { selectedIdsAtom } from '@/code/stores/store';
import { setProjectName } from '@/code/stores/project-store';
import { zoomToFitNodes } from '@/canvas/transform';
import { getNodeBounds } from '@/canvas/transform/CameraCommands';
import { trace } from '@/shared/debug-trace';

const store = getDefaultStore();

/** Set when ProjectLoader seeds the starter, consumed once by the canvas. */
let pendingFocusId: string | null = null;

/** Called by ProjectLoader right after the starter snapshot is loaded. */
export function armStarterFirstRun(heroSectionId: string, siteName: string): void {
  pendingFocusId = heroSectionId;
  setProjectName(siteName);
  trace.action('weave:first-run-armed', { heroSectionId, siteName });
}

/**
 * Focus the starter's hero once the canvas has rendered it. No-op unless
 * `armStarterFirstRun` ran for this session.
 */
export function runStarterFirstRun(): void {
  const heroId = pendingFocusId;
  if (!heroId || typeof window === 'undefined') return;
  pendingFocusId = null;

  let armed = 6;
  let done = false;
  const cleanup = () => {
    done = true;
    window.removeEventListener('revyme:render-complete', onRender);
    clearTimeout(timer);
  };
  const onRender = () => {
    if (done) return;
    requestAnimationFrame(() => {
      if (done) return;
      // Bounds come from the bridge rect cache; on early renders it is not
      // populated yet, so retry on the next render rather than guessing.
      const bounds = getNodeBounds(document.documentElement, [heroId]);
      if (bounds) {
        // 0.92 leaves a little breathing room around the hero rather than
        // cropping it to the exact viewport edge.
        zoomToFitNodes(document.documentElement, [heroId], true, undefined, 0.92);
        store.set(selectedIdsAtom, []);
        trace.action('weave:first-run-focused', { heroId });
        cleanup();
      } else if (--armed <= 0) {
        trace.action('weave:first-run-gave-up', { heroId });
        cleanup();
      }
    });
  };
  const timer = setTimeout(cleanup, 6000);
  window.addEventListener('revyme:render-complete', onRender);
}
