// WEAVE addition (not upstream Revyme) — see src/weave/README.md.
//
// tools-advanced.ts — the second half of the WEAVE WebMCP tool surface.
//
// `tools.ts` holds the nine core tools an agent needs to read a page and
// change one element. This module adds the capabilities that make WEAVE a
// whole authoring surface rather than a text editor: finding elements,
// multi-page authoring, structure (duplicate / group / retag / link), the
// design system, behaviour and motion, translation, content collections,
// review comments, history, and the deeper reads an agent needs to reason
// well (resolved styles, a bounded subtree, a revision diff, a screenshot).
//
// Every write here goes through the SAME `WeaveOperation` pipeline as the
// core tools, so each one is proposable, atomically appliable, refused when
// stale, and reversible in a single undo. Nothing in this file writes to the
// project directly.
//
// Descriptions state product intent and carry no instructions to the model —
// a tool description is an injection surface.

import { getDefaultStore } from 'jotai';
import { nodesAtom, selectedIdsAtom, updatingFromCanvasAtom } from '@/code/stores/store';
import { interactingViewportIdAtom } from '@/code/stores/viewport-store';
import { projectFS } from '@/code/project/project-fs';
import {
  activeFilePathAtom, createPageFile, deletePageFile, switchActiveFile,
} from '@/code/project/active-file-store';
import { syncQueueCode, flushNow, setActiveFilePath } from '@/code/mutation/mutation-queue';
import { undo, redo, getHistoryState } from '@/code/mutation/history';
import { getCanvasBridge } from '@/canvas/canvas-bridge';
import { getViewportPrefix } from '@/canvas/node-ops';
import { getI18nConfig, addLocale } from '@/code/project/locale-ops';
import { readTranslationText } from '@/code/project/translation-ops';
import { getPageVariables } from '@/code/features/page-variables';
import { parseAllPageInteractions, INTERACTION_TRIGGERS } from '@/code/features/page-interactions';
import {
  listCollections, getCollectionSchema, getCollectionData,
} from '@/code/project/cms-ops';
import { commentOps, allCommentsAtom } from '@/code/stores/comment-store';
import { makeComponent } from '@/code/components/component-ops';
import { buildInstanceClipboardNode, insertNodes } from '@/canvas/insertion-bridge';
import { trace } from '@/shared/debug-trace';

import {
  executeOperation, getNode, syncQueueToActiveFile,
  ALLOWED_TAGS, ANIMATION_KINDS, PAGE_VARIABLE_TYPES,
  type WeaveOperation,
} from './commands';
import { pageFileToRoute, listPages, elementSemanticType } from './context';
import { currentRevision, settleRevision } from './revision';
import { validateSite } from './validate';
import { weaveActivityAtom, lastValidationAtom } from './store';
import { defineWeaveTool, toolError, type WeaveToolResult } from './webmcp/registry';

const store = getDefaultStore();

// ─── Shared helpers ─────────────────────────────────────────────────────────

function elementNotFound(id: unknown): WeaveToolResult {
  return toolError('ELEMENT_NOT_FOUND', `Element "${String(id)}" no longer exists on the current page.`);
}

/** Resolve an element id, defaulting to the human's single selection. */
function resolveTarget(args: Record<string, unknown>): { id: string } | WeaveToolResult {
  const explicit = args.element_id;
  if (typeof explicit === 'string' && explicit) {
    return getNode(explicit) ? { id: explicit } : elementNotFound(explicit);
  }
  const selection = store.get(selectedIdsAtom);
  if (selection.length === 0) {
    // Actionable, not a dead end: an agent reaching this has the whole page
    // available to it and just needs to name a target.
    return toolError('NO_TARGET',
      'This action needs an element. Pass element_id — call weave_find_elements to locate one '
      + '(by text, role, tag or section) or weave_get_context for the page tree — or ask the '
      + 'human to select something on the canvas.');
  }
  if (selection.length > 1) {
    return toolError('AMBIGUOUS_TARGET', `${selection.length} elements are selected. Pass element_id to choose one.`);
  }
  return { id: selection[0] };
}

/** Run one operation and shape the tool result. */
function runOperation(operation: WeaveOperation, extra: Record<string, unknown> = {}): WeaveToolResult {
  const result = executeOperation(operation);
  if (!result.ok) return toolError(result.error.code, result.error.message);
  return { ok: true, revision: settleRevision(), ...extra, ...result.detail };
}

const activeCode = (): string => projectFS.readFile(store.get(activeFilePathAtom)) ?? '';

// ════════════════════════════════════════════════════════════════════════════
// Tier 1 — finding, structure, pages, history
// ════════════════════════════════════════════════════════════════════════════

// ─── weave_find_elements ────────────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_find_elements',
  description:
    'Search the current page for elements matching what you describe: text they ' +
    'contain, their layer name, their tag, their semantic role such as heading or ' +
    'button or image, or which section they sit in. Returns each match with the id ' +
    'other WEAVE actions take, so this is how you locate the thing to change when ' +
    'the human has not selected it.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Match elements whose text contains this, case-insensitive.' },
      name: { type: 'string', description: 'Match elements whose layer name contains this, case-insensitive.' },
      tag: { type: 'string', description: 'Match one HTML tag exactly, e.g. "img", "h1".' },
      role: { type: 'string', description: 'Match a semantic role, e.g. "heading", "text", "image", "link", "button", "section".' },
      in_section: { type: 'string', description: 'Only search inside this section id.' },
      limit: { type: 'number', description: 'Maximum matches to return. Defaults to 25.' },
    },
    additionalProperties: false,
  },
  annotations: { title: 'Find elements on the page', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  kind: 'read',
  run: (args) => {
    const nodes = store.get(nodesAtom);
    const limit = Math.min(Math.max(typeof args.limit === 'number' ? args.limit : 25, 1), 100);
    const text = typeof args.text === 'string' ? args.text.toLowerCase() : null;
    const name = typeof args.name === 'string' ? args.name.toLowerCase() : null;
    const tag = typeof args.tag === 'string' ? args.tag : null;
    const role = typeof args.role === 'string' ? args.role.toLowerCase() : null;

    if (typeof args.in_section === 'string' && !nodes.has(args.in_section)) {
      return elementNotFound(args.in_section);
    }

    // Which section each match belongs to — an agent almost always wants to
    // know "the heading in the hero", not just "a heading".
    const sectionOf = new Map<string, string>();
    for (const sectionId of nodes.get('root')?.children ?? []) {
      const walk = (id: string) => {
        sectionOf.set(id, sectionId);
        for (const child of nodes.get(id)?.children ?? []) walk(child);
      };
      walk(sectionId);
    }

    const scope: string[] = [];
    if (typeof args.in_section === 'string') {
      const walk = (id: string) => { scope.push(id); for (const c of nodes.get(id)?.children ?? []) walk(c); };
      walk(args.in_section);
    } else {
      scope.push(...nodes.keys());
    }

    const matches: Array<Record<string, unknown>> = [];
    for (const id of scope) {
      const node = nodes.get(id);
      if (!node) continue;
      const semantic = elementSemanticType(node, nodes);
      if (text && !(node.textContent ?? '').toLowerCase().includes(text)) continue;
      if (name && !(node.name ?? '').toLowerCase().includes(name)) continue;
      if (tag && node.type !== tag) continue;
      if (role && semantic.toLowerCase() !== role) continue;
      if (!text && !name && !tag && !role) continue;
      matches.push({
        id: node.id,
        tag: node.type,
        name: node.name ?? null,
        role: semantic,
        text: (node.textContent ?? '').slice(0, 120) || null,
        section: sectionOf.get(id) ?? null,
      });
      if (matches.length >= limit) break;
    }

    if (!text && !name && !tag && !role) {
      return toolError('INVALID_ARGS', 'Pass at least one of: text, name, tag, role.');
    }
    return { ok: true, revision: currentRevision(), count: matches.length, matches };
  },
  summarize: (_a, result) => result.ok
    ? `Found ${(result as unknown as { count: number }).count} matching element(s)`
    : 'Search failed',
  targets: (_a, result) => {
    if (!result.ok) return undefined;
    return (result as unknown as { matches: Array<{ id: string }> }).matches.map((m) => m.id).slice(0, 8);
  },
});

