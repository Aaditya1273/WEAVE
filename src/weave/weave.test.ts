// weave.test.ts — the WEAVE architecture against the REAL editor pipeline.
//
// These drive the actual jotai store, parser, mutation queue, paste engine and
// undo history on an in-memory ProjectFS — the same harness the upstream
// paste-engine integration tests use. If they pass, an agent calling a WEAVE
// tool over WebMCP changes the same source a human edits, transactionally,
// reversibly, and only with human consent where consent is required.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getDefaultStore } from 'jotai';
import { projectFS, resetProjectFS, projectVersionAtom } from '@/code/project/project-fs';
import { setActiveFilePath, initMutationQueue, syncQueueCode } from '@/code/mutation/mutation-queue';
import { initHistory, undo, redo, getHistoryState } from '@/code/mutation/history';
import { setBumpVersion } from '@/code/project/modify-file';
import { nodesAtom, selectedIdsAtom } from '@/code/stores/store';
import { activeFilePathAtom } from '@/code/project/active-file-store';
import { checkFile } from '@/code/oracle/check-file';
import { parseJSXToNodes } from '@/code/parsing/parser';

import './tools';
import './tools-advanced';
import { executeWeaveTool, getWeaveTools, applicableTools, getLastInvocation, syncToolSurface } from './webmcp/registry';
import { isWebMcpAvailable, webMcpCapabilities, registerWebMcpTool, unregisterWebMcpTool, registeredToolNames } from './webmcp/adapter';
import {
  pendingPublishAtom, weaveActivityAtom, weaveContextVersionAtom, lastValidationAtom,
} from './store';
import {
  proposeChangeSet, applyChangeSet, amendOperation, toggleOperationSkip, rejectChangeSet,
  getChangeSet, pendingChangeSets, watchChangeSetStaleness, resetChangeSetsForTest,
} from './changeset';
import { validateOperation, executeOperation, applyOperations, describeOperation } from './commands';
import { validateSite } from './validate';
import { currentRevision, settleRevision, bumpRevision, resetRevisionForTest, subscribeRevision } from './revision';
import { cancelPublish, buildPublishBundle, resetPublishStateForTest, buildChangeSummary } from './publish';
import { buildZip, crc32 } from './zip';
import { pageFileToRoute, subscribeWeaveContext } from './context';
import { buildStarterPage, createWeaveStarterProject } from './starter-project';
import { AGENT_RUNTIME_SOURCE, buildCapabilityManifest } from './manifest';

const FILE = 'app/page.client.tsx';
const store = getDefaultStore();

const PAGE = `'use client';
import React from 'react';
export default function Page() {
  return <div data-id="root" data-name="Page" style={{ position: 'relative', width: '100%', height: 'auto', display: 'flex', flexDirection: 'column' }}>
    <div data-id="section-hero" data-name="Hero" style={{ position: 'relative', order: '0', flex: '0 0 auto', width: '100%', height: 'min-content', display: 'flex', flexDirection: 'column', padding: '40px' }}>
      <p data-id="hero-title" data-name="Title" style={{ position: 'relative', order: '0', flex: '0 0 auto', margin: '0px', width: '100%', height: 'auto', color: '#111111', fontFamily: 'Inter, sans-serif', fontSize: '48px', fontWeight: '500', lineHeight: '1.1' }}>Form follows feeling</p>
      <p data-id="hero-lead" data-name="Lead" style={{ position: 'relative', order: '1', flex: '0 0 auto', margin: '0px', width: '100%', height: 'auto', color: '#111111', fontFamily: 'Inter, sans-serif', fontSize: '18px', fontWeight: '400', lineHeight: '1.5' }}>We design calm places.</p>
      <div data-id="hero-cta" data-name="CTA Button" style={{ position: 'relative', order: '2', flex: '0 0 auto', width: 'min-content', height: 'min-content', display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: '12px 24px 12px 24px', backgroundColor: '#161513' }}>
        <p data-id="hero-cta-label" data-name="Label" style={{ position: 'relative', order: '0', flex: '0 0 auto', margin: '0px', width: 'max-content', height: 'auto', color: '#ffffff', fontFamily: 'Inter, sans-serif', fontSize: '14px', fontWeight: '500', lineHeight: '1.4' }}>Shop now</p>
      </div>
    </div>
    <div data-id="section-story" data-name="Story" style={{ position: 'relative', order: '1', flex: '0 0 auto', width: '100%', height: 'min-content', display: 'flex', flexDirection: 'column', padding: '40px' }}>
      <p data-id="story-body" data-name="Body" style={{ position: 'relative', order: '0', flex: '0 0 auto', margin: '0px', width: '100%', height: 'auto', color: '#111111', fontFamily: 'Inter, sans-serif', fontSize: '16px', fontWeight: '400', lineHeight: '1.6' }}>Our story.</p>
    </div>
  </div>;
}`;

function bump(): void { store.set(projectVersionAtom, (v) => v + 1); }

