// tools-advanced.test.ts — the extended tool surface against the REAL editor.
//
// Same harness as weave.test.ts: the actual jotai store, parser, mutation
// queue, paste engine and undo history over an in-memory ProjectFS seeded with
// the EMBER starter. Every tool is called through `executeWeaveTool` — the
// dispatcher an external agent reaches over WebMCP — so what passes here is
// what an agent can actually do.
//
// The point of each test is the OUTCOME in the project, not the tool's return
// value: a link tool that returns ok while writing nothing would pass a
// shallow test and fail a human.

import { describe, it, expect, beforeEach } from 'vitest';
import { getDefaultStore } from 'jotai';
import { projectFS, resetProjectFS, projectVersionAtom } from '@/code/project/project-fs';
import { setActiveFilePath, initMutationQueue, syncQueueCode } from '@/code/mutation/mutation-queue';
import { initHistory, sealPendingHistory, pushHistory } from '@/code/mutation/history';
import { setBumpVersion } from '@/code/project/modify-file';
import { nodesAtom, selectedIdsAtom } from '@/code/stores/store';
import { activeFilePathAtom } from '@/code/project/active-file-store';
import { getPageVariables } from '@/code/features/page-variables';
import { parseAllPageInteractions } from '@/code/features/page-interactions';
import { getCollectionData, listCollections } from '@/code/project/cms-ops';
import { getI18nConfig } from '@/code/project/locale-ops';

import './tools';
import './tools-advanced';
import { executeWeaveTool, getWeaveTools, applicableTools, registrableTools } from './webmcp/registry';
import { createWeaveStarterProject, STARTER_HERO_ID } from './starter-project';
import { resetRevisionForTest, currentRevision, subscribeRevision } from './revision';
import { resetChangeSetsForTest, applyChangeSet, getChangeSet } from './changeset';
import { resetPublishStateForTest } from './publish';
import { weaveActivityAtom, lastValidationAtom } from './store';
import { validateOperation, operationSchemas, OPERATION_KINDS, type WeaveOperation } from './commands';

const FILE = 'app/page.client.tsx';
const store = getDefaultStore();
const bump = (): void => store.set(projectVersionAtom, (v) => v + 1);