// ─── weave_duplicate_element ────────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_duplicate_element',
  description:
    'Copy an element, with everything inside it, and place the copy directly after ' +
    'the original. Use this to repeat a card, a list item or a whole section rather ' +
    'than rebuilding it element by element. The copy gets fresh ids, which are ' +
    'returned so you can then edit the new copy.',
  inputSchema: {
    type: 'object',
    properties: {
      element_id: { type: 'string', description: 'Element to duplicate. Defaults to the current selection.' },
    },
    additionalProperties: false,
  },
  annotations: { title: 'Duplicate an element', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  kind: 'write',
  appliesWhen: (s) => s.hasSelection,
  run: (args) => {
    const target = resolveTarget(args);
    if ('ok' in target) return target;
    return runOperation({ op: 'duplicate', target: target.id });
  },
  summarize: (_a, result) => (result.ok ? 'Duplicated an element' : 'Could not duplicate'),
  targets: (_a, result) => (result.ok ? (result as unknown as { created?: string[] }).created : undefined),
});

// ─── weave_group_elements ───────────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_group_elements',
  description:
    'Put several elements that share a parent inside one new container, keeping ' +
    'their order and their position on the page. Use this to lay several elements ' +
    'out together — as a row, a column or a card — before styling the container.',
  inputSchema: {
    type: 'object',
    properties: {
      element_ids: { type: 'array', description: 'Ids of the elements to group. They must share the same parent.', items: { type: 'string' } },
      name: { type: 'string', description: 'Layer name for the new container.' },
    },
    required: ['element_ids'],
    additionalProperties: false,
  },
  annotations: { title: 'Group elements into a container', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  kind: 'write',
  run: (args) => runOperation({
    op: 'wrap',
    targets: (Array.isArray(args.element_ids) ? args.element_ids : []).map(String),
    name: typeof args.name === 'string' ? args.name : undefined,
  }),
  summarize: (args, result) => {
    const n = Array.isArray(args.element_ids) ? args.element_ids.length : 0;
    return result.ok ? `Grouped ${n} elements` : 'Could not group those elements';
  },
  targets: (_a, result) => {
    const id = (result as unknown as { created?: string }).created;
    return typeof id === 'string' ? [id] : undefined;
  },
});

// ─── weave_ungroup_element ──────────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_ungroup_element',
  description:
    'Remove a container but keep everything inside it, lifting its children into ' +
    'its place in the page. The container itself is deleted; its children are not.',
  inputSchema: {
    type: 'object',
    properties: {
      element_id: { type: 'string', description: 'Container to dissolve. Defaults to the current selection.' },
    },
    additionalProperties: false,
  },
  annotations: { title: 'Ungroup a container', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  kind: 'write',
  appliesWhen: (s) => s.hasSelection,
  run: (args) => {
    const target = resolveTarget(args);
    if ('ok' in target) return target;
    return runOperation({ op: 'unwrap', target: target.id });
  },
  summarize: (_a, result) => (result.ok ? 'Ungrouped a container' : 'Could not ungroup'),
  targets: (_a, result) => (result.ok ? (result as unknown as { lifted?: string[] }).lifted : undefined),
});

// ─── weave_change_element_tag ───────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_change_element_tag',
  description:
    'Change which HTML element something is — for example turn a styled div into a ' +
    'real heading, or a plain block into a section, nav or footer. This is how you ' +
    'fix a page that looks right but reads as meaningless structure to a screen ' +
    'reader or an agent. Styles, children and the element id are kept.',
  inputSchema: {
    type: 'object',
    properties: {
      element_id: { type: 'string', description: 'Element to retag. Defaults to the current selection.' },
      tag: { type: 'string', enum: [...ALLOWED_TAGS], description: 'The semantic element to become.' },
    },
    required: ['tag'],
    additionalProperties: false,
  },
  annotations: { title: 'Change an element’s tag', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  kind: 'write',
  appliesWhen: (s) => s.hasSelection,
  run: (args) => {
    const target = resolveTarget(args);
    if ('ok' in target) return target;
    return runOperation({ op: 'change_tag', target: target.id, tag: String(args.tag) }, { element: target.id });
  },
  summarize: (args, result) => (result.ok ? `Changed an element to <${String(args.tag)}>` : 'Could not change the tag'),
  targets: (_a, result) => {
    const id = (result as unknown as { element?: string }).element;
    return id ? [id] : undefined;
  },
});

// ─── weave_set_link ─────────────────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_set_link',
  description:
    'Make an element navigate somewhere when clicked: another page of this site, ' +
    'an anchor on the current page, or an external address. If the element is not ' +
    'already a link it is converted into one first, so this works on a button or a ' +
    'card as well as on existing links. Destinations that are not a route or an ' +
    'http, mailto or tel address are refused.',
  inputSchema: {
    type: 'object',
    properties: {
      element_id: { type: 'string', description: 'Element to make navigable. Defaults to the current selection.' },
      href: { type: 'string', description: 'Where it goes: "/about", "#pricing", "https://…", "mailto:…" or "tel:…".' },
    },
    required: ['href'],
    additionalProperties: false,
  },
  annotations: { title: 'Link an element to a destination', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  kind: 'write',
  appliesWhen: (s) => s.hasSelection,
  run: (args) => {
    const target = resolveTarget(args);
    if ('ok' in target) return target;
    return runOperation({ op: 'set_link', target: target.id, href: String(args.href) }, { element: target.id });
  },
  summarize: (args, result) => (result.ok ? `Linked an element to ${String(args.href)}` : 'Could not set the link'),
  targets: (_a, result) => {
    const id = (result as unknown as { element?: string }).element;
    return id ? [id] : undefined;
  },
});

// ─── weave_list_pages ───────────────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_list_pages',
  description:
    'List every page in this site with its route, which one is currently open for ' +
    'editing, and how many sections each contains. Use this before creating a page ' +
    'to see what already exists, or before linking so you use real routes.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { title: 'List the site’s pages', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  kind: 'read',
  run: () => {
    const active = store.get(activeFilePathAtom);
    return {
      ok: true,
      revision: currentRevision(),
      activePage: pageFileToRoute(active),
      pages: listPages().map((p) => ({ ...p, active: p.file === active })),
    };
  },
  summarize: (_a, result) => (result.ok
    ? `Listed ${(result as unknown as { pages: unknown[] }).pages.length} page(s)`
    : 'Could not list pages'),
});

// ─── weave_create_page ──────────────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_create_page',
  description:
    'Add a new, empty page to the site and return its route. The page becomes real ' +
    'source alongside the others and can be linked to immediately. Open it with ' +
    'weave_open_page before adding sections to it.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Page name, e.g. "About". The route is derived from it.' },
    },
    required: ['name'],
    additionalProperties: false,
  },
  annotations: { title: 'Create a page', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  kind: 'write',
  run: (args) => {
    const name = String(args.name ?? '').trim();
    if (!name) return toolError('INVALID_ARGS', 'A page needs a name.');
    // Page creation writes whole files rather than mutating the active page,
    // so the queue is flushed first and the revision settled after.
    syncQueueToActiveFile();
    const clientPath = createPageFile(name);
    trace.action('weave:create-page', { clientPath });
    return {
      ok: true,
      revision: settleRevision(),
      route: pageFileToRoute(clientPath),
      file: clientPath,
      message: 'Page created. Open it with weave_open_page to add sections to it.',
    };
  },
  summarize: (args, result) => (result.ok
    ? `Created the page ${(result as unknown as { route: string }).route}`
    : `Could not create the page “${String(args.name)}”`),
});