function seed(): void {
  resetProjectFS();
  projectFS.writeFile(FILE, PAGE);
  bump();
  store.set(activeFilePathAtom, FILE);
  setActiveFilePath(FILE);
  setBumpVersion(() => bump());
  initMutationQueue(PAGE, (c) => { projectFS.writeFile(FILE, c); bump(); });
  initHistory(
    PAGE,
    (code) => { syncQueueCode(code); bump(); },
    () => FILE,
    () => bump(),
    {
      get: () => store.get(selectedIdsAtom),
      set: (ids) => store.set(selectedIdsAtom, ids),
      getNodeIds: () => new Set(store.get(nodesAtom).keys()),
    },
  );
  store.set(selectedIdsAtom, []);
  store.set(weaveActivityAtom, []);
  store.set(lastValidationAtom, null);
  resetChangeSetsForTest();
  resetPublishStateForTest();
  resetRevisionForTest(1);
}

const call = (name: string, args?: unknown, source: 'agent' | 'console' = 'console') =>
  executeWeaveTool(name, args, source);
const sectionIds = () => store.get(nodesAtom).get('root')!.children;
const nodeText = (id: string) => store.get(nodesAtom).get(id)?.textContent;
const find2 = (n: any, id: string): any => n.id === id ? n : (n.children ?? []).map((c: any) => find2(c, id)).find(Boolean);

beforeEach(() => { seed(); });

// ─── 1. Tool registration ───────────────────────────────────────────────────

describe('tool registration', () => {
  it('defines the core product tools with honest safety annotations', () => {
    const byName = Object.fromEntries(getWeaveTools().map((t) => [t.name, t]));
    // The surface grows; these nine are the core contract every other tool is
    // built on, and each must keep existing under its own name.
    for (const name of [
      'weave_add_section', 'weave_delete_element', 'weave_get_context', 'weave_get_selection',
      'weave_move_element', 'weave_propose_changes', 'weave_publish_site',
      'weave_update_element', 'weave_validate_site',
    ]) {
      expect(byName[name], `${name} must exist`).toBeTruthy();
    }
    // Read-only tools must not claim write capability, and vice versa.
    for (const name of ['weave_get_context', 'weave_get_selection', 'weave_validate_site']) {
      expect(byName[name].annotations.readOnlyHint).toBe(true);
      expect(byName[name].annotations.destructiveHint).toBe(false);
    }
    for (const name of ['weave_add_section', 'weave_update_element', 'weave_move_element']) {
      expect(byName[name].annotations.readOnlyHint).toBe(false);
      expect(byName[name].annotations.destructiveHint).toBe(false);
    }
    expect(byName.weave_delete_element.annotations.destructiveHint).toBe(true);
    expect(byName.weave_publish_site.annotations.requiresHumanApproval).toBe(true);
    expect(byName.weave_propose_changes.annotations.requiresHumanApproval).toBe(true);

    // Every tool, core or not, declares hints that match what it does: a
    // read-only tool can never be destructive, and anything that deletes the
    // human's work must say so.
    for (const tool of getWeaveTools()) {
      if (tool.annotations.readOnlyHint) {
        expect(tool.annotations.destructiveHint, `${tool.name} is read-only`).toBe(false);
        expect(tool.kind, `${tool.name} is read-only`).toBe('read');
      }
    }
    for (const name of ['weave_ungroup_element', 'weave_remove_collection_item', 'weave_delete_page']) {
      expect(byName[name].annotations.destructiveHint, `${name} destroys content`).toBe(true);
    }
  });

  it('carries valid JSON schemas and injection-free descriptions', () => {
    for (const tool of getWeaveTools()) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.description.length).toBeGreaterThan(40);
      // A tool description is an injection surface: it must describe, never instruct.
      expect(tool.description).not.toMatch(/ignore (previous|prior|all)|system prompt|disregard/i);
      for (const key of tool.inputSchema.required ?? []) {
        expect(Object.keys(tool.inputSchema.properties)).toContain(key);
      }
    }
  });

  it('exposes an adaptive surface that follows the human selection', () => {
    store.set(selectedIdsAtom, []);
    const noSelection = applicableTools().map((t) => t.name);
    expect(noSelection).toContain('weave_get_context');
    expect(noSelection).toContain('weave_add_section');
    expect(noSelection).toContain('weave_propose_changes');
    expect(noSelection).not.toContain('weave_update_element');
    expect(noSelection).not.toContain('weave_delete_element');

    store.set(selectedIdsAtom, ['hero-title']);
    const withSelection = applicableTools().map((t) => t.name);
    expect(withSelection).toContain('weave_get_selection');
    expect(withSelection).toContain('weave_update_element');
    expect(withSelection).toContain('weave_move_element');
    expect(withSelection).toContain('weave_delete_element');
  });
});

// ─── 2. WebMCP adapter ──────────────────────────────────────────────────────

