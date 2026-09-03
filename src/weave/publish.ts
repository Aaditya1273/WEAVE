// WEAVE addition (not upstream Revyme) — see src/weave/README.md.
//
// publish.ts — the human-gated publish flow.
//
// `weave_publish_site` only ever REQUESTS a publish: it writes
// `pendingPublishAtom` and the Agent panel renders an approval card showing
// the revision and what changed. Only `approvePublish()` — reachable solely
// from that card's button — flushes pending mutations, persists the project
// through the editor's existing autosave path, and produces the site bundle.
// There is no code path from a tool call to a publish.
//
// "Publish" here means: persist, then hand the human a real, complete Next.js
// bundle carrying a WEAVE capability manifest and the agent runtime adapter.
// No third-party deployment provider is contacted or simulated.

import { getDefaultStore } from 'jotai';
import { toast } from 'sonner';
import { flushNow } from '@/code/mutation/mutation-queue';
import { flushSaveNow } from '@/backend/autosave';
import { projectFS } from '@/code/project/project-fs';
import { trace } from '@/shared/debug-trace';
import {
  pendingPublishAtom, weaveActivityAtom, makeActivityEntry, appendActivity, lastValidationAtom,
} from './store';
import { buildCapabilityManifest, BUNDLE_AGENT_README, AGENT_RUNTIME_SOURCE } from './manifest';
import { buildZip } from './zip';
import { settleRevision } from './revision';
import { changesetsAtom } from './changeset';
import { validateSite } from './validate';

const store = getDefaultStore();

/** Revision at the last approved publish — drives "what changed since". */
let lastPublishedRevision = 0;

/** Human-readable summary of what a publish would ship. */
export function buildChangeSummary(): string[] {
  const revision = settleRevision();
  const applied = store.get(changesetsAtom).filter(
    (c) => c.status === 'applied' && (c.appliedRevision ?? 0) > lastPublishedRevision,
  );
  const lines: string[] = [];
  if (lastPublishedRevision === 0) lines.push('First publish of this site.');
  else lines.push(`${revision - lastPublishedRevision} revision(s) since the last publish.`);
  for (const cs of applied) {
    const ops = cs.operations.filter((o) => o.outcome === 'applied').length;
    lines.push(`“${cs.summary}” — ${ops} operation(s)${cs.amendedByHuman ? ', amended by you' : ''}`);
  }
  const report = store.get(lastValidationAtom);
  if (report) lines.push(`Agent readiness ${report.score}% · ${report.issues.length} finding(s).`);
  return lines;
}

/** Request a publish. Returns false when one is already pending. */
export function requestPublish(source: 'agent' | 'console', note?: string): boolean {
  if (store.get(pendingPublishAtom)) return false;
  // Compute readiness now so the approval card shows the human what an agent
  // would see, without them having to run validation separately.
  const report = validateSite();
  store.set(lastValidationAtom, report);
  store.set(pendingPublishAtom, {
    requestedAt: Date.now(),
    note,
    source,
    revision: settleRevision(),
    changeSummary: buildChangeSummary(),
  });
  return true;
}

export function cancelPublish(): void {
  store.set(pendingPublishAtom, null);
  store.set(weaveActivityAtom, appendActivity(
    store.get(weaveActivityAtom),
    makeActivityEntry('weave_publish_site', 'Publish request declined by the human', true, 'human', { kind: 'approval' }),
  ));
  trace.action('weave:publish-cancelled', {});
}

/** Build the site bundle: full project source + capability manifest + runtime. */
export function buildPublishBundle(): Map<string, string> {
  const files = new Map(projectFS.getSnapshot());
  files.set('weave.manifest.json', JSON.stringify(buildCapabilityManifest(), null, 2));
  files.set('public/weave-agent.js', AGENT_RUNTIME_SOURCE);
  files.set('WEAVE-AGENT-README.md', BUNDLE_AGENT_README);
  return files;
}

/**
 * Human clicked "Approve & publish". Flush → persist → bundle → download.
 * This is the ONLY function that performs a publish, and nothing but the
 * approval card calls it.
 */
export async function approvePublish(): Promise<void> {
  const pending = store.get(pendingPublishAtom);
  trace.action('weave:publish-approved', { revision: pending?.revision });
  try {
    flushNow();
    await flushSaveNow();
    const bundle = buildPublishBundle();
    const zip = buildZip(bundle);
    const blob = new Blob([zip.buffer as ArrayBuffer], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'weave-site.zip';
    a.click();
    URL.revokeObjectURL(url);
    lastPublishedRevision = settleRevision();
    store.set(pendingPublishAtom, null);
    store.set(weaveActivityAtom, appendActivity(
      store.get(weaveActivityAtom),
      makeActivityEntry(
        'weave_publish_site',
        `Human approved — revision ${lastPublishedRevision} published as an agent-ready bundle (${bundle.size} files)`,
        true, 'human', { kind: 'approval', revision: lastPublishedRevision },
      ),
    ));
    toast.success('Published — weave-site.zip downloaded (source + agent manifest).');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    trace.error('weave:publish-failed', { message });
    store.set(weaveActivityAtom, appendActivity(
      store.get(weaveActivityAtom),
      makeActivityEntry('weave_publish_site', `Publish failed: ${message}`, false, 'human', { kind: 'approval' }),
    ));
    toast.error('Publish failed — check the console for details.');
  }
}

/** Test seam. */
export function resetPublishStateForTest(): void {
  lastPublishedRevision = 0;
  store.set(pendingPublishAtom, null);
}