// ─── weave_open_page ────────────────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_open_page',
  description:
    'Open one of the site’s pages for editing, so that reads and edits apply to it. ' +
    'This changes what the human sees on the canvas, so the page you open is the ' +
    'page they are looking at. Call weave_get_context afterwards — the element ids ' +
    'of the previous page do not exist on the new one.',
  inputSchema: {
    type: 'object',
    properties: {
      route: { type: 'string', description: 'Route to open, e.g. "/about". Use weave_list_pages to see them.' },
    },
    required: ['route'],
    additionalProperties: false,
  },
  annotations: { title: 'Open a page for editing', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  kind: 'write',
  appliesWhen: (s) => s.hasMultiplePages,
  run: (args) => {
    const route = String(args.route ?? '');
    const pages = listPages();
    const match = pages.find((p) => p.route === route || p.file === route);
    if (!match) {
      return toolError('PAGE_NOT_FOUND', `No page at "${route}". Available: ${pages.map((p) => p.route).join(', ')}.`);
    }
    const from = store.get(activeFilePathAtom);
    if (from === match.file) {
      return { ok: true, revision: currentRevision(), route: match.route, note: 'That page is already open.' };
    }
    // Same switch the human's page picker performs — flushes the outgoing
    // page, clears selection, reseeds the queue and repaints the canvas.
    switchActiveFile(from, match.file, {
      setActiveFile: (path) => { store.set(activeFilePathAtom, path); setActiveFilePath(path); },
      setSelectedIds: (ids) => store.set(selectedIdsAtom, ids),
      setUpdatingFromCanvas: (v) => store.set(updatingFromCanvasAtom, v),
    }, { syncQueueCode, flushNow });
    return {
      ok: true,
      revision: settleRevision(),
      route: match.route,
      message: 'Page opened. Call weave_get_context for its sections and element ids.',
    };
  },
  summarize: (args, result) => (result.ok ? `Opened ${String(args.route)}` : `Could not open ${String(args.route)}`),
});

// ─── weave_delete_page ──────────────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_delete_page',
  description:
    'Permanently remove a page and everything on it from the site. This deletes the ' +
    'human’s work, so prefer asking them first. The site’s home page cannot be ' +
    'deleted, and neither can the page currently open for editing.',
  inputSchema: {
    type: 'object',
    properties: {
      route: { type: 'string', description: 'Route of the page to delete, e.g. "/about".' },
    },
    required: ['route'],
    additionalProperties: false,
  },
  annotations: { title: 'Delete a page', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false, requiresHumanApproval: true },
  kind: 'write',
  appliesWhen: (s) => s.hasMultiplePages,
  run: (args) => {
    const route = String(args.route ?? '');
    const pages = listPages();
    const match = pages.find((p) => p.route === route || p.file === route);
    if (!match) {
      return toolError('PAGE_NOT_FOUND', `No page at "${route}". Available: ${pages.map((p) => p.route).join(', ')}.`);
    }
    if (match.route === '/') {
      return toolError('CANNOT_DELETE_HOME', 'The home page cannot be deleted.');
    }
    if (match.file === store.get(activeFilePathAtom)) {
      return toolError('PAGE_IS_OPEN', 'That page is open for editing. Open a different page first.');
    }
    syncQueueToActiveFile();
    deletePageFile(match.file);
    trace.action('weave:delete-page', { file: match.file });
    return { ok: true, revision: settleRevision(), deleted: match.route };
  },
  summarize: (args, result) => (result.ok ? `Deleted the page ${String(args.route)}` : `Could not delete ${String(args.route)}`),
});

// ─── weave_undo / weave_redo ────────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_undo',
  description:
    'Reverse the last change to the project as a single step — including a whole ' +
    'set of changes that were applied together. Use this to take back an edit you ' +
    'just made. It reverses whatever was most recent, which may be the human’s own ' +
    'work, so prefer it immediately after your own change.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { title: 'Undo the last change', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  kind: 'write',
  appliesWhen: (s) => s.canUndo,
  run: () => {
    syncQueueToActiveFile();
    if (!getHistoryState().canUndo) return toolError('NOTHING_TO_UNDO', 'There is nothing left to undo.');
    const done = undo();
    if (!done) return toolError('UNDO_FAILED', 'The last change could not be undone.');
    return { ok: true, revision: settleRevision(), history: getHistoryState() };
  },
  summarize: (_a, result) => (result.ok ? 'Undid the last change' : 'Nothing to undo'),
});

defineWeaveTool({
  name: 'weave_redo',
  description:
    'Re-apply the change that was most recently undone. Only available immediately ' +
    'after an undo, and only until a new edit is made.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { title: 'Redo the last undone change', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  kind: 'write',
  appliesWhen: (s) => s.canRedo,
  run: () => {
    syncQueueToActiveFile();
    if (!getHistoryState().canRedo) return toolError('NOTHING_TO_REDO', 'There is nothing to redo.');
    const done = redo();
    if (!done) return toolError('REDO_FAILED', 'The change could not be redone.');
    return { ok: true, revision: settleRevision(), history: getHistoryState() };
  },
  summarize: (_a, result) => (result.ok ? 'Redid a change' : 'Nothing to redo'),
});

// ════════════════════════════════════════════════════════════════════════════
// Tier 2 — design system, behaviour, motion, translation, content, review
// ════════════════════════════════════════════════════════════════════════════

// ─── weave_set_design_token ─────────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_set_design_token',
  description:
    'Create or change a design token — a named value such as a brand colour or a ' +
    'heading size that elements refer to instead of repeating a literal value. ' +
    'Changing a token updates everything bound to it at once, which is how you ' +
    'restyle a whole site consistently rather than editing elements one by one.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Token name without dashes in front, e.g. "brand-primary".' },
      value: { type: 'string', description: 'The value, e.g. "#6366f1" or "48px".' },
      category: { type: 'string', enum: ['color', 'typography', 'spacing', 'margin', 'radius', 'shadow', 'border', 'image', 'video', 'other'], description: 'What kind of value it is. Used to group it for the human.' },
      label: { type: 'string', description: 'Optional human-readable label.' },
    },
    required: ['name', 'value'],
    additionalProperties: false,
  },
  annotations: { title: 'Set a design token', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  kind: 'write',
  run: (args) => runOperation({
    op: 'set_token',
    name: String(args.name),
    value: String(args.value),
    category: args.category as never,
    label: typeof args.label === 'string' ? args.label : undefined,
  }),
  summarize: (args, result) => (result.ok
    ? `Set the design token “${String(args.name)}” to ${String(args.value)}`
    : `Could not set the token “${String(args.name)}”`),
});

// ─── weave_list_design_tokens ───────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_list_design_tokens',
  description:
    'List the site’s design tokens with their current values, so you can reuse the ' +
    'brand’s own colours, sizes and spacing instead of inventing new literal values.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { title: 'List design tokens', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  kind: 'read',
  run: () => {
    const css = projectFS.readFile('app/globals.css') ?? '';
    const tokens: Array<{ name: string; value: string }> = [];
    const re = /--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css)) !== null) tokens.push({ name: m[1], value: m[2].trim() });
    return { ok: true, revision: currentRevision(), count: tokens.length, tokens };
  },
  summarize: (_a, result) => (result.ok
    ? `Listed ${(result as unknown as { count: number }).count} design token(s)`
    : 'Could not read design tokens'),
});