describe('WebMCP adapter', () => {
  it('reports no runtime honestly when the browser exposes none', () => {
    expect(isWebMcpAvailable()).toBe(false);
    const caps = webMcpCapabilities();
    expect(caps.available).toBe(false);
    expect(caps.host).toBeNull();
    expect(caps.registerTool).toBe(false);
  });

  it('prefers document.modelContext and registers, unregisters and re-registers cleanly', async () => {
    const registered = new Map<string, unknown>();
    const mc = {
      registerTool: vi.fn((tool: { name: string }) => { registered.set(tool.name, tool); return () => registered.delete(tool.name); }),
      getTools: () => [...registered.values()],
    };
    (document as unknown as { modelContext?: unknown }).modelContext = mc;
    try {
      expect(isWebMcpAvailable()).toBe(true);
      const caps = webMcpCapabilities();
      expect(caps.host).toBe('document');
      expect(caps.registerTool).toBe(true);
      expect(caps.getTools).toBe(true);

      const descriptor = {
        name: 'weave_probe', description: 'probe', inputSchema: { type: 'object' },
        execute: async () => ({ content: [{ type: 'text' as const, text: '{}' }] }),
      };
      expect(registerWebMcpTool(descriptor)).toBe(true);
      expect(registeredToolNames()).toContain('weave_probe');
      // Duplicate registration replaces rather than stacking.
      registerWebMcpTool(descriptor);
      expect(registeredToolNames().filter((n) => n === 'weave_probe')).toHaveLength(1);
      unregisterWebMcpTool('weave_probe');
      expect(registeredToolNames()).not.toContain('weave_probe');
      expect(registered.has('weave_probe')).toBe(false);
    } finally {
      delete (document as unknown as { modelContext?: unknown }).modelContext;
    }
  });

  it('routes runtime tool calls through the same implementations and honours cancellation', async () => {
    const registered = new Map<string, { execute: (a: unknown, o?: { signal?: AbortSignal }) => Promise<{ structuredContent?: unknown }> }>();
    (document as unknown as { modelContext?: unknown }).modelContext = {
      registerTool: (tool: { name: string; execute: never }) => { registered.set(tool.name, tool); },
    };
    try {
      syncToolSurface();
      expect(registered.has('weave_get_context')).toBe(true);

      const result = await registered.get('weave_get_context')!.execute({});
      expect((result.structuredContent as { ok: boolean }).ok).toBe(true);

      const controller = new AbortController();
      controller.abort();
      const cancelled = await registered.get('weave_get_context')!.execute({}, { signal: controller.signal });
      expect(cancelled.structuredContent).toMatchObject({ ok: false, error: { code: 'CANCELLED' } });
    } finally {
      for (const name of registeredToolNames()) unregisterWebMcpTool(name);
      delete (document as unknown as { modelContext?: unknown }).modelContext;
    }
  });
});

// ─── 3. Schema validation ───────────────────────────────────────────────────

describe('input validation', () => {
  it('rejects unknown tools, malformed args and out-of-schema values', async () => {
    expect(await call('weave_nope')).toMatchObject({ ok: false, error: { code: 'UNKNOWN_TOOL' } });
    expect(await call('weave_get_context', [1, 2])).toMatchObject({ ok: false, error: { code: 'INVALID_ARGS' } });
    expect(await call('weave_add_section', {})).toMatchObject({ ok: false, error: { code: 'INVALID_ARGS' } });
    expect(await call('weave_add_section', { section_type: 'carousel' })).toMatchObject({ ok: false, error: { code: 'INVALID_ARGS' } });
    expect(await call('weave_add_section', { section_type: 'cta', bogus: 1 })).toMatchObject({ ok: false, error: { code: 'INVALID_ARGS' } });
    expect(await call('weave_move_element', { element_id: 'section-hero', index: 'first' })).toMatchObject({ ok: false, error: { code: 'INVALID_ARGS' } });
  });

  it('refuses unsafe styles and attribute values at the command layer', () => {
    expect(validateOperation({ op: 'update_style', target: 'hero-title', styles: { position: 'fixed' } }))
      .toMatchObject({ code: 'UNSUPPORTED_STYLE' });
    expect(validateOperation({ op: 'update_style', target: 'hero-title', styles: { backgroundImage: 'url(javascript:alert(1))' } }))
      .toMatchObject({ code: 'UNSUPPORTED_STYLE' });
    expect(validateOperation({ op: 'update_attrs', target: 'hero-cta', attrs: { href: 'javascript:alert(1)' } }))
      .toMatchObject({ code: 'UNSUPPORTED_ATTR' });
    expect(validateOperation({ op: 'update_attrs', target: 'hero-cta', attrs: { onclick: 'boom()' } }))
      .toMatchObject({ code: 'UNSUPPORTED_ATTR' });
    // href is refused on a non-link element; the message points at the fix.
    expect(validateOperation({ op: 'update_attrs', target: 'hero-cta', attrs: { href: '/shop' } }))
      .toMatchObject({ code: 'NOT_A_LINK' });
    expect(validateOperation({ op: 'update_attrs', target: 'hero-cta', attrs: { 'aria-label': 'Shop' } })).toBeNull();
  });
});

// ─── 4-5. Context + selection ───────────────────────────────────────────────