function seed(): void {
  resetProjectFS(createWeaveStarterProject());
  bump();
  store.set(activeFilePathAtom, FILE);
  setActiveFilePath(FILE);
  setBumpVersion(() => bump());
  const code = projectFS.readFile(FILE)!;
  // The editor's flush callback writes the file AND records history; without
  // the second half nothing an agent does would be undoable.
  initMutationQueue(code, (c) => { projectFS.writeFile(FILE, c); pushHistory(c); bump(); });
  initHistory(
    code,
    (c) => { syncQueueCode(c); bump(); },
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
  // The revision counter follows project writes; the editor wires this at
  // startup, so the harness does too or every revision read stays at 1.
  subscribeRevision();
}

const call = (name: string, args?: unknown, source: 'agent' | 'console' = 'console') =>
  executeWeaveTool(name, args, source);
const nodes = () => store.get(nodesAtom);
const node = (id: string) => nodes().get(id);
const source = () => projectFS.readFile(FILE) ?? '';
/** A real text element inside the hero — not the decorative backdrop layers. */
const heroText = (): string => {
  const walk = (id: string): string | null => {
    const n = node(id);
    if (!n) return null;
    if ((n.textContent ?? '').trim().length > 3) return n.id;
    for (const c of n.children ?? []) { const hit = walk(c); if (hit) return hit; }
    return null;
  };
  return walk(STARTER_HERO_ID)!;
};

beforeEach(() => { seed(); });

// ─── 1. Discovery ───────────────────────────────────────────────────────────

describe('finding elements', () => {
  it('finds by text, role and section, and returns actionable ids', async () => {
    const byRole = await call('weave_find_elements', { role: 'heading' });
    expect(byRole.ok).toBe(true);
    const matches = (byRole as unknown as { matches: Array<{ id: string; role: string; section: string }> }).matches;
    expect(matches.length).toBeGreaterThan(0);
    // Every id is real and every match carries the section it lives in.
    for (const m of matches) {
      expect(node(m.id)).toBeTruthy();
      expect(m.section).toBeTruthy();
    }

    const text = (node(heroText())!.textContent ?? '').slice(0, 8);
    const byText = await call('weave_find_elements', { text });
    expect((byText as unknown as { count: number }).count).toBeGreaterThan(0);

    const scoped = await call('weave_find_elements', { role: 'heading', in_section: STARTER_HERO_ID });
    const scopedIds = (scoped as unknown as { matches: Array<{ id: string }> }).matches.map((m) => m.id);
    expect(scopedIds.length).toBeLessThanOrEqual(matches.length);
  });

  it('refuses a search with no criteria rather than returning the whole page', async () => {
    const result = await call('weave_find_elements', {});
    expect(result.ok).toBe(false);
    expect((result as { error: { code: string } }).error.code).toBe('INVALID_ARGS');
  });
});

// ─── 2. Structure ───────────────────────────────────────────────────────────

describe('structural editing', () => {
  it('duplicates a section, and the copy is independent of the original', async () => {
    const before = node('root')!.children.length;
    const result = await call('weave_duplicate_element', { element_id: STARTER_HERO_ID });
    expect(result.ok).toBe(true);
    expect(node('root')!.children.length).toBe(before + 1);

    const created = (result as unknown as { created: string[] }).created;
    expect(created.length).toBe(1);
    expect(created[0]).not.toBe(STARTER_HERO_ID);
    // Editing the copy must not touch the original.
    const originalText = node(heroText())!.textContent;
    await call('weave_update_element', { element_id: created[0], name: 'Copy' });
    expect(node(heroText())!.textContent).toBe(originalText);
  });

  it('groups siblings into one container, preserving their order', async () => {
    const hero = node(STARTER_HERO_ID)!;
    const kids = hero.children.slice(0, 2);
    const result = await call('weave_group_elements', { element_ids: kids, name: 'Stack' });
    expect(result.ok).toBe(true);

    const created = (result as unknown as { created: string }).created;
    expect(node(created)!.children).toEqual(kids);
    expect(node(kids[0])!.parentId).toBe(created);
  });

  it('refuses to group elements that do not share a parent', async () => {
    const hero = node(STARTER_HERO_ID)!;
    const outsider = node('root')!.children.find((c) => c !== STARTER_HERO_ID)!;
    const result = await call('weave_group_elements', { element_ids: [hero.children[0], outsider] });
    expect(result.ok).toBe(false);
    expect((result as { error: { message: string } }).error.message).toMatch(/same parent/i);
  });

  it('ungroups a container back into its parent, keeping the children', async () => {
    const hero = node(STARTER_HERO_ID)!;
    const kids = hero.children.slice(0, 2);
    const grouped = await call('weave_group_elements', { element_ids: kids });
    const wrapper = (grouped as unknown as { created: string }).created;

    const result = await call('weave_ungroup_element', { element_id: wrapper });
    expect(result.ok).toBe(true);
    expect(node(wrapper)).toBeUndefined();
    for (const kid of kids) expect(node(kid)!.parentId).toBe(STARTER_HERO_ID);
  });

  it('retags an element to a semantic one and keeps its content', async () => {
    const id = heroText();
    const text = node(id)!.textContent;
    const result = await call('weave_change_element_tag', { element_id: id, tag: 'h2' });
    expect(result.ok).toBe(true);
    expect(node(id)!.type).toBe('h2');
    expect(node(id)!.textContent).toBe(text);
  });

  it('refuses to retag to something that could load or execute code', async () => {
    for (const tag of ['script', 'iframe', 'object', 'input']) {
      // Refused twice over: the tool's schema enum rejects it before dispatch,
      // and the pipeline refuses it again even if a caller reaches past the
      // schema. Both layers are asserted because either alone is one bug from
      // being the only thing standing between an agent and a <script> tag.
      const viaTool = await call('weave_change_element_tag', { element_id: heroText(), tag });
      expect(viaTool.ok, `tool should refuse <${tag}>`).toBe(false);

      const viaPipeline = validateOperation({ op: 'change_tag', target: heroText(), tag } as WeaveOperation);
      expect(viaPipeline?.code, `pipeline should refuse <${tag}>`).toBe('UNSUPPORTED_TAG');
    }
  });
});

// ─── 3. Linking ─────────────────────────────────────────────────────────────

describe('linking', () => {
  it('converts a non-link element and gives it a destination', async () => {
    const id = heroText();
    expect(node(id)!.type).not.toMatch(/Link/);

    const result = await call('weave_set_link', { element_id: id, href: '/about' });
    expect(result.ok).toBe(true);
    expect(node(id)!.type).toMatch(/Link/);
    expect(node(id)!.attrs.href).toBe('/about');
    expect(source()).toContain('/about');
  });

  it('refuses destinations that could execute code', async () => {
    for (const href of ['javascript:alert(1)', 'data:text/html,<script>x</script>', 'vbscript:x']) {
      const result = await call('weave_set_link', { element_id: heroText(), href });
      expect(result.ok).toBe(false);
      expect((result as { error: { code: string } }).error.code).toBe('UNSUPPORTED_ATTR');
    }
  });

  it('accepts routes, anchors, external addresses, mail and phone', async () => {
    for (const href of ['/about', '#pricing', 'https://example.com', 'mailto:a@b.co', 'tel:+1234']) {
      seed();
      const result = await call('weave_set_link', { element_id: heroText(), href });
      expect(result.ok, `href ${href} should be accepted`).toBe(true);
    }
  });
});

// ─── 4. Pages ───────────────────────────────────────────────────────────────

describe('multi-page authoring', () => {
  it('lists pages with their routes and marks the open one', async () => {
    const result = await call('weave_list_pages');
    expect(result.ok).toBe(true);
    const pages = (result as unknown as { pages: Array<{ route: string; active: boolean }> }).pages;
    expect(pages.some((p) => p.route === '/' && p.active)).toBe(true);
  });

  it('creates a page, opens it, and the open page is what edits apply to', async () => {
    const created = await call('weave_create_page', { name: 'Pricing' });
    expect(created.ok).toBe(true);
    const route = (created as unknown as { route: string }).route;
    expect(route).toContain('pricing');

    const opened = await call('weave_open_page', { route });
    expect(opened.ok).toBe(true);
    expect(store.get(activeFilePathAtom)).toContain('pricing');

    // The new page is empty, so the hero of the old page must be gone.
    expect(node(STARTER_HERO_ID)).toBeUndefined();

    // An edit here lands in the NEW page's source, not the home page's.
    const added = await call('weave_add_section', { section_type: 'pricing' });
    expect(added.ok).toBe(true);
    expect(projectFS.readFile('app/page.client.tsx')).not.toContain('Pricing tiers');
  });

  it('refuses to delete the home page or the page being edited', async () => {
    const home = await call('weave_delete_page', { route: '/' });
    expect(home.ok).toBe(false);
    expect((home as { error: { code: string } }).error.code).toBe('CANNOT_DELETE_HOME');

    const created = await call('weave_create_page', { name: 'Temp' });
    const route = (created as unknown as { route: string }).route;
    await call('weave_open_page', { route });
    const open = await call('weave_delete_page', { route });
    expect(open.ok).toBe(false);
    expect((open as { error: { code: string } }).error.code).toBe('PAGE_IS_OPEN');
  });

  it('deletes a page that is not open, and it disappears from the site', async () => {
    const created = await call('weave_create_page', { name: 'Scratch' });
    const route = (created as unknown as { route: string }).route;
    const before = (await call('weave_list_pages') as unknown as { pages: unknown[] }).pages.length;

    const deleted = await call('weave_delete_page', { route });
    expect(deleted.ok).toBe(true);
    const after = (await call('weave_list_pages') as unknown as { pages: unknown[] }).pages.length;
    expect(after).toBe(before - 1);
  });

  it('reports a route that does not exist rather than guessing', async () => {
    const result = await call('weave_open_page', { route: '/nope' });
    expect(result.ok).toBe(false);
    expect((result as { error: { code: string } }).error.code).toBe('PAGE_NOT_FOUND');
  });
});

// ─── 5. History ─────────────────────────────────────────────────────────────

describe('undo and redo', () => {
  it('undoes an agent edit and redoes it', async () => {
    const id = heroText();
    const original = node(id)!.textContent;
    // A single edit is debounced into the pending history entry, the same way
    // a human's keystrokes coalesce. The editor seals it on a gesture
    // boundary; here we seal it explicitly so there is something to undo.
    await call('weave_update_element', { element_id: id, text: 'Changed by the agent' });
    sealPendingHistory();
    expect(node(id)!.textContent).toBe('Changed by the agent');

    const undone = await call('weave_undo');
    expect(undone.ok).toBe(true);
    expect(node(id)!.textContent).toBe(original);

    const redone = await call('weave_redo');
    expect(redone.ok).toBe(true);
    expect(node(id)!.textContent).toBe('Changed by the agent');
  });

  it('says so plainly when there is nothing to undo', async () => {
    const result = await call('weave_undo');
    expect(result.ok).toBe(false);
    expect((result as { error: { code: string } }).error.code).toBe('NOTHING_TO_UNDO');
  });
});

// ─── 6. Design system ───────────────────────────────────────────────────────

describe('design tokens', () => {
  it('creates a token, lists it back, and updates it in place', async () => {
    const created = await call('weave_set_design_token', { name: 'brand-primary', value: '#6366f1', category: 'color' });
    expect(created.ok).toBe(true);
    expect(projectFS.readFile('app/globals.css') ?? '').toContain('--brand-primary');

    const listed = await call('weave_list_design_tokens');
    const tokens = (listed as unknown as { tokens: Array<{ name: string; value: string }> }).tokens;
    expect(tokens.find((t) => t.name === 'brand-primary')?.value).toBe('#6366f1');

    await call('weave_set_design_token', { name: 'brand-primary', value: '#ef4444' });
    const after = (await call('weave_list_design_tokens') as unknown as { tokens: Array<{ name: string; value: string }> }).tokens;
    expect(after.find((t) => t.name === 'brand-primary')?.value).toBe('#ef4444');
    // Updating must not create a second declaration.
    expect(after.filter((t) => t.name === 'brand-primary')).toHaveLength(1);
  });

  it('refuses a token value that smuggles executable CSS', async () => {
    const result = await call('weave_set_design_token', { name: 'x', value: 'url(javascript:alert(1))' });
    expect(result.ok).toBe(false);
  });
});

// ─── 7. Behaviour ───────────────────────────────────────────────────────────

describe('variables and interactions', () => {
  it('creates a variable, binds a style to it and drives it from a click', async () => {
    const id = heroText();

    const variable = await call('weave_set_variable', { name: 'heroFade', value: '1', type: 'number' });
    expect(variable.ok).toBe(true);
    expect(getPageVariables(source()).map((v) => v.name)).toContain('heroFade');

    const bound = await call('weave_bind_style_variable', { element_id: id, property: 'opacity', variable: 'heroFade' });
    expect(bound.ok).toBe(true);

    const interaction = await call('weave_add_interaction', { element_id: id, trigger: 'click', variable: 'heroFade', value: '0.5' });
    expect(interaction.ok).toBe(true);

    const parsed = parseAllPageInteractions(source());
    expect(parsed.some((i) => i.nodeId === id && i.trigger === 'click' && i.varName === 'heroFade')).toBe(true);

    // And the agent can read the behaviour back.
    const behaviour = await call('weave_get_page_behaviour');
    const read = behaviour as unknown as { variables: Array<{ name: string }>; interactions: Array<{ sets: string }> };
    expect(read.variables.map((v) => v.name)).toContain('heroFade');
    expect(read.interactions.map((i) => i.sets)).toContain('heroFade');
  });

  it('refuses to bind or drive a variable that does not exist', async () => {
    const bound = await call('weave_bind_style_variable', { element_id: heroText(), property: 'opacity', variable: 'ghost' });
    expect(bound.ok).toBe(false);
    expect((bound as { error: { code: string } }).error.code).toBe('VARIABLE_NOT_FOUND');
  });

  it('refuses to bind a style property outside the safe set', async () => {
    await call('weave_set_variable', { name: 'x', value: '1' });
    const result = await call('weave_bind_style_variable', { element_id: heroText(), property: 'position', variable: 'x' });
    expect(result.ok).toBe(false);
    expect((result as { error: { code: string } }).error.code).toBe('UNSUPPORTED_STYLE');
  });
});

// ─── 8. Motion ──────────────────────────────────────────────────────────────

describe('animation', () => {
  it('adds an appear animation with a derived starting state, then removes it', async () => {
    const added = await call('weave_animate_element', {
      element_id: STARTER_HERO_ID, kind: 'appear', properties: { opacity: '1' }, duration: 0.6, ease: 'easeOut',
    });
    expect(added.ok).toBe(true);
    expect(source()).toContain('whileInView');
    // The hidden state is derived, so the element actually fades IN.
    expect(source()).toContain('initial');

    const removed = await call('weave_remove_animation', { element_id: STARTER_HERO_ID, kind: 'appear' });
    expect(removed.ok).toBe(true);
    expect(source()).not.toContain('whileInView');
  });

  it('adds a hover animation', async () => {
    const result = await call('weave_animate_element', {
      element_id: STARTER_HERO_ID, kind: 'hover', properties: { scale: '1.02' },
    });
    expect(result.ok).toBe(true);
    expect(source()).toContain('whileHover');
  });

  it('refuses motion properties that could move content out of the layout', async () => {
    for (const prop of ['position', 'display', 'zIndex']) {
      const result = await call('weave_animate_element', {
        element_id: STARTER_HERO_ID, kind: 'appear', properties: { [prop]: 'absolute' },
      });
      expect(result.ok).toBe(false);
      expect((result as { error: { code: string } }).error.code).toBe('UNSUPPORTED_MOTION');
    }
  });
});

// ─── 9. Translation ─────────────────────────────────────────────────────────

describe('translation', () => {
  it('adds a language, translates an element, and reads it back without losing the original', async () => {
    const added = await call('weave_add_locale', { code: 'hi', label: 'Hindi' });
    expect(added.ok).toBe(true);
    expect(getI18nConfig().locales.map((l) => l.code)).toContain('hi');

    const id = heroText();
    const original = node(id)!.textContent;

    const translated = await call('weave_translate_element', { element_id: id, locale: 'hi', text: 'नमस्ते' });
    expect(translated.ok).toBe(true);

    const read = await call('weave_read_translation', { element_id: id, locale: 'hi' });
    expect((read as unknown as { translated: string }).translated).toBe('नमस्ते');

    // Translating BINDS the element to a message key: its text now lives in
    // messages/<locale>.json rather than in the JSX. The original wording is
    // preserved as the default-locale message — nothing is lost, and the live
    // site still renders it for visitors on the default locale.
    expect(node(id)!.translationKey).toBe(id);
    expect(projectFS.readFile('messages/en.json') ?? '').toContain(original ?? '');
    expect(projectFS.readFile('messages/hi.json') ?? '').toContain('नमस्ते');
  });

  it('refuses a language the site does not have', async () => {
    const result = await call('weave_translate_element', { element_id: heroText(), locale: 'zz', text: 'x' });
    expect(result.ok).toBe(false);
    expect((result as { error: { code: string } }).error.code).toBe('LOCALE_NOT_FOUND');
  });

  it('rejects a malformed language code', async () => {
    const result = await call('weave_add_locale', { code: 'not-a-locale-code', label: 'X' });
    expect(result.ok).toBe(false);
  });
});

// ─── 10. Content collections ────────────────────────────────────────────────

describe('content collections', () => {
  it('lists collections with their fields', async () => {
    const result = await call('weave_list_collections');
    expect(result.ok).toBe(true);
    const collections = (result as unknown as { collections: Array<{ slug: string }> }).collections;
    expect(collections.length).toBe(listCollections().length);
    expect(collections.length).toBeGreaterThan(0);
  });

  it('adds an item, then updates it in place', async () => {
    const slug = listCollections()[0];
    const fields = (await call('weave_list_collections', { collection: slug }) as unknown as {
      fields: Array<{ id: string; type: string }>;
    }).fields;
    const textField = fields.find((f) => f.type === 'text')!;

    const before = getCollectionData(slug).length;
    const added = await call('weave_upsert_collection_item', {
      collection: slug, values: { [textField.id]: 'Added by the agent' },
    });
    expect(added.ok).toBe(true);
    expect(getCollectionData(slug).length).toBe(before + 1);

    const itemId = (added as unknown as { itemId: string }).itemId;
    const updated = await call('weave_upsert_collection_item', {
      collection: slug, item_id: itemId, values: { [textField.id]: 'Edited by the agent' },
    });
    expect(updated.ok).toBe(true);
    expect(getCollectionData(slug).length).toBe(before + 1);
    expect(getCollectionData(slug).find((i) => i._id === itemId)![textField.id]).toBe('Edited by the agent');

    const removed = await call('weave_remove_collection_item', { collection: slug, item_id: itemId });
    expect(removed.ok).toBe(true);
    expect(getCollectionData(slug).length).toBe(before);
  });

  it('refuses a field the collection does not define', async () => {
    const slug = listCollections()[0];
    const result = await call('weave_upsert_collection_item', { collection: slug, values: { notAField: 'x' } });
    expect(result.ok).toBe(false);
    expect((result as { error: { code: string } }).error.code).toBe('UNKNOWN_FIELD');
  });

  it('refuses a collection that does not exist', async () => {
    const result = await call('weave_upsert_collection_item', { collection: 'ghosts', values: {} });
    expect(result.ok).toBe(false);
    expect((result as { error: { code: string } }).error.code).toBe('COLLECTION_NOT_FOUND');
  });
});

// ─── 11. Review notes ───────────────────────────────────────────────────────

describe('comments', () => {
  it('leaves a note without changing the page, and reads it back', async () => {
    const id = heroText();
    const before = source();

    const left = await call('weave_add_comment', { element_id: id, text: 'This headline reads oddly.' });
    expect(left.ok).toBe(true);
    // A note is not an edit.
    expect(source()).toBe(before);

    const listed = await call('weave_list_comments');
    const comments = (listed as unknown as { comments: Array<{ text: string }> }).comments;
    expect(comments.some((c) => c.text.includes('reads oddly'))).toBe(true);
  });

  it('needs something to say', async () => {
    const result = await call('weave_add_comment', { text: '   ' });
    expect(result.ok).toBe(false);
  });
});

// ─── 12. Components ─────────────────────────────────────────────────────────

describe('components', () => {
  it('promotes an element to a component and places a second copy of it', async () => {
    const hero = node(STARTER_HERO_ID)!;
    const target = hero.children[0];

    const created = await call('weave_create_component', { element_id: target, name: 'HeroBlock' });
    expect(created.ok).toBe(true);
    expect(projectFS.listFiles().some((f) => f.startsWith('components/'))).toBe(true);

    const listed = await call('weave_list_components');
    const names = (listed as unknown as { components: Array<{ name: string }> }).components.map((c) => c.name);
    expect(names.length).toBeGreaterThan(0);

    const placed = await call('weave_insert_component', { component: names[0] });
    expect(placed.ok).toBe(true);
    expect((placed as unknown as { created: string[] }).created.length).toBeGreaterThan(0);
  });

  it('rejects a component name that is not a valid identifier', async () => {
    const result = await call('weave_create_component', { element_id: STARTER_HERO_ID, name: '2 bad name!' });
    expect(result.ok).toBe(false);
    expect((result as { error: { code: string } }).error.code).toBe('INVALID_ARGS');
  });

  it('reports a component that does not exist', async () => {
    const result = await call('weave_insert_component', { component: 'Nope' });
    expect(result.ok).toBe(false);
    expect((result as { error: { code: string } }).error.code).toBe('COMPONENT_NOT_FOUND');
  });
});

// ─── 13. Deeper reads ───────────────────────────────────────────────────────

describe('reads', () => {
  it('reads declared styles even when the canvas cannot resolve computed ones', async () => {
    const result = await call('weave_get_element_styles', { element_id: heroText() });
    expect(result.ok).toBe(true);
    const read = result as unknown as { declared: Record<string, string>; element: { id: string } };
    expect(read.element.id).toBe(heroText());
    expect(Object.keys(read.declared).length).toBeGreaterThan(0);
  });

  it('reads a bounded subtree and stops at the requested depth', async () => {
    const shallow = await call('weave_get_subtree', { element_id: STARTER_HERO_ID, depth: 1 });
    const deep = await call('weave_get_subtree', { element_id: STARTER_HERO_ID, depth: 6 });
    expect(shallow.ok && deep.ok).toBe(true);

    const shallowCount = (shallow as unknown as { nodeCount: number }).nodeCount;
    const deepCount = (deep as unknown as { nodeCount: number }).nodeCount;
    expect(deepCount).toBeGreaterThan(shallowCount);

    // At depth 1 the children are summarised rather than expanded, so an agent
    // knows there is more to read without paying for it.
    const tree = (shallow as unknown as { tree: { children: unknown } }).tree;
    expect(typeof tree.children).toBe('string');
    expect(String(tree.children)).toMatch(/more, deeper/);
  });

  it('reports what changed since an earlier revision', async () => {
    const at = currentRevision();
    const unchanged = await call('weave_diff_since', { revision: at });
    expect((unchanged as unknown as { changed: boolean }).changed).toBe(false);

    await call('weave_update_element', { element_id: heroText(), text: 'Moved on' }, 'agent');
    const changed = await call('weave_diff_since', { revision: at });
    expect((changed as unknown as { changed: boolean }).changed).toBe(true);
    expect((changed as unknown as { changes: unknown[] }).changes.length).toBeGreaterThan(0);
  });

  it('refuses a revision from the future', async () => {
    const result = await call('weave_diff_since', { revision: currentRevision() + 500 });
    expect(result.ok).toBe(false);
  });

  it('reads recent activity with the true source of each action', async () => {
    await call('weave_update_element', { element_id: heroText(), text: 'By an agent' }, 'agent');
    const result = await call('weave_get_history', { limit: 5 });
    const activity = (result as unknown as { activity: Array<{ by: string; summary: string }> }).activity;
    expect(activity.length).toBeGreaterThan(0);
    expect(activity.some((a) => a.by === 'agent')).toBe(true);
  });

  it('turns validation findings into operations that are actually valid', async () => {
    const result = await call('weave_explain_finding');
    expect(result.ok).toBe(true);
    const findings = (result as unknown as {
      findings: Array<{ suggestedOperations: WeaveOperation[] }>;
    }).findings;

    // Whatever it suggests must survive the same validation a real call faces —
    // a suggestion an agent cannot submit is worse than none.
    for (const finding of findings) {
      for (const operation of finding.suggestedOperations) {
        expect(validateOperation(operation), `suggested ${operation.op} should validate`).toBeNull();
      }
    }
  });
});

// ─── 14. Everything composes with proposals, staleness and undo ─────────────

describe('the new operations behave like the original ones', () => {
  it('a proposal mixing new and old operations applies atomically as one revision', async () => {
    const id = heroText();
    const proposal = await call('weave_propose_changes', {
      summary: 'Restructure the hero',
      operations: [
        { op: 'update_text', target: id, value: 'Objects for slow rooms' },
        { op: 'change_tag', target: id, tag: 'h1' },
        { op: 'set_link', target: id, href: '/about' },
        { op: 'set_metadata', title: 'EMBER — Ceramics' },
      ],
    }, 'agent');
    expect(proposal.ok).toBe(true);

    // Nothing has changed yet.
    expect(node(id)!.textContent).not.toBe('Objects for slow rooms');

    const changesetId = (proposal as unknown as { changeset: { id: string } }).changeset.id;
    const revisionBefore = currentRevision();
    const applied = applyChangeSet(changesetId);
    expect(applied.ok).toBe(true);

    expect(node(id)!.textContent).toBe('Objects for slow rooms');
    expect(node(id)!.type).toMatch(/Link/);
    // One transaction, one revision.
    expect(currentRevision()).toBe(revisionBefore + 1);
  });

  it('rolls back completely when a later operation in the set fails', async () => {
    const id = heroText();
    const originalText = node(id)!.textContent;
    const proposal = await call('weave_propose_changes', {
      summary: 'Half-valid set',
      operations: [
        { op: 'update_text', target: id, value: 'Should not survive' },
        { op: 'change_tag', target: id, tag: 'script' },
      ],
    }, 'agent');

    // The bad operation is caught when the set is proposed, not after a
    // partial write — but assert the page is untouched either way.
    if (proposal.ok) {
      const changesetId = (proposal as unknown as { changeset: { id: string } }).changeset.id;
      const applied = applyChangeSet(changesetId);
      expect(applied.ok).toBe(false);
      expect(getChangeSet(changesetId)?.status).not.toBe('applied');
    }
    expect(node(id)!.textContent).toBe(originalText);
  });

  it('one undo reverses a whole mixed transaction', async () => {
    const id = heroText();
    const originalText = node(id)!.textContent;
    const originalTag = node(id)!.type;

    const proposal = await call('weave_propose_changes', {
      summary: 'Two changes at once',
      operations: [
        { op: 'update_text', target: id, value: 'Changed' },
        { op: 'change_tag', target: id, tag: 'h3' },
      ],
    }, 'agent');
    applyChangeSet((proposal as unknown as { changeset: { id: string } }).changeset.id);
    expect(node(id)!.textContent).toBe('Changed');

    const undone = await call('weave_undo');
    expect(undone.ok).toBe(true);
    expect(node(id)!.textContent).toBe(originalText);
    expect(node(id)!.type).toBe(originalTag);
  });

  it('publishes a machine-readable schema for every operation it accepts', () => {
    // The whole point: an agent can build a ChangeSet from the schema alone,
    // without parsing prose. If an operation exists in the validator but not
    // in the published grammar, it is invisible — so the two must stay level.
    const schemas = operationSchemas();
    const documented = schemas.map((x) => (x.properties as { op: { const: string } }).op.const).sort();
    expect(documented).toEqual([...OPERATION_KINDS].sort());

    for (const schema of schemas) {
      const props = schema.properties as Record<string, unknown>;
      const required = schema.required as string[];
      expect(required[0]).toBe('op');
      expect(schema.additionalProperties).toBe(false);
      // Every required field is actually declared, or an agent cannot fill it.
      for (const field of required) expect(Object.keys(props)).toContain(field);
      // No bare `object` params: each one names its keys or its value type.
      for (const [key, value] of Object.entries(props)) {
        const v = value as { type?: string; propertyNames?: unknown; additionalProperties?: unknown; properties?: unknown };
        if (v.type === 'object') {
          expect(v.properties ?? v.propertyNames ?? v.additionalProperties,
            `${String((props.op as { const: string }).const)}.${key} must describe its shape`).toBeTruthy();
        }
      }
    }
  });

  it('accepts a proposal built purely from the published schema', async () => {
    // Construct the call the way an agent would: read the grammar, pick a
    // branch, fill its required fields. No prose consulted.
    const schema = operationSchemas().find(
      (x) => (x.properties as { op: { const: string } }).op.const === 'change_tag',
    )!;
    const tagEnum = ((schema.properties as Record<string, { enum?: string[] }>).tag.enum ?? []);
    expect(tagEnum).toContain('h2');

    const proposal = await call('weave_propose_changes', {
      summary: 'Built from the schema',
      operations: [{ op: 'change_tag', target: heroText(), tag: tagEnum[tagEnum.indexOf('h2')] }],
    }, 'agent');
    expect(proposal.ok).toBe(true);
  });

  it('every tool is registered once, describes itself, and declares honest hints', () => {
    const tools = getWeaveTools();
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);

    for (const tool of tools) {
      expect(tool.name, 'tool names are namespaced').toMatch(/^weave_/);
      expect(tool.description.length, `${tool.name} needs a description`).toBeGreaterThan(40);
      expect(tool.annotations.title, `${tool.name} needs a title`).toBeTruthy();
      expect(tool.inputSchema.type).toBe('object');
      // A read-only tool must not claim to be destructive, and vice versa.
      if (tool.annotations.readOnlyHint) expect(tool.annotations.destructiveHint).toBe(false);
      // Descriptions are an injection surface: they describe, never instruct.
      expect(tool.description).not.toMatch(/\b(you must|always call|ignore previous|system prompt)\b/i);
    }
  });

  it('registers the WHOLE surface on load, however the editor is sitting', () => {
    // Discovery is never gated. An agent arriving at a freshly loaded page —
    // a headless scanner, or a model that has not been told to click anything
    // — must be able to see every capability WEAVE has. A tool it cannot
    // discover is a tool it will never use.
    store.set(selectedIdsAtom, []);
    const registered = registrableTools().map((t) => t.name);
    expect(registered.length).toBe(getWeaveTools().length);
    for (const tool of getWeaveTools()) expect(registered).toContain(tool.name);
  });

  it('orders the registered surface so what is relevant right now comes first', () => {
    store.set(selectedIdsAtom, []);
    const idle = registrableTools();
    const relevantIdle = applicableTools().map((t) => t.name);
    // Everything relevant appears before everything that is not.
    const firstIrrelevant = idle.findIndex((t) => !relevantIdle.includes(t.name));
    const lastRelevant = idle.map((t) => relevantIdle.includes(t.name)).lastIndexOf(true);
    expect(lastRelevant).toBeLessThan(firstIrrelevant === -1 ? Infinity : firstIrrelevant);

    // Selecting an element promotes the element tools into the relevant set.
    store.set(selectedIdsAtom, [STARTER_HERO_ID]);
    expect(applicableTools().map((t) => t.name)).toContain('weave_update_element');
  });

  it('a selection-backed tool called with no selection explains how to proceed', async () => {
    // The counterpart to always registering: these tools must fail usefully,
    // not merely fail. The message has to name the way forward.
    store.set(selectedIdsAtom, []);
    const cases: Array<[string, Record<string, unknown>]> = [
      ['weave_update_element', { text: 'x' }],
      ['weave_set_link', { href: '/about' }],
      ['weave_duplicate_element', {}],
      ['weave_change_element_tag', { tag: 'h2' }],
      ['weave_get_element_styles', {}],
    ];
    for (const [name, args] of cases) {
      const result = await call(name, args);
      expect(result.ok, `${name} should refuse without a target`).toBe(false);
      const error = (result as { error: { code: string; message: string } }).error;
      expect(error.code).toBe('NO_TARGET');
      expect(error.message).toMatch(/element_id/);
      expect(error.message).toMatch(/weave_find_elements/);
    }
  });

  it('the surface stays adaptive as the project gains capabilities', () => {
    store.set(selectedIdsAtom, []);
    const idle = applicableTools().map((t) => t.name);
    store.set(selectedIdsAtom, [STARTER_HERO_ID]);
    const selected = applicableTools().map((t) => t.name);

    // Selecting something reveals the element-scoped tools and nothing is lost.
    expect(selected.length).toBeGreaterThan(idle.length);
    for (const name of idle) expect(selected).toContain(name);

    // Element tools are genuinely hidden with no selection.
    expect(idle).not.toContain('weave_update_element');
    expect(idle).not.toContain('weave_screenshot_element');
    expect(selected).toContain('weave_update_element');

    // Language tools appear only once the site has more than one language.
    expect(idle).not.toContain('weave_list_locales');
  });
});

// Reported for the README so the documented counts cannot drift from the code.
describe('surface report', () => {
  it('prints the exposed surface for the EMBER starter', () => {
    store.set(selectedIdsAtom, []);
    const idle = applicableTools().map((t) => t.name);
    store.set(selectedIdsAtom, [STARTER_HERO_ID]);
    const selected = applicableTools().map((t) => t.name);
    console.log([
      '',
      `  tools defined                 ${getWeaveTools().length}`,
      `  exposed, nothing selected     ${idle.length}`,
      `  exposed, element selected     ${selected.length}  (+${selected.length - idle.length})`,
      `  hidden until selection        ${getWeaveTools().length - selected.length} more, gated on project capabilities`,
      '',
    ].join('\n'));
    expect(getWeaveTools().length).toBeGreaterThanOrEqual(48);
  });
});