// ─── weave_set_variable ─────────────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_set_variable',
  description:
    'Create or update a page variable — a named piece of state the page can hold, ' +
    'such as a colour, a number or a toggle. On its own a variable changes nothing; ' +
    'bind it to a style with weave_bind_style_variable, then change it on an ' +
    'interaction to make the page respond to the visitor.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'camelCase name, e.g. "heroFade".' },
      value: { type: 'string', description: 'Its starting value, as text, e.g. "1" or "#ff0000".' },
      type: { type: 'string', enum: [...PAGE_VARIABLE_TYPES], description: 'What kind of value it holds. Defaults to text.' },
    },
    required: ['name', 'value'],
    additionalProperties: false,
  },
  annotations: { title: 'Set a page variable', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  kind: 'write',
  run: (args) => runOperation({
    op: 'set_variable',
    name: String(args.name),
    value: String(args.value),
    varType: args.type as never,
  }),
  summarize: (args, result) => (result.ok
    ? `Set the page variable “${String(args.name)}”`
    : `Could not set the variable “${String(args.name)}”`),
});

// ─── weave_bind_style_variable ──────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_bind_style_variable',
  description:
    'Drive one of an element’s styles from a page variable, so the style follows ' +
    'the variable instead of a fixed value. Combined with an interaction this is ' +
    'what makes something on the page change in response to the visitor.',
  inputSchema: {
    type: 'object',
    properties: {
      element_id: { type: 'string', description: 'Element to bind. Defaults to the current selection.' },
      property: { type: 'string', description: 'Which style follows the variable, e.g. "opacity", "backgroundColor".' },
      variable: { type: 'string', description: 'Name of an existing page variable.' },
    },
    required: ['property', 'variable'],
    additionalProperties: false,
  },
  annotations: { title: 'Bind a style to a variable', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  kind: 'write',
  appliesWhen: (s) => s.hasSelection && s.hasVariables,
  run: (args) => {
    const target = resolveTarget(args);
    if ('ok' in target) return target;
    return runOperation({
      op: 'bind_style_variable',
      target: target.id,
      property: String(args.property),
      varName: String(args.variable),
    }, { element: target.id });
  },
  summarize: (args, result) => (result.ok
    ? `Bound ${String(args.property)} to “${String(args.variable)}”`
    : 'Could not bind that style'),
});

// ─── weave_add_interaction ──────────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_add_interaction',
  description:
    'Make the page respond to the visitor: when they click or hover an element, set ' +
    'a page variable to a new value. Anything bound to that variable updates. This ' +
    'is real behaviour in the published site, not an editor preview.',
  inputSchema: {
    type: 'object',
    properties: {
      element_id: { type: 'string', description: 'Element the visitor interacts with. Defaults to the current selection.' },
      trigger: { type: 'string', enum: [...INTERACTION_TRIGGERS], description: 'What the visitor does.' },
      variable: { type: 'string', description: 'Page variable to change.' },
      value: { type: 'string', description: 'Value to set it to.' },
    },
    required: ['trigger', 'variable', 'value'],
    additionalProperties: false,
  },
  annotations: { title: 'Add an interaction', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  kind: 'write',
  appliesWhen: (s) => s.hasSelection && s.hasVariables,
  run: (args) => {
    const target = resolveTarget(args);
    if ('ok' in target) return target;
    return runOperation({
      op: 'add_interaction',
      target: target.id,
      trigger: args.trigger as never,
      varName: String(args.variable),
      value: String(args.value),
    }, { element: target.id });
  },
  summarize: (args, result) => (result.ok
    ? `On ${String(args.trigger)}, set “${String(args.variable)}” to ${String(args.value)}`
    : 'Could not add that interaction'),
});

// ─── weave_animate_element ──────────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_animate_element',
  description:
    'Give an element motion: fade or rise as it scrolls into view, respond to hover, ' +
    'or loop continuously. Provide the visible state you want — the starting state ' +
    'is derived from it. Only transform and colour properties can be animated, so ' +
    'motion can never move content out of the page’s layout.',
  inputSchema: {
    type: 'object',
    properties: {
      element_id: { type: 'string', description: 'Element to animate. Defaults to the current selection.' },
      kind: { type: 'string', enum: [...ANIMATION_KINDS], description: 'appear: on scroll into view. hover: while hovered. loop: continuous.' },
      properties: { type: 'object', description: 'Target values, e.g. { "opacity": "1", "y": "0" }.' },
      duration: { type: 'number', description: 'Seconds the motion takes.' },
      ease: { type: 'string', description: 'Easing, e.g. "easeOut", "linear".' },
    },
    required: ['kind', 'properties'],
    additionalProperties: false,
  },
  annotations: { title: 'Animate an element', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  kind: 'write',
  appliesWhen: (s) => s.hasSelection,
  run: (args) => {
    const target = resolveTarget(args);
    if ('ok' in target) return target;
    const transition: Record<string, string> = {};
    if (typeof args.duration === 'number') transition.duration = String(args.duration);
    if (typeof args.ease === 'string') transition.ease = args.ease;
    const props: Record<string, string> = {};
    for (const [k, v] of Object.entries((args.properties ?? {}) as Record<string, unknown>)) props[k] = String(v);
    return runOperation({
      op: 'animate', target: target.id, kind: args.kind as never, props, transition,
    }, { element: target.id });
  },
  summarize: (args, result) => (result.ok
    ? `Added a ${String(args.kind)} animation`
    : 'Could not animate that element'),
});

// ─── weave_remove_animation ─────────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_remove_animation',
  description: 'Remove an element’s appear, hover or loop animation, leaving the element itself untouched.',
  inputSchema: {
    type: 'object',
    properties: {
      element_id: { type: 'string', description: 'Element to clear. Defaults to the current selection.' },
      kind: { type: 'string', enum: [...ANIMATION_KINDS], description: 'Which animation to remove.' },
    },
    required: ['kind'],
    additionalProperties: false,
  },
  annotations: { title: 'Remove an animation', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  kind: 'write',
  appliesWhen: (s) => s.hasSelection,
  run: (args) => {
    const target = resolveTarget(args);
    if ('ok' in target) return target;
    return runOperation({ op: 'remove_animation', target: target.id, kind: args.kind as never }, { element: target.id });
  },
  summarize: (args, result) => (result.ok ? `Removed the ${String(args.kind)} animation` : 'Could not remove that animation'),
});

// ─── weave_list_locales ─────────────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_list_locales',
  description:
    'List the languages this site is published in, and which one is the original. ' +
    'Use this before translating so you write into a language the site actually has.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { title: 'List the site’s languages', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  kind: 'read',
  appliesWhen: (s) => s.hasLocales,
  run: () => {
    const config = getI18nConfig();
    return {
      ok: true,
      revision: currentRevision(),
      defaultLocale: config.defaultLocale,
      locales: config.locales.map((l) => ({ code: l.code, label: l.label, isDefault: l.code === config.defaultLocale })),
    };
  },
  summarize: (_a, result) => (result.ok
    ? `Listed ${(result as unknown as { locales: unknown[] }).locales.length} language(s)`
    : 'Could not read the site’s languages'),
});

// ─── weave_add_locale ───────────────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_add_locale',
  description:
    'Add a language to the site. This creates the routes and message files the ' +
    'published site needs, after which weave_translate_element can fill it in. ' +
    'Existing content is untouched — a new language starts empty and falls back to ' +
    'the original text until it is translated.',
  inputSchema: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'Language code, e.g. "hi", "fr", "es".' },
      label: { type: 'string', description: 'Its name for the human, e.g. "Hindi".' },
      direction: { type: 'string', enum: ['ltr', 'rtl'], description: 'Writing direction. Defaults to left-to-right.' },
    },
    required: ['code', 'label'],
    additionalProperties: false,
  },
  annotations: { title: 'Add a language', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  kind: 'write',
  run: (args) => {
    const code = String(args.code ?? '').trim();
    if (!/^[a-z]{2}(-[A-Za-z0-9]{2,8})?$/.test(code)) {
      return toolError('INVALID_ARGS', 'A language code looks like "hi", "fr" or "pt-BR".');
    }
    if (getI18nConfig().locales.some((l) => l.code === code)) {
      return toolError('LOCALE_EXISTS', `The site already has "${code}".`);
    }
    syncQueueToActiveFile();
    addLocale(code, String(args.label), args.direction as 'ltr' | 'rtl' | undefined);
    return { ok: true, revision: settleRevision(), locales: getI18nConfig().locales.map((l) => l.code) };
  },
  summarize: (args, result) => (result.ok ? `Added the language ${String(args.code)}` : `Could not add ${String(args.code)}`),
});