describe('semantic context', () => {
  it('returns a bounded, semantic snapshot with revision and capabilities', async () => {
    store.set(selectedIdsAtom, ['hero-title']);
    const ctx = await call('weave_get_context') as Record<string, any>;
    expect(ctx.ok).toBe(true);
    expect(ctx.project.page).toBe('/');
    expect(ctx.project.revision).toBe(currentRevision());
    expect(ctx.sections.map((s: any) => ({ id: s.id, type: s.type }))).toEqual([
      { id: 'section-hero', type: 'hero' },
      { id: 'section-story', type: 'story' },
    ]);
    expect(ctx.selection).toMatchObject({ count: 1, ids: ['hero-title'] });
    expect(ctx.selection.elements[0].type).toBe('heading');
    expect(ctx.capabilities).toContain('weave_update_element');
    expect(ctx.pendingChangesets).toEqual([]);
    expect(ctx.truncated).toBe(false);
    // Bounded: a snapshot, not a DOM dump.
    expect(JSON.stringify(ctx).length).toBeLessThan(60_000);
  });

  it('types fluid clamp() headlines as headings, not body text', async () => {
    // The section library sizes hero type with clamp(); an agent must still
    // see the page's most prominent line as a heading.
    await call('weave_update_element', {
      element_id: 'hero-title', styles: { fontSize: 'clamp(56px, 9vw, 124px)' },
    });
    const ctx = await call('weave_get_context') as Record<string, any>;
    const find = (n: any): any => n.id === 'hero-title' ? n : (n.children ?? []).map(find).find(Boolean);
    expect(find(ctx.tree[0]).type).toBe('heading');
    // Body copy stays body copy.
    expect(find2(ctx.tree[0], 'hero-lead').type).toBe('text');
  });

  it('describes the selected element semantically and reports missing ids', async () => {
    store.set(selectedIdsAtom, ['hero-title']);
    const sel = await call('weave_get_selection') as Record<string, any>;
    expect(sel.selection[0]).toMatchObject({
      id: 'hero-title', type: 'heading', tag: 'p', parent: { id: 'section-hero' }, positionInParent: 0,
    });
    expect(sel.selection[0].layout.display).toBeDefined();
    expect(await call('weave_get_selection', { element_id: 'hero_42' }))
      .toMatchObject({ ok: false, error: { code: 'ELEMENT_NOT_FOUND' } });
  });

  it('tracks human edits: selection bumps context, a project change bumps the revision', async () => {
    vi.useFakeTimers();
    subscribeRevision();
    subscribeWeaveContext();
    const ctxBefore = store.get(weaveContextVersionAtom);
    store.set(selectedIdsAtom, ['hero-lead']);
    vi.advanceTimersByTime(300);
    expect(store.get(weaveContextVersionAtom)).toBeGreaterThan(ctxBefore);

    const revBefore = settleRevision();
    await call('weave_update_element', { element_id: 'hero-title', text: 'Edited' });
    vi.advanceTimersByTime(300);
    expect(settleRevision()).toBeGreaterThan(revBefore);
    vi.useRealTimers();
  });
});

// ─── 6-9. Direct mutation tools ─────────────────────────────────────────────

describe('direct tools mutate the real project', () => {
  it('updates text through the mutation queue and rewrites the source', async () => {
    store.set(selectedIdsAtom, ['hero-title']);
    const r = await call('weave_update_element', { text: 'Objects for slow rooms' }) as Record<string, any>;
    expect(r.ok).toBe(true);
    expect(r.changed).toEqual(['update_text']);
    expect(projectFS.readFile(FILE)).toContain('Objects for slow rooms');
    expect(nodeText('hero-title')).toBe('Objects for slow rooms');
  });

  it('applies safe styles, attributes and visibility', async () => {
    await call('weave_update_element', { element_id: 'hero-lead', styles: { color: '#ff0000' }, visible: false });
    expect(store.get(nodesAtom).get('hero-lead')!.styles.color).toBe('#ff0000');
    expect(store.get(nodesAtom).get('hero-lead')!.styles.display).toBe('none');
    await call('weave_update_element', { element_id: 'hero-lead', visible: true });
    expect(store.get(nodesAtom).get('hero-lead')!.styles.display).toBeUndefined();
    // href belongs on a real link element; this editor's dialect requires a
    // Next.js Link for navigation, so an agent may not put one on a <div>.
    expect(await call('weave_update_element', { element_id: 'hero-cta', attrs: { href: '/shop' } }))
      .toMatchObject({ ok: false, error: { code: 'NOT_A_LINK' } });
    await call('weave_update_element', { element_id: 'hero-cta', attrs: { 'aria-label': 'Shop the collection' } });
    expect(store.get(nodesAtom).get('hero-cta')!.attrs['aria-label']).toBe('Shop the collection');
  });

  it('refuses ambiguous and empty targets', async () => {
    store.set(selectedIdsAtom, []);
    expect(await call('weave_update_element', { text: 'x' })).toMatchObject({ ok: false, error: { code: 'NO_TARGET' } });
    store.set(selectedIdsAtom, ['hero-title', 'hero-lead']);
    expect(await call('weave_update_element', { text: 'x' })).toMatchObject({ ok: false, error: { code: 'AMBIGUOUS_TARGET' } });
    store.set(selectedIdsAtom, ['hero-title']);
    expect(await call('weave_update_element', {})).toMatchObject({ ok: false, error: { code: 'NO_CHANGES' } });
  });

  it('adds a library section and selects it', async () => {
    const r = await call('weave_add_section', { section_type: 'testimonials' }) as Record<string, any>;
    expect(r.ok).toBe(true);
    expect(sectionIds()).toHaveLength(3);
    expect(sectionIds()[2]).toBe(r.created[0]);
    expect(store.get(selectedIdsAtom)).toEqual(r.created);
    expect(projectFS.readFile(FILE)).toContain('Kind words from people');
  });

  it('reorders, re-parents and refuses cycles', async () => {
    store.set(selectedIdsAtom, ['section-story']);
    expect(await call('weave_move_element', { index: 0 })).toMatchObject({ ok: true });
    expect(sectionIds()).toEqual(['section-story', 'section-hero']);
    expect(await call('weave_move_element', { element_id: 'story-body', new_parent_id: 'section-hero', index: 0 })).toMatchObject({ ok: true });
    expect(store.get(nodesAtom).get('section-hero')!.children[0]).toBe('story-body');
    expect(await call('weave_move_element', { element_id: 'section-hero', new_parent_id: 'hero-title' }))
      .toMatchObject({ ok: false, error: { code: 'INVALID_MOVE' } });
  });

  it('deletes through the pipeline and clears the selection', async () => {
    store.set(selectedIdsAtom, ['section-story']);
    expect(await call('weave_delete_element', { element_id: 'section-story' }))
      .toMatchObject({ ok: true, deleted: { id: 'section-story' }, undoable: true });
    expect(sectionIds()).toEqual(['section-hero']);
    expect(store.get(selectedIdsAtom)).toEqual([]);
    expect(await call('weave_delete_element', { element_id: 'section-story' }))
      .toMatchObject({ ok: false, error: { code: 'ELEMENT_NOT_FOUND' } });
  });
});

