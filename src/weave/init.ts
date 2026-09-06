// WEAVE addition (not upstream Revyme) — see src/weave/README.md.
//
// init.ts — one call that wires the WEAVE layer into the running editor:
// defines the tools (importing ./tools registers them), starts the revision
// counter, the context subscription and the ChangeSet staleness watch, and
// syncs the tool surface with the browser's WebMCP runtime when one exists.
// Called once from App.tsx after mount, the same pattern initCloudPlugin uses.

import './tools';
import './tools-advanced';
import { subscribeWeaveContext } from './context';
import { subscribeRevision } from './revision';
import { watchChangeSetStaleness } from './changeset';
import { startToolSurface, getWeaveTools } from './webmcp/registry';
import { runStarterFirstRun } from './first-run';

let initialized = false;

export function initWeave(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  subscribeRevision();
  subscribeWeaveContext();
  watchChangeSetStaleness();
  startToolSurface();
  runStarterFirstRun();
}

export { getWeaveTools };