// ─── weave_translate_element ────────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_translate_element',
  description:
    'Write an element’s text in one of the site’s other languages. The original ' +
    'text is untouched — visitors are served the translation only when they view ' +
    'that language. Add the language first with weave_add_locale if it does not ' +
    'exist yet.',
  inputSchema: {
    type: 'object',
    properties: {
      element_id: { type: 'string', description: 'Element whose text to translate. Defaults to the current selection.' },
      locale: { type: 'string', description: 'Language code to write, e.g. "hi".' },
      text: { type: 'string', description: 'The translated text.' },
    },
    required: ['locale', 'text'],
    additionalProperties: false,
  },
  annotations: { title: 'Translate an element', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  kind: 'write',
  appliesWhen: (s) => s.hasSelection && s.hasLocales,
  run: (args) => {
    const target = resolveTarget(args);
    if ('ok' in target) return target;
    return runOperation({
      op: 'set_translation', target: target.id, locale: String(args.locale), text: String(args.text),
    }, { element: target.id });
  },
  summarize: (args, result) => (result.ok
    ? `Translated an element into ${String(args.locale)}`
    : `Could not translate into ${String(args.locale)}`),
});

// ─── weave_set_page_metadata ────────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_set_page_metadata',
  description:
    'Set the page’s title and description — the text search engines and link ' +
    'previews show, and one of the things the agent-readiness score checks.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'The page title.' },
      description: { type: 'string', description: 'A one or two sentence description.' },
    },
    additionalProperties: false,
  },
  annotations: { title: 'Set page metadata', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  kind: 'write',
  run: (args) => runOperation({
    op: 'set_metadata',
    title: typeof args.title === 'string' ? args.title : undefined,
    description: typeof args.description === 'string' ? args.description : undefined,
  }),
  summarize: (_a, result) => (result.ok ? 'Set the page metadata' : 'Could not set the page metadata'),
});

// ─── weave_list_collections ─────────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_list_collections',
  description:
    'List the site’s content collections — structured, repeatable content such as ' +
    'products, posts or team members — with their fields and how many items each ' +
    'holds. Read this before adding content so you use the right field names.',
  inputSchema: {
    type: 'object',
    properties: {
      collection: { type: 'string', description: 'Read one collection’s items instead of listing them all.' },
    },
    additionalProperties: false,
  },
  annotations: { title: 'List content collections', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  kind: 'read',
  appliesWhen: (s) => s.hasCollections,
  run: (args) => {
    const slugs = listCollections();
    if (typeof args.collection === 'string') {
      if (!slugs.includes(args.collection)) {
        return toolError('COLLECTION_NOT_FOUND', `No collection "${args.collection}". Available: ${slugs.join(', ') || 'none'}.`);
      }
      const schema = getCollectionSchema(args.collection);
      return {
        ok: true,
        revision: currentRevision(),
        collection: args.collection,
        fields: (schema?.fields ?? []).map((f) => ({ id: f.id, name: f.name, type: f.type, required: !!f.required })),
        items: getCollectionData(args.collection).map((i) => ({ id: i._id, slug: i._slug, status: i._status })),
      };
    }
    return {
      ok: true,
      revision: currentRevision(),
      collections: slugs.map((slug) => {
        const schema = getCollectionSchema(slug);
        return {
          slug,
          name: schema?.name ?? slug,
          itemCount: getCollectionData(slug).length,
          fields: (schema?.fields ?? []).map((f) => ({ id: f.id, name: f.name, type: f.type })),
        };
      }),
    };
  },
  summarize: (args, result) => {
    if (!result.ok) return 'Could not read content collections';
    if (typeof args.collection === 'string') return `Read the “${String(args.collection)}” collection`;
    return `Listed ${(result as unknown as { collections: unknown[] }).collections.length} collection(s)`;
  },
});

// ─── weave_upsert_collection_item ───────────────────────────────────────────

defineWeaveTool({
  name: 'weave_upsert_collection_item',
  description:
    'Add an item to a content collection, or update one that exists. Everything on ' +
    'the site bound to that collection updates with it, so this is how you add real ' +
    'content — a product, a post — rather than typing text into one element. Field ' +
    'names that the collection does not define are refused.',
  inputSchema: {
    type: 'object',
    properties: {
      collection: { type: 'string', description: 'Collection slug, from weave_list_collections.' },
      item_id: { type: 'string', description: 'Id of an existing item to update. Omit to add a new one.' },
      values: { type: 'object', description: 'Field id to value, e.g. { "title": "Kiln 01", "price": "48" }.' },
    },
    required: ['collection', 'values'],
    additionalProperties: false,
  },
  annotations: { title: 'Add or update collection content', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, requiresHumanApproval: true },
  kind: 'write',
  appliesWhen: (s) => s.hasCollections,
  run: (args) => runOperation({
    op: 'cms_upsert',
    collection: String(args.collection),
    itemId: typeof args.item_id === 'string' ? args.item_id : undefined,
    values: (args.values ?? {}) as Record<string, unknown>,
  }),
  summarize: (args, result) => (result.ok
    ? `${(result as unknown as { created: boolean }).created ? 'Added an item to' : 'Updated an item in'} “${String(args.collection)}”`
    : `Could not write to “${String(args.collection)}”`),
});

// ─── weave_remove_collection_item ───────────────────────────────────────────

defineWeaveTool({
  name: 'weave_remove_collection_item',
  description:
    'Permanently delete one item from a content collection. Everything on the site ' +
    'showing that item stops showing it. This destroys the human’s content.',
  inputSchema: {
    type: 'object',
    properties: {
      collection: { type: 'string', description: 'Collection slug.' },
      item_id: { type: 'string', description: 'Id of the item to delete.' },
    },
    required: ['collection', 'item_id'],
    additionalProperties: false,
  },
  annotations: { title: 'Delete collection content', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false, requiresHumanApproval: true },
  kind: 'write',
  appliesWhen: (s) => s.hasCollections,
  run: (args) => runOperation({
    op: 'cms_remove', collection: String(args.collection), itemId: String(args.item_id),
  }),
  summarize: (args, result) => (result.ok
    ? `Removed an item from “${String(args.collection)}”`
    : `Could not remove that item from “${String(args.collection)}”`),
});

// ─── weave_add_comment ──────────────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_add_comment',
  description:
    'Leave a note for the human on the page instead of changing it. Use this when ' +
    'you notice something worth raising but the decision is theirs — a heading that ' +
    'reads oddly, an image with no alternative text, a section that seems out of ' +
    'place. The note appears where they work and changes nothing.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'What you want to tell the human.' },
      element_id: { type: 'string', description: 'Element the note is about. Defaults to the current selection.' },
    },
    required: ['text'],
    additionalProperties: false,
  },
  annotations: { title: 'Leave a note for the human', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  kind: 'write',
  run: (args) => {
    const text = String(args.text ?? '').trim();
    if (!text) return toolError('INVALID_ARGS', 'A note needs some text.');

    // Comments are pinned to canvas coordinates. Anchor to the element's real
    // position when the canvas can measure it; otherwise drop the note at the
    // page origin rather than refusing — the text is what matters.
    let x = 0;
    let y = 0;
    let anchor: string | null = null;
    const explicit = typeof args.element_id === 'string' ? args.element_id : store.get(selectedIdsAtom)[0];
    if (typeof explicit === 'string' && explicit) {
      if (!getNode(explicit)) return elementNotFound(explicit);
      anchor = explicit;
      try {
        const vp = String(store.get(interactingViewportIdAtom) ?? 'desktop');
        const rect = getCanvasBridge().getRect(explicit, getViewportPrefix(vp));
        if (rect) { x = Math.round(rect.left); y = Math.round(rect.top); }
      } catch { /* headless / not yet rendered — fall back to the origin */ }
    }

    const id = commentOps.addComment(x, y);
    commentOps.updateCommentText(id, anchor ? `${text}\n\n— about ${anchor}` : text);
    trace.action('weave:comment', { id, anchor });
    return { ok: true, revision: currentRevision(), commentId: id, anchor, message: 'Note left for the human. Nothing on the page changed.' };
  },
  summarize: (_a, result) => (result.ok ? 'Left a note for the human' : 'Could not leave a note'),
  targets: (_a, result) => {
    const anchor = (result as unknown as { anchor?: string | null }).anchor;
    return anchor ? [anchor] : undefined;
  },
});