// ─── 10-15. ChangeSets ──────────────────────────────────────────────────────

describe('ChangeSet proposals', () => {
  const PREMIUM_OPS = [
    { op: 'update_text', target: 'hero-title', value: 'Objects for slow rooms' },
    { op: 'update_text', target: 'hero-lead', value: 'Hand-thrown stoneware, made to outlast us.' },
    { op: 'update_text', target: 'hero-cta-label', value: 'View the collection' },
    { op: 'move', target: 'section-story', index: 0 },
    { op: 'add_section', sectionType: 'testimonials' },
  ] as const;

  it('creates one proposal from many operations without touching the page', async () => {
    const r = await call('weave_propose_changes', {
      summary: 'Make the homepage feel more premium',
      operations: PREMIUM_OPS,
    }) as Record<string, any>;
    expect(r.ok).toBe(true);
    expect(r.status).toBe('awaiting_human_review');
    expect(r.changeset.operations).toHaveLength(5);
    expect(r.changeset.status).toBe('proposed');
    expect(r.changeset.baseRevision).toBe(currentRevision());
    // Nothing has been applied yet.
    expect(nodeText('hero-title')).toBe('Form follows feeling');
    expect(sectionIds()).toHaveLength(2);
    // Every operation shows its before/after so the human can judge it.
    expect(r.changeset.operations[0]).toMatchObject({
      op: 'update_text', before: 'Form follows feeling', after: 'Objects for slow rooms',
    });
    expect(r.changeset.operations[0].description).toContain('Title');
  });

  it('rejects proposals that reference elements that do not exist', async () => {
    const r = await call('weave_propose_changes', {
      summary: 'Broken', operations: [{ op: 'update_text', target: 'ghost-42', value: 'x' }],
    });
    expect(r).toMatchObject({ ok: false, error: { code: 'ELEMENT_NOT_FOUND' } });
    expect(pendingChangeSets()).toHaveLength(0);
  });

  it('rejects an empty proposal and one without a summary', () => {
    expect(proposeChangeSet({ summary: 'x', operations: [], source: 'agent' }))
      .toMatchObject({ ok: false, error: { code: 'EMPTY_CHANGESET' } });
    expect(proposeChangeSet({ summary: '  ', operations: [{ op: 'update_text', target: 'hero-title', value: 'x' }], source: 'agent' }))
      .toMatchObject({ ok: false, error: { code: 'INVALID_ARGS' } });
  });

  it('applies a multi-operation proposal atomically as ONE revision', async () => {
    const proposal = proposeChangeSet({ summary: 'Premium pass', operations: [...PREMIUM_OPS], source: 'agent' });
    const id = proposal.changeset!.id;
    const revBefore = settleRevision();

    const applied = applyChangeSet(id);
    expect(applied.ok).toBe(true);
    expect(applied.changeset!.status).toBe('applied');
    expect(nodeText('hero-title')).toBe('Objects for slow rooms');
    expect(nodeText('hero-lead')).toBe('Hand-thrown stoneware, made to outlast us.');
    expect(nodeText('hero-cta-label')).toBe('View the collection');
    expect(sectionIds()[0]).toBe('section-story');
    expect(sectionIds()).toHaveLength(3);
    expect(applied.changeset!.appliedRevision).toBeGreaterThan(revBefore);
    expect(applied.changeset!.operations.every((o) => o.outcome === 'applied')).toBe(true);
  });

  it('lets the human amend one operation and records that they did', () => {
    const proposal = proposeChangeSet({ summary: 'Premium pass', operations: [...PREMIUM_OPS], source: 'agent' });
    const cs = proposal.changeset!;
    const amended = amendOperation(cs.id, cs.operations[0].id, 'Quietly made, kept for decades')!;
    expect(amended.status).toBe('amended');
    expect(amended.amendedByHuman).toBe(true);
    expect(amended.operations[0].amended).toBe(true);
    expect(amended.operations[0].after).toBe('Quietly made, kept for decades');
    // The agent's original intent is preserved for the receipt.
    expect((amended.operations[0].original as any).value).toBe('Objects for slow rooms');

    applyChangeSet(cs.id);
    expect(nodeText('hero-title')).toBe('Quietly made, kept for decades');
  });

  it('lets the human skip one operation and applies only the rest', () => {
    const proposal = proposeChangeSet({ summary: 'Premium pass', operations: [...PREMIUM_OPS], source: 'agent' });
    const cs = proposal.changeset!;
    const moveOp = cs.operations.find((o) => o.operation.op === 'move')!;
    toggleOperationSkip(cs.id, moveOp.id);

    const applied = applyChangeSet(cs.id);
    expect(applied.ok).toBe(true);
    expect(nodeText('hero-title')).toBe('Objects for slow rooms');
    // The skipped reorder did NOT happen.
    expect(sectionIds()[0]).toBe('section-hero');
    const outcomes = applied.changeset!.operations.map((o) => o.outcome);
    expect(outcomes.filter((o) => o === 'skipped')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'applied')).toHaveLength(4);
  });

  it('refuses to apply when every operation is skipped, and supports outright rejection', () => {
    const cs = proposeChangeSet({ summary: 'Two edits', operations: [
      { op: 'update_text', target: 'hero-title', value: 'A' },
      { op: 'update_text', target: 'hero-lead', value: 'B' },
    ], source: 'agent' }).changeset!;
    for (const op of cs.operations) toggleOperationSkip(cs.id, op.id);
    expect(applyChangeSet(cs.id)).toMatchObject({ ok: false, error: { code: 'CHANGESET_EMPTY' } });

    const other = proposeChangeSet({ summary: 'Nope', operations: [{ op: 'update_text', target: 'hero-title', value: 'X' }], source: 'agent' }).changeset!;
    expect(rejectChangeSet(other.id)!.status).toBe('rejected');
    expect(applyChangeSet(other.id)).toMatchObject({ ok: false, error: { code: 'CHANGESET_REJECTED' } });
    expect(nodeText('hero-title')).toBe('Form follows feeling');
  });

  it('marks a proposal STALE when the human edits the page underneath it', async () => {
    watchChangeSetStaleness();
    const cs = proposeChangeSet({ summary: 'Premium pass', operations: [...PREMIUM_OPS], source: 'agent' }).changeset!;
    expect(cs.baseRevision).toBe(currentRevision());

    // The human edits the canvas — a real project change, a new revision.
    await call('weave_update_element', { element_id: 'hero-lead', text: 'Human wrote this' });
    settleRevision();

    const result = applyChangeSet(cs.id);
    expect(result).toMatchObject({ ok: false, error: { code: 'CHANGESET_STALE' } });
    expect(result.error!.message).toMatch(/revision \d+.*revision \d+/);
    expect(getChangeSet(cs.id)!.status).toBe('stale');
    // The human's edit survived; the stale proposal changed nothing.
    expect(nodeText('hero-lead')).toBe('Human wrote this');
    expect(nodeText('hero-title')).toBe('Form follows feeling');
  });

  it('does not go stale merely because the human changed selection', () => {
    watchChangeSetStaleness();
    const cs = proposeChangeSet({ summary: 'Selection safe', operations: [{ op: 'update_text', target: 'hero-title', value: 'X' }], source: 'agent' }).changeset!;
    store.set(selectedIdsAtom, ['story-body']);
    settleRevision();
    expect(applyChangeSet(cs.id).ok).toBe(true);
  });

  it('rolls back completely when an operation in the middle fails', () => {
    // Delete a section, then try to update an element inside it — the second
    // operation cannot apply, so neither may survive.
    const result = applyOperations([
      { op: 'update_text', target: 'hero-title', value: 'Changed first' },
      { op: 'delete', target: 'section-story' },
      { op: 'update_text', target: 'story-body', value: 'Gone already' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.failedIndex).toBe(2);
    expect(nodeText('hero-title')).toBe('Form follows feeling');
    expect(sectionIds()).toEqual(['section-hero', 'section-story']);
  });
});

// ─── 16-17. History ─────────────────────────────────────────────────────────

describe('history', () => {
  it('undoes and redoes a whole agent transaction as one step', () => {
    const cs = proposeChangeSet({
      summary: 'Premium pass',
      operations: [
        { op: 'update_text', target: 'hero-title', value: 'Objects for slow rooms' },
        { op: 'update_text', target: 'hero-lead', value: 'Made to outlast us.' },
        { op: 'add_section', sectionType: 'testimonials' },
      ],
      source: 'agent',
    }).changeset!;
    applyChangeSet(cs.id);
    expect(nodeText('hero-title')).toBe('Objects for slow rooms');
    expect(sectionIds()).toHaveLength(3);
    expect(getHistoryState().canUndo).toBe(true);

    expect(undo()).toBe(true);
    expect(nodeText('hero-title')).toBe('Form follows feeling');
    expect(nodeText('hero-lead')).toBe('We design calm places.');
    expect(sectionIds()).toHaveLength(2);

    expect(redo()).toBe(true);
    expect(nodeText('hero-title')).toBe('Objects for slow rooms');
    expect(sectionIds()).toHaveLength(3);
  });

  it('never loses human work: a human edit before a commit is its own undo step', () => {
    executeOperation({ op: 'update_text', target: 'story-body', value: 'Human paragraph' });
    const cs = proposeChangeSet({ summary: 'Agent pass', operations: [{ op: 'update_text', target: 'hero-title', value: 'Agent headline' }], source: 'agent' }).changeset!;
    applyChangeSet(cs.id);
    expect(nodeText('story-body')).toBe('Human paragraph');
    expect(nodeText('hero-title')).toBe('Agent headline');

    // Undoing the agent transaction leaves the human's edit intact.
    undo();
    expect(nodeText('hero-title')).toBe('Form follows feeling');
    expect(nodeText('story-body')).toBe('Human paragraph');
  });
});

// ─── 18. Validation + readiness ─────────────────────────────────────────────

describe('validation and readiness', () => {
  it('finds real problems and points at real elements', async () => {
    const r = await call('weave_validate_site') as Record<string, any>;
    expect(r.ok).toBe(true);
    expect(typeof r.score).toBe('number');
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);

    const codes = r.issues.map((i: any) => i.code);
    // The fixture's CTA is not a link yet and the page has no metadata title.
    expect(codes).toContain('BUTTON_NOT_LINKED');
    expect(codes).toContain('MISSING_PAGE_TITLE');
    const buttonIssue = r.issues.find((i: any) => i.code === 'BUTTON_NOT_LINKED');
    expect(store.get(nodesAtom).has(buttonIssue.target)).toBe(true);
  });

  it('scores from explainable checks whose weights sum to 100', () => {
    const report = validateSite();
    expect(report.checks.reduce((s, c) => s + c.weight, 0)).toBe(100);
    expect(report.checks.reduce((s, c) => s + c.earned, 0)).toBe(report.score);
    for (const check of report.checks) {
      expect(check.earned).toBeLessThanOrEqual(check.weight);
      expect(check.detail.length).toBeGreaterThan(0);
    }
  });

  it('improves the score when the agent fixes what it found', async () => {
    // Give an unlabelled image a label — a finding an agent CAN act on.
    await call('weave_update_element', { element_id: 'hero-cta', styles: { backgroundImage: 'url(https://example.com/a.jpg)' } });
    const before = validateSite();
    expect(before.issues.map((i) => i.code)).toContain('MISSING_ALT');
    await call('weave_update_element', { element_id: 'hero-cta', attrs: { 'aria-label': 'Shop the collection' } });
    const after = validateSite();
    expect(after.score).toBeGreaterThan(before.score);
    expect(after.issues.map((i) => i.code)).not.toContain('MISSING_ALT');
  });
});