// ─── weave_list_comments ────────────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_list_comments',
  description:
    'Read the notes left on this page, by the human or by you, including whether ' +
    'each has been resolved. Use this to pick up feedback the human left for you.',
  inputSchema: {
    type: 'object',
    properties: {
      include_resolved: { type: 'boolean', description: 'Include notes already marked resolved. Defaults to false.' },
    },
    additionalProperties: false,
  },
  annotations: { title: 'Read notes on the page', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  kind: 'read',
  run: (args) => {
    const file = store.get(activeFilePathAtom);
    const includeResolved = args.include_resolved === true;
    const comments = store.get(allCommentsAtom)
      .filter((c) => c.filePath === file)
      .filter((c) => includeResolved || !c.resolved)
      .map((c) => ({
        id: c.id,
        text: c.text,
        resolved: c.resolved,
        author: c.authorName ?? null,
        createdAt: c.createdAt,
        replies: (c.messages ?? []).length,
      }));
    return { ok: true, revision: currentRevision(), count: comments.length, comments };
  },
  summarize: (_a, result) => (result.ok
    ? `Read ${(result as unknown as { count: number }).count} note(s)`
    : 'Could not read the notes'),
});

// ─── weave_create_component ─────────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_create_component',
  description:
    'Turn an element and everything inside it into a reusable component, so the ' +
    'same design can be placed repeatedly and edited in one place. This restructures ' +
    'the human’s project rather than editing content, so it asks for their approval, ' +
    'and it is a single change they can undo.',
  inputSchema: {
    type: 'object',
    properties: {
      element_id: { type: 'string', description: 'Element to promote. Defaults to the current selection.' },
      name: { type: 'string', description: 'Name for the component, e.g. "ProductCard".' },
    },
    required: ['name'],
    additionalProperties: false,
  },
  annotations: { title: 'Create a reusable component', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, requiresHumanApproval: true },
  kind: 'write',
  appliesWhen: (s) => s.hasSelection,
  run: (args) => {
    const target = resolveTarget(args);
    if ('ok' in target) return target;
    const name = String(args.name ?? '').trim();
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name)) {
      return toolError('INVALID_ARGS', 'A component name must start with a letter and contain only letters and digits, e.g. "ProductCard".');
    }
    const filePath = store.get(activeFilePathAtom);

    // `makeComponent` rewrites the page and emits a component file in one
    // step, OUTSIDE the mutation queue. Everything it touches is inside
    // ProjectFS, so an applied ChangeSet's snapshot still rolls it back
    // atomically; what it cannot do is coalesce with queued mutations, so
    // the queue is flushed on both sides of the call.
    syncQueueToActiveFile();
    const result = makeComponent(filePath, target.id, name);
    if (!result) return toolError('COMPONENT_FAILED', 'That element could not be made into a component.');
    syncQueueCode(result.updatedPageCode);
    projectFS.writeFile(filePath, result.updatedPageCode);
    store.set(selectedIdsAtom, []);
    trace.action('weave:create-component', { componentFilePath: result.componentFilePath });
    return {
      ok: true,
      revision: settleRevision(),
      component: result.componentFilePath,
      name,
      message: 'Component created. Place copies of it with weave_insert_component.',
    };
  },
  summarize: (args, result) => (result.ok
    ? `Created the component “${String(args.name)}”`
    : `Could not create the component “${String(args.name)}”`),
});

// ─── weave_insert_component ─────────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_insert_component',
  description:
    'Place a copy of an existing component on the page. Every copy follows the ' +
    'original, so editing the component later updates all of them. List what is ' +
    'available with weave_list_components.',
  inputSchema: {
    type: 'object',
    properties: {
      component: { type: 'string', description: 'Component name or file, from weave_list_components.' },
      after_element_id: { type: 'string', description: 'Place it after this element. Defaults to the end of the page.' },
    },
    required: ['component'],
    additionalProperties: false,
  },
  annotations: { title: 'Place a component', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  kind: 'write',
  appliesWhen: (s) => s.hasComponents,
  run: (args) => {
    const wanted = String(args.component ?? '');
    const files = projectFS.listFiles().filter((f) => f.startsWith('components/') && f.endsWith('.tsx'));
    const file = files.find((f) => f === wanted || f.endsWith(`/${wanted}.tsx`));
    if (!file) {
      const names = files.map((f) => f.split('/').pop()!.replace(/\.tsx$/, ''));
      return toolError('COMPONENT_NOT_FOUND', `No component "${wanted}". Available: ${names.join(', ') || 'none'}.`);
    }
    const elementName = file.split('/').pop()!.replace(/\.tsx$/, '');

    const anchor = typeof args.after_element_id === 'string' ? args.after_element_id : null;
    if (anchor && !getNode(anchor)) return elementNotFound(anchor);
    const nodes = store.get(nodesAtom);
    const prevSelection = store.get(selectedIdsAtom);
    const kids = (nodes.get('root')?.children ?? []).filter((c) => nodes.has(c));
    store.set(selectedIdsAtom, anchor ? [anchor] : (kids.length > 0 ? [kids[kids.length - 1]] : []));

    syncQueueToActiveFile();
    const created = insertNodes(buildInstanceClipboardNode(file, elementName));
    flushNow();
    if (created.length === 0) {
      store.set(selectedIdsAtom, prevSelection);
      return toolError('INSERT_FAILED', `Could not place "${elementName}" on the page.`);
    }
    store.set(selectedIdsAtom, created);
    return { ok: true, revision: settleRevision(), created, component: file };
  },
  summarize: (args, result) => (result.ok
    ? `Placed the component “${String(args.component)}”`
    : `Could not place “${String(args.component)}”`),
  targets: (_a, result) => (result.ok ? (result as unknown as { created?: string[] }).created : undefined),
});

// ─── weave_list_components ──────────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_list_components',
  description:
    'List the reusable components this project defines, so you can place an existing ' +
    'one rather than rebuilding the same design.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { title: 'List components', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  kind: 'read',
  appliesWhen: (s) => s.hasComponents,
  run: () => {
    const components = projectFS.listFiles()
      .filter((f) => f.startsWith('components/') && f.endsWith('.tsx'))
      .map((file) => ({ name: file.split('/').pop()!.replace(/\.tsx$/, ''), file }));
    return { ok: true, revision: currentRevision(), count: components.length, components };
  },
  summarize: (_a, result) => (result.ok
    ? `Listed ${(result as unknown as { count: number }).count} component(s)`
    : 'Could not list components'),
});

// ════════════════════════════════════════════════════════════════════════════
// Tier 3 — deeper reads
// ════════════════════════════════════════════════════════════════════════════

// ─── weave_get_element_styles ───────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_get_element_styles',
  description:
    'Read what an element actually looks like as rendered, not just the styles ' +
    'written on it — inherited font sizes and colours included. Use this before ' +
    'restyling so you match the real appearance rather than guessing from the ' +
    'declared values, which are often empty on inheriting elements.',
  inputSchema: {
    type: 'object',
    properties: {
      element_id: { type: 'string', description: 'Element to inspect. Defaults to the current selection.' },
      properties: { type: 'array', description: 'Which CSS properties to resolve. Defaults to a common set.', items: { type: 'string' } },
    },
    additionalProperties: false,
  },
  annotations: { title: 'Read an element’s resolved styles', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  kind: 'read',
  appliesWhen: (s) => s.hasSelection,
  run: (args) => {
    const target = resolveTarget(args);
    if ('ok' in target) return target;
    const node = getNode(target.id)!;
    const props = Array.isArray(args.properties) && args.properties.length > 0
      ? args.properties.map(String)
      : ['color', 'backgroundColor', 'fontSize', 'fontWeight', 'fontFamily', 'lineHeight',
         'display', 'padding', 'margin', 'width', 'height', 'borderRadius', 'opacity'];

    let resolved: Record<string, string> = {};
    try {
      const vp = String(store.get(interactingViewportIdAtom) ?? 'desktop');
      resolved = getCanvasBridge().getComputedValues(target.id, getViewportPrefix(vp), props) ?? {};
    } catch { /* headless — declared styles below are still useful */ }

    return {
      ok: true,
      revision: currentRevision(),
      element: { id: node.id, tag: node.type, name: node.name ?? null },
      declared: node.styles ?? {},
      resolved,
      note: Object.keys(resolved).length === 0
        ? 'Resolved values are unavailable right now; "declared" holds the styles written on the element.'
        : undefined,
    };
  },
  summarize: (_a, result) => (result.ok ? 'Read an element’s styles' : 'Could not read those styles'),
  targets: (args) => (typeof args.element_id === 'string' ? [args.element_id] : store.get(selectedIdsAtom)),
});

// ─── weave_get_subtree ──────────────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_get_subtree',
  description:
    'Read the elements inside one section or container, to whatever depth you ask ' +
    'for. Use this to look closely at one part of the page instead of re-reading ' +
    'the whole page context, which is bounded and may leave deep elements out.',
  inputSchema: {
    type: 'object',
    properties: {
      element_id: { type: 'string', description: 'Root of the subtree to read. Defaults to the current selection.' },
      depth: { type: 'number', description: 'How many levels down to read. Defaults to 3.' },
    },
    additionalProperties: false,
  },
  annotations: { title: 'Read part of the page in detail', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  kind: 'read',
  appliesWhen: (s) => s.hasSelection,
  run: (args) => {
    const target = resolveTarget(args);
    if ('ok' in target) return target;
    const nodes = store.get(nodesAtom);
    const maxDepth = Math.min(Math.max(typeof args.depth === 'number' ? args.depth : 3, 1), 12);
    let count = 0;

    const build = (id: string, depth: number): Record<string, unknown> | null => {
      const node = nodes.get(id);
      if (!node || count >= 400) return null;
      count++;
      const text = (node.textContent ?? '').slice(0, 160);
      return {
        id: node.id,
        tag: node.type,
        name: node.name ?? null,
        role: elementSemanticType(node, nodes),
        text: text || null,
        ...(Object.keys(node.attrs ?? {}).length > 0 ? { attrs: node.attrs } : {}),
        children: depth >= maxDepth
          ? (node.children ?? []).length > 0 ? `${(node.children ?? []).length} more, deeper` : []
          : (node.children ?? []).map((c) => build(c, depth + 1)).filter(Boolean),
      };
    };

    // `build` increments `count` as it walks, so the tree is built BEFORE the
    // result object reads it — inlining the call would read a stale zero.
    const tree = build(target.id, 1);
    return { ok: true, revision: currentRevision(), nodeCount: count, tree };
  },
  summarize: (_a, result) => (result.ok
    ? `Read ${(result as unknown as { nodeCount: number }).nodeCount} element(s) in detail`
    : 'Could not read that part of the page'),
  targets: (args) => (typeof args.element_id === 'string' ? [args.element_id] : store.get(selectedIdsAtom)),
});

// ─── weave_get_history ──────────────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_get_history',
  description:
    'Read what has happened to this project recently — your own calls, the human’s ' +
    'approvals, and which of you did each thing. Use this to catch up after the ' +
    'human has been working, or to check whether a change you proposed was applied.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'How many entries to return, newest first. Defaults to 20.' },
    },
    additionalProperties: false,
  },
  annotations: { title: 'Read recent activity', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  kind: 'read',
  run: (args) => {
    const limit = Math.min(Math.max(typeof args.limit === 'number' ? args.limit : 20, 1), 100);
    const entries = store.get(weaveActivityAtom).slice(0, limit).map((e) => ({
      at: e.at,
      by: e.source,
      kind: e.kind,
      summary: e.summary,
      tool: e.tool,
      ok: e.ok,
    }));
    return {
      ok: true,
      revision: currentRevision(),
      canUndo: getHistoryState().canUndo,
      canRedo: getHistoryState().canRedo,
      count: entries.length,
      activity: entries,
    };
  },
  summarize: (_a, result) => (result.ok
    ? `Read ${(result as unknown as { count: number }).count} recent action(s)`
    : 'Could not read the activity'),
});

// ─── weave_diff_since ───────────────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_diff_since',
  description:
    'Find out what changed since a revision you saw earlier — which sections were ' +
    'added, removed or renamed. Use this when your proposal was refused as out of ' +
    'date, or after the human has been editing, to catch up without re-reading the ' +
    'whole page.',
  inputSchema: {
    type: 'object',
    properties: {
      revision: { type: 'number', description: 'The revision you last read, from weave_get_context.' },
    },
    required: ['revision'],
    additionalProperties: false,
  },
  annotations: { title: 'See what changed', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  kind: 'read',
  run: (args) => {
    const since = typeof args.revision === 'number' ? args.revision : NaN;
    if (!Number.isFinite(since)) return toolError('INVALID_ARGS', 'Pass the revision number you last read.');
    const now = currentRevision();
    if (since > now) {
      return toolError('INVALID_ARGS', `Revision ${since} is in the future; the project is at ${now}.`);
    }

    // The activity feed is the record of what happened; entries carry the
    // revision they produced, so this reports real actions rather than a
    // reconstructed guess.
    const changes = store.get(weaveActivityAtom)
      .filter((e) => e.kind === 'write' || e.kind === 'proposal' || e.kind === 'approval')
      .filter((e) => (e.revision ?? 0) > since)
      .map((e) => ({ at: e.at, by: e.source, summary: e.summary, revision: e.revision ?? null }));

    const nodes = store.get(nodesAtom);
    return {
      ok: true,
      fromRevision: since,
      toRevision: now,
      changed: now !== since,
      changes,
      sections: (nodes.get('root')?.children ?? []).map((id) => ({ id, name: nodes.get(id)?.name ?? null })),
      note: now === since
        ? 'Nothing has changed since that revision.'
        : 'The project has moved on; re-read weave_get_context before proposing against it.',
    };
  },
  summarize: (args, result) => (result.ok
    ? ((result as unknown as { changed: boolean }).changed
      ? `Project moved from revision ${String(args.revision)} to ${(result as unknown as { toRevision: number }).toRevision}`
      : 'Nothing changed since that revision')
    : 'Could not compare revisions'),
});