// ─── 19. Publish gate ───────────────────────────────────────────────────────

describe('publish is human-gated', () => {
  it('never publishes from a tool call: it requests approval', async () => {
    const r = await call('weave_publish_site', { note: 'Looks ready — ship it?' }) as Record<string, any>;
    expect(r.ok).toBe(true);
    expect(r.status).toBe('awaiting_human_approval');
    const pending = store.get(pendingPublishAtom)!;
    expect(pending.note).toBe('Looks ready — ship it?');
    expect(pending.revision).toBe(currentRevision());
    expect(pending.changeSummary.length).toBeGreaterThan(0);

    expect(await call('weave_publish_site')).toMatchObject({ ok: false, error: { code: 'PUBLISH_ALREADY_PENDING' } });
    cancelPublish();
    expect(store.get(pendingPublishAtom)).toBeNull();
  });

  it('surfaces the pending request in the agent context', async () => {
    await call('weave_publish_site');
    const ctx = await call('weave_get_context') as Record<string, any>;
    expect(ctx.pendingPublish).toMatchObject({ status: 'awaiting_human_approval' });
    cancelPublish();
  });

  it('summarises what an approved publish would ship', () => {
    const cs = proposeChangeSet({ summary: 'Premium pass', operations: [{ op: 'update_text', target: 'hero-title', value: 'New' }], source: 'agent' }).changeset!;
    applyChangeSet(cs.id);
    const summary = buildChangeSummary();
    expect(summary.join(' ')).toContain('Premium pass');
  });

  it('bundles the full source plus manifest and the published-site runtime', () => {
    const bundle = buildPublishBundle();
    expect(bundle.get(FILE)).toContain('section-hero');
    const manifest = JSON.parse(bundle.get('weave.manifest.json')!);
    expect(manifest.format).toBe('weave-capability-manifest');
    expect(manifest.editorTools.length).toBe(getWeaveTools().length);
    expect(manifest.editorTools.length).toBeGreaterThanOrEqual(9);
    expect(manifest.siteTools.map((t: any) => t.name)).toEqual([
      'weave_site_get_context', 'weave_site_read_section', 'weave_site_navigate',
    ]);
    const home = manifest.pages.find((p: any) => p.route === '/');
    expect(home.sections.map((s: any) => s.id)).toEqual(['section-hero', 'section-story']);
    expect(home.sections[0].elements.some((e: any) => e.id === 'hero-title')).toBe(true);
    expect(bundle.get('public/weave-agent.js')).toContain('weave_site_get_context');
    expect(bundle.has('WEAVE-AGENT-README.md')).toBe(true);
  });
});

// ─── 20. Generated capability layer ─────────────────────────────────────────

describe('published-site agent runtime', () => {
  it('is dependency-free, feature-detected and registers only read/navigate tools', () => {
    expect(AGENT_RUNTIME_SOURCE).toContain('document.modelContext');
    expect(AGENT_RUNTIME_SOURCE).toContain('navigator.modelContext');
    // The manifest is found two ways: an inline <script id="weave-manifest">
    // (no network, works from a subdirectory or offline), falling back to a
    // fetch resolved against the script's OWN url — not the domain root, so a
    // site published under /demo/ finds its own manifest rather than someone
    // else's.
    expect(AGENT_RUNTIME_SOURCE).toContain("getElementById('weave-manifest')");
    expect(AGENT_RUNTIME_SOURCE).toContain("weave.manifest.json");
    expect(AGENT_RUNTIME_SOURCE).toContain('document.currentScript');
    expect(AGENT_RUNTIME_SOURCE).not.toContain("fetch('/weave.manifest.json')");
    expect(AGENT_RUNTIME_SOURCE).not.toMatch(/\bimport\s|\brequire\(/);
    // No write path is exposed from a published site.
    expect(AGENT_RUNTIME_SOURCE).not.toMatch(/weave_site_(update|delete|publish)/);
  });

  it('actually runs and registers its tools against a WebMCP runtime', async () => {
    const manifest = buildCapabilityManifest();
    const registered = new Map<string, { execute: (a?: unknown) => Promise<{ structuredContent?: unknown }> }>();
    (document as unknown as { modelContext?: unknown }).modelContext = {
      registerTool: (t: { name: string; execute: never }) => registered.set(t.name, t),
    };
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: true, json: async () => manifest })) as unknown as typeof fetch;
    try {
      // Execute the generated runtime exactly as a published site would.
      new Function(AGENT_RUNTIME_SOURCE)();
      await new Promise((r) => setTimeout(r, 0));
      expect([...registered.keys()].sort()).toEqual([
        'weave_site_get_context', 'weave_site_navigate', 'weave_site_read_section',
      ]);
      const ctx = await registered.get('weave_site_get_context')!.execute({});
      expect((ctx.structuredContent as any).sections.map((s: any) => s.type)).toEqual(['hero', 'story']);
      const bad = await registered.get('weave_site_navigate')!.execute({ route: 'https://evil.example' });
      expect((bad.structuredContent as any).error.code).toBe('UNKNOWN_ROUTE');
    } finally {
      globalThis.fetch = realFetch;
      delete (document as unknown as { modelContext?: unknown }).modelContext;
    }
  });
});