// ─── weave_explain_finding ──────────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_explain_finding',
  description:
    'Take a problem found by weave_validate_site and get back the concrete edits ' +
    'that would fix it, ready to submit through weave_propose_changes. Use this to ' +
    'turn "this image has no alternative text" into an actual proposed change.',
  inputSchema: {
    type: 'object',
    properties: {
      element_id: { type: 'string', description: 'The element a finding pointed at.' },
    },
    additionalProperties: false,
  },
  annotations: { title: 'Explain how to fix a finding', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  kind: 'read',
  run: (args) => {
    const report = validateSite();
    store.set(lastValidationAtom, report);
    const wanted = typeof args.element_id === 'string' ? args.element_id : null;
    const issues = wanted ? report.issues.filter((i) => i.target === wanted) : report.issues;
    if (issues.length === 0) {
      return {
        ok: true, revision: currentRevision(), score: report.score, findings: [],
        note: wanted ? `Nothing is wrong with "${wanted}".` : 'No problems found.',
      };
    }

    const nodes = store.get(nodesAtom);
    const findings = issues.map((issue) => {
      const node = issue.target ? nodes.get(issue.target) : null;
      const fixes: WeaveOperation[] = [];
      const code = issue.code ?? '';
      if (node) {
        if (code.includes('ALT')) {
          fixes.push({ op: 'update_attrs', target: node.id, attrs: { alt: 'Describe what this image shows' } });
        } else if (code.includes('LINK') || code.includes('HREF')) {
          fixes.push({ op: 'set_link', target: node.id, href: '/' });
        } else if (code.includes('NAME')) {
          fixes.push({ op: 'rename', target: node.id, name: 'Describe this element' });
        } else if (code.includes('SEMANTIC') || code.includes('TYPE')) {
          fixes.push({ op: 'change_tag', target: node.id, tag: 'section' });
        } else if (code.includes('EMPTY') || code.includes('TEXT')) {
          fixes.push({ op: 'update_text', target: node.id, value: 'Write the real text here' });
        }
      }
      if (code.includes('METADATA') || code.includes('TITLE') || code.includes('DESCRIPTION')) {
        fixes.push({ op: 'set_metadata', title: 'A descriptive page title', description: 'A one sentence description of this page.' });
      }
      return {
        code: issue.code ?? null,
        message: issue.message,
        target: issue.target ?? null,
        element: node ? { id: node.id, tag: node.type, name: node.name ?? null } : null,
        suggestedOperations: fixes,
        note: fixes.length === 0 ? 'This one needs a human judgement call.' : undefined,
      };
    });

    return {
      ok: true,
      revision: currentRevision(),
      score: report.score,
      findings,
      message: 'Values here are placeholders — replace them with real content before proposing.',
    };
  },
  summarize: (_a, result) => (result.ok
    ? `Explained ${(result as unknown as { findings: unknown[] }).findings.length} finding(s)`
    : 'Could not explain those findings'),
  targets: (_a, result) => {
    if (!result.ok) return undefined;
    return (result as unknown as { findings: Array<{ target: string | null }> }).findings
      .map((f) => f.target).filter((t): t is string => !!t).slice(0, 8);
  },
});

// ─── weave_screenshot_element ───────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_screenshot_element',
  description:
    'Render one element to an image and return it, so you can see how it actually ' +
    'looks. Use this sparingly and only when appearance is the question — the ' +
    'structured reads describe the page far more cheaply, and an image carries no ' +
    'ids you can act on.',
  inputSchema: {
    type: 'object',
    properties: {
      element_id: { type: 'string', description: 'Element to render. Defaults to the current selection.' },
      format: { type: 'string', enum: ['png', 'jpeg'], description: 'Image format. Defaults to png.' },
      scale: { type: 'number', description: 'Resolution multiplier, 1 or 2. Defaults to 1.' },
    },
    additionalProperties: false,
  },
  annotations: { title: 'Render an element to an image', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  kind: 'read',
  appliesWhen: (s) => s.hasSelection,
  run: async (args) => {
    const target = resolveTarget(args);
    if ('ok' in target) return target;
    const bridge = getCanvasBridge() as {
      captureElement?: (
        nodeId: string, vpPrefix: string,
        opts: { format: 'png' | 'jpeg' | 'svg'; pixelRatio: number; backgroundColor?: string },
      ) => Promise<string | null>;
    };
    if (typeof bridge.captureElement !== 'function') {
      return toolError('CAPTURE_UNAVAILABLE', 'The canvas is not rendering right now, so nothing can be captured.');
    }
    const format = args.format === 'jpeg' ? 'jpeg' : 'png';
    const scale = args.scale === 2 ? 2 : 1;
    try {
      const vp = String(store.get(interactingViewportIdAtom) ?? 'desktop');
      const dataUrl = await bridge.captureElement(target.id, getViewportPrefix(vp), {
        format, pixelRatio: scale,
        // JPEG has no alpha channel — a transparent element would come out black.
        backgroundColor: format === 'jpeg' ? '#ffffff' : undefined,
      });
      if (!dataUrl) return toolError('CAPTURE_FAILED', 'That element could not be rendered — it may not be on screen.');
      return {
        ok: true, revision: currentRevision(), element: target.id, format,
        bytes: dataUrl.length, image: dataUrl,
      };
    } catch (err) {
      trace.error('weave:screenshot-failed', err);
      return toolError('CAPTURE_FAILED', 'That element could not be rendered.');
    }
  },
  summarize: (_a, result) => (result.ok ? 'Rendered an element to an image' : 'Could not render that element'),
  targets: (args) => (typeof args.element_id === 'string' ? [args.element_id] : store.get(selectedIdsAtom)),
});

// ─── weave_get_page_behaviour ───────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_get_page_behaviour',
  description:
    'Read the page’s variables, what each is bound to, and which elements respond ' +
    'to clicks or hovers. Use this to understand how an existing page already ' +
    'behaves before adding to it, so you extend the behaviour rather than ' +
    'duplicating or breaking it.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { title: 'Read the page’s behaviour', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  kind: 'read',
  run: () => {
    const code = activeCode();
    const nodes = store.get(nodesAtom);
    const variables = getPageVariables(code).map((v) => ({
      name: v.name, type: v.type, default: v.default,
      ...(v.description ? { description: v.description } : {}),
    }));
    const interactions = parseAllPageInteractions(code).map((i) => ({
      element: i.nodeId,
      elementName: nodes.get(i.nodeId)?.name ?? null,
      trigger: i.trigger,
      sets: i.varName,
      to: i.value,
    }));
    return {
      ok: true, revision: currentRevision(),
      variables, interactions,
      note: variables.length === 0 && interactions.length === 0
        ? 'This page has no interactive behaviour yet.'
        : undefined,
    };
  },
  summarize: (_a, result) => {
    if (!result.ok) return 'Could not read the page behaviour';
    const r = result as unknown as { variables: unknown[]; interactions: unknown[] };
    return `Read page behaviour — ${r.variables.length} variable(s), ${r.interactions.length} interaction(s)`;
  },
});

// ─── weave_read_translation ─────────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_read_translation',
  description:
    'Read what an element currently says in one of the site’s other languages, so ' +
    'you can check what is already translated before writing over it.',
  inputSchema: {
    type: 'object',
    properties: {
      element_id: { type: 'string', description: 'Element to read. Defaults to the current selection.' },
      locale: { type: 'string', description: 'Language code, e.g. "hi".' },
    },
    required: ['locale'],
    additionalProperties: false,
  },
  annotations: { title: 'Read a translation', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  kind: 'read',
  appliesWhen: (s) => s.hasSelection && s.hasLocales,
  run: (args) => {
    const target = resolveTarget(args);
    if ('ok' in target) return target;
    const locale = String(args.locale);
    const codes = getI18nConfig().locales.map((l) => l.code);
    if (!codes.includes(locale)) {
      return toolError('LOCALE_NOT_FOUND', `This project has no "${locale}" locale. Available: ${codes.join(', ')}.`);
    }
    const node = getNode(target.id)!;
    const translated = readTranslationText({
      filePath: store.get(activeFilePathAtom), key: target.id, locale,
    });
    return {
      ok: true, revision: currentRevision(),
      element: target.id, locale,
      original: node.textContent ?? null,
      translated,
      note: translated === null ? 'Not translated yet — visitors see the original text.' : undefined,
    };
  },
  summarize: (args, result) => (result.ok
    ? `Read the ${String(args.locale)} text of an element`
    : 'Could not read that translation'),
  targets: (args) => (typeof args.element_id === 'string' ? [args.element_id] : store.get(selectedIdsAtom)),
});

// Re-exported so `init.ts` importing this module is unambiguous — the module
// is loaded for its `defineWeaveTool` side effects.
export const ADVANCED_TOOLS_LOADED = true;