// ─── Activity feed ──────────────────────────────────────────────────────────

describe('activity feed', () => {
  it('records every call with its true source and click-to-locate targets', async () => {
    await call('weave_get_context', {}, 'console');
    await call('weave_update_element', { element_id: 'hero-title', text: 'Traced' }, 'agent');
    const feed = store.get(weaveActivityAtom);
    expect(feed).toHaveLength(2);
    expect(feed[0]).toMatchObject({ tool: 'weave_get_context', source: 'console', kind: 'read', ok: true });
    expect(feed[1]).toMatchObject({ tool: 'weave_update_element', source: 'agent', kind: 'write', ok: true });
    expect(feed[1].targets).toContain('hero-title');
    expect(feed[1].summary).toContain('Title');
    expect(getLastInvocation('weave_update_element')!.source).toBe('agent');
  });
});

// ─── Starter project + utilities ────────────────────────────────────────────

describe('EMBER starter project', () => {
  it('is a clean page-dialect citizen with the demo section order', () => {
    const page = buildStarterPage();
    expect(checkFile(page, { kind: 'page' }).map((v) => `${v.code}: ${v.message}`)).toEqual([]);
    const nodes = parseJSXToNodes(page);
    const root = nodes.get('root')!;
    expect(root.children.map((id) => nodes.get(id)!.name)).toEqual([
      'Hero — Editorial', 'Products', 'Features', 'Testimonials', 'FAQ', 'Call to action', 'Footer',
    ]);
    const ids = [...nodes.keys()];
    expect(new Set(ids).size).toBe(ids.length);
    const files = createWeaveStarterProject();
    expect(files.get('app/page.client.tsx')).toBe(page);
    expect(files.has('app/about/page.client.tsx')).toBe(true);
  });

  it('scores well on agent readiness out of the box', () => {
    resetProjectFS(createWeaveStarterProject());
    const file = 'app/page.client.tsx';
    bump();
    store.set(activeFilePathAtom, file);
    setActiveFilePath(file);
    initMutationQueue(projectFS.readFile(file)!, (c) => { projectFS.writeFile(file, c); bump(); });
    const report = validateSite();
    expect(report.score).toBeGreaterThanOrEqual(70);
    expect(report.checks.find((c) => c.id === 'structure')!.passed).toBe(true);
  });
});

describe('utilities', () => {
  it('maps page files to routes', () => {
    expect(pageFileToRoute('app/page.client.tsx')).toBe('/');
    expect(pageFileToRoute('app/about/page.client.tsx')).toBe('/about');
    expect(pageFileToRoute('app/(shop)/products/page.client.tsx')).toBe('/products');
  });

  it('describes operations in human terms', () => {
    expect(describeOperation({ op: 'update_text', target: 'hero-title', value: 'x' })).toBe('Set text of Title');
    expect(describeOperation({ op: 'add_section', sectionType: 'faq' })).toBe('Add a faq section');
    expect(describeOperation({ op: 'move', target: 'section-story', index: 0 })).toBe('Reorder Story to position 1');
  });

  it('writes a valid store-only zip archive', () => {
    expect(crc32(new TextEncoder().encode('hello'))).toBe(0x3610a686);
    const zip = buildZip(new Map([['a.txt', 'hello'], ['dir/b.json', '{}']]));
    expect([...zip.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect([...zip.slice(-22, -18)]).toEqual([0x50, 0x4b, 0x05, 0x06]);
    expect(new TextDecoder('latin1').decode(zip)).toContain('dir/b.json');
  });

  it('coalesces rapid changes into one revision', () => {
    vi.useFakeTimers();
    resetRevisionForTest(5);
    bumpRevision(); bumpRevision(); bumpRevision();
    vi.advanceTimersByTime(300);
    expect(currentRevision()).toBe(6);
    vi.useRealTimers();
  });
});
