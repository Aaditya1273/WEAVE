// WEAVE addition (not upstream Revyme) — see src/weave/README.md.
//
// tools.ts — the WEAVE WebMCP tool surface.
//
// Each tool is a thin, strictly-schema'd wrapper over `commands.ts` (the one
// action pipeline) or `changeset.ts` (proposals). No tool contains authoring
// logic of its own, so a WebMCP call, a Test Console run and a human panel
// edit converge on the same mutation, the same generated source and the same
// undo entry.
//
// Descriptions state PRODUCT INTENT ("Move a page section to a new position"),
// never DOM mechanics, and carry no instructions to the model beyond what the
// tool does — a tool description is an injection surface, so it stays purely
// descriptive.

import { getDefaultStore } from 'jotai';
import { nodesAtom, selectedIdsAtom } from '@/code/stores/store';
import type { CanvasNode } from '@/code/parsing/parser';
import { buildWeaveContext, describeSelection } from './context';
import { requestPublish } from './publish';
import { pendingPublishAtom, lastValidationAtom } from './store';
import { validateSite, setToolCountProvider } from './validate';
import { currentRevision, settleRevision } from './revision';
import {
  executeOperation, SECTION_TYPES, getNode,
  type WeaveOperation,
} from './commands';
import {
  proposeChangeSet, getChangeSet, serializeChangeSet, pendingChangeSets,
} from './changeset';
import {
  defineWeaveTool, toolError, getWeaveTools, applicableTools,
  type WeaveToolResult,
} from './webmcp/registry';

const store = getDefaultStore();

// The readiness score reports the REAL number of exposed tools. validate.ts
// cannot import the registry (it would close a cycle), so the count is
// injected from here — the one module that owns the tool surface.
setToolCountProvider(() => applicableTools().length);

// ─── Shared helpers ─────────────────────────────────────────────────────────

function elementNotFound(id: unknown): WeaveToolResult {
  return toolError('ELEMENT_NOT_FOUND', `Element "${String(id)}" no longer exists on the current page.`);
}

/** Resolve the element a tool acts on: an explicit id, else the human's
 *  single selection. Ambiguity is an error, never a guess. */
function resolveTarget(args: Record<string, unknown>): { id: string } | WeaveToolResult {
  const explicit = args.element_id;
  if (typeof explicit === 'string' && explicit) {
    return getNode(explicit) ? { id: explicit } : elementNotFound(explicit);
  }
  const selection = store.get(selectedIdsAtom);
  if (selection.length === 0) {
    return toolError('NO_TARGET', 'Nothing is selected. Pass element_id, or ask the human to select an element.');
  }
  if (selection.length > 1) {
    return toolError('AMBIGUOUS_TARGET', `${selection.length} elements are selected. Pass element_id to choose one.`);
  }
  return { id: selection[0] };
}

/** Compact node description shared by selection reads and mutation receipts. */
function describeNode(node: CanvasNode): Record<string, unknown> {
  const nodes = store.get(nodesAtom);
  return {
    id: node.id,
    tag: node.type,
    name: node.name ?? null,
    parent: node.parentId && nodes.has(node.parentId) ? node.parentId : null,
    children: (node.children ?? []).filter((c) => nodes.has(c)),
    text: node.textContent ?? null,
    styles: node.styles ?? {},
    attrs: node.attrs ?? {},
  };
}

/** Run one operation and shape the tool result. */
function runOperation(operation: WeaveOperation, extra: Record<string, unknown> = {}): WeaveToolResult {
  const result = executeOperation(operation);
  if (!result.ok) return toolError(result.error.code, result.error.message);
  const revision = settleRevision();
  return { ok: true, revision, ...extra, ...result.detail };
}

// ─── weave_get_context ──────────────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_get_context',
  description:
    'Read the structured state of the website being edited: project and page, ' +
    'current revision, the human’s selection, the ordered list of page sections with ' +
    'their semantic types, a bounded element tree with stable ids, any proposals ' +
    'awaiting human review, and the actions currently available. Re-read this after ' +
    'the human edits the page — the revision number changes whenever the project does, ' +
    'and a proposal built against an old revision will be refused.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { title: 'Read project context', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  kind: 'read',
  run: () => ({ ok: true, ...buildWeaveContext() }),
  summarize: () => {
    const ctx = buildWeaveContext() as { nodeCount?: number; sections?: unknown[] };
    return `Read page context — ${ctx.sections?.length ?? 0} sections, ${ctx.nodeCount ?? 0} elements`;
  },
});

// ─── weave_get_selection ────────────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_get_selection',
  description:
    'Read full detail for the element the human currently has selected on the canvas ' +
    '(or a specific element by id): its type, name, parent and children, text content, ' +
    'styles, attributes, and which WEAVE actions apply to it.',
  inputSchema: {
    type: 'object',
    properties: {
      element_id: { type: 'string', description: 'Read this element instead of the current selection.' },
    },
    additionalProperties: false,
  },
  annotations: { title: 'Read selected element', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  kind: 'read',
  appliesWhen: (s) => s.hasSelection,
  run: (args) => {
    const ids = typeof args.element_id === 'string' && args.element_id
      ? [args.element_id]
      : store.get(selectedIdsAtom);
    if (ids.length === 0) {
      return { ok: true, selection: [], note: 'Nothing is selected. Call weave_get_context for the page element tree.' };
    }
    const found = ids.map((id) => getNode(id)).filter((n): n is CanvasNode => !!n);
    if (found.length === 0) return elementNotFound(ids[0]);
    return { ok: true, revision: currentRevision(), selection: found.map((n) => describeSelection(n)) };
  },
  summarize: (args, result) => {
    const sel = (result as { selection?: unknown[] }).selection ?? [];
    return sel.length === 0 ? 'Read selection — nothing selected' : `Read selection — ${sel.length} element(s)`;
  },
  targets: (args) => (typeof args.element_id === 'string' ? [args.element_id] : store.get(selectedIdsAtom)),
});

// ─── weave_add_section ──────────────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_add_section',
  description:
    'Add a complete, professionally designed section to the current page from WEAVE’s ' +
    'section library. The section lands after the given element, or at the end of the ' +
    'page by default, and every element inside it is immediately editable by the human ' +
    'and by weave_update_element.',
  inputSchema: {
    type: 'object',
    properties: {
      section_type: { type: 'string', enum: SECTION_TYPES, description: 'Which kind of section to add.' },
      after_element_id: { type: 'string', description: 'Id of the section to insert after. Defaults to the end of the page.' },
    },
    required: ['section_type'],
    additionalProperties: false,
  },
  annotations: { title: 'Add a page section', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  kind: 'write',
  run: (args) => runOperation({
    op: 'add_section',
    sectionType: String(args.section_type),
    afterElementId: typeof args.after_element_id === 'string' ? args.after_element_id : undefined,
  }),
  summarize: (args, result) => result.ok
    ? `Added a ${String(args.section_type)} section`
    : `Could not add a ${String(args.section_type)} section`,
  targets: (_a, result) => (result.ok ? (result as { created?: string[] }).created : undefined),
});

// ─── weave_update_element ───────────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_update_element',
  description:
    'Change the content or appearance of one element: its text, its layer name, whether ' +
    'it is visible, a safe subset of CSS styles, and link/image attributes such as href, ' +
    'src and alt. Acts on the human’s current selection unless element_id is given. ' +
    'Style properties and attribute values outside the supported set are rejected.',
  inputSchema: {
    type: 'object',
    properties: {
      element_id: { type: 'string', description: 'Element to update. Defaults to the current selection.' },
      text: { type: 'string', description: 'New text content for a text element.' },
      name: { type: 'string', description: 'New layer name, used by humans and agents to refer to the element.' },
      visible: { type: 'boolean', description: 'false hides the element; true restores it.' },
      styles: { type: 'object', description: 'CSS properties as camelCase keys with string values, e.g. { "fontSize": "56px" }.' },
      attrs: { type: 'object', description: 'HTML attributes: href, src, alt, title, target, rel, aria-label.' },
    },
    additionalProperties: false,
  },
  annotations: { title: 'Update an element', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  kind: 'write',
  appliesWhen: (s) => s.hasSelection,
  run: (args) => {
    const target = resolveTarget(args);
    if ('ok' in target) return target;
    const id = target.id;

    const operations: WeaveOperation[] = [];
    if (typeof args.text === 'string') operations.push({ op: 'update_text', target: id, value: args.text });
    if (typeof args.name === 'string') operations.push({ op: 'rename', target: id, name: args.name });
    if (typeof args.visible === 'boolean') operations.push({ op: 'set_visible', target: id, visible: args.visible });
    if (args.styles && typeof args.styles === 'object' && !Array.isArray(args.styles)) {
      operations.push({ op: 'update_style', target: id, styles: args.styles as Record<string, string> });
    }
    if (args.attrs && typeof args.attrs === 'object' && !Array.isArray(args.attrs)) {
      operations.push({ op: 'update_attrs', target: id, attrs: args.attrs as Record<string, string> });
    }
    if (operations.length === 0) {
      return toolError('NO_CHANGES', 'Pass at least one of: text, name, visible, styles, attrs.');
    }

    const changed: string[] = [];
    for (const operation of operations) {
      const result = executeOperation(operation);
      if (!result.ok) return toolError(result.error.code, result.error.message);
      changed.push(operation.op);
    }
    const node = getNode(id);
    return { ok: true, revision: settleRevision(), element: node ? describeNode(node) : { id }, changed };
  },
  summarize: (args, result) => {
    const id = typeof args.element_id === 'string' ? args.element_id : 'selection';
    if (!result.ok) return `Could not update ${id}`;
    const el = (result as { element?: { name?: string; id?: string } }).element;
    return `Updated ${el?.name || el?.id || id}`;
  },
  targets: (args, result) => {
    const el = (result as { element?: { id?: string } }).element;
    const id = el?.id ?? (typeof args.element_id === 'string' ? args.element_id : undefined);
    return id ? [id] : undefined;
  },
});

// ─── weave_move_element ─────────────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_move_element',
  description:
    'Move a page section or element to a new position: reorder it among its siblings ' +
    'with index, or place it inside a different parent with new_parent_id. Use this to ' +
    'change the order sections appear in on the page.',
  inputSchema: {
    type: 'object',
    properties: {
      element_id: { type: 'string', description: 'Element to move. Defaults to the current selection.' },
      new_parent_id: { type: 'string', description: 'Move the element inside this element. Omit to reorder in place.' },
      index: { type: 'number', description: 'Zero-based position among siblings. 0 puts the element first.' },
    },
    additionalProperties: false,
  },
  annotations: { title: 'Move or reorder an element', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  kind: 'write',
  appliesWhen: (s) => s.hasSelection,
  run: (args) => {
    const target = resolveTarget(args);
    if ('ok' in target) return target;
    return runOperation({
      op: 'move',
      target: target.id,
      parent: typeof args.new_parent_id === 'string' ? args.new_parent_id : undefined,
      index: typeof args.index === 'number' ? args.index : undefined,
    }, { moved: target.id });
  },
  summarize: (args, result) => {
    const id = (result as { moved?: string }).moved ?? String(args.element_id ?? 'selection');
    return result.ok ? `Moved ${id}` : `Could not move ${id}`;
  },
  targets: (_a, result) => {
    const id = (result as { moved?: string }).moved;
    return id ? [id] : undefined;
  },
});

// ─── weave_delete_element ───────────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_delete_element',
  description:
    'Permanently remove an element and everything inside it from the page. This is a ' +
    'destructive edit: it deletes the human’s content. It is undoable in the editor, ' +
    'but prefer proposing a deletion through weave_propose_changes when removing a ' +
    'whole section, so the human can review it before it happens.',
  inputSchema: {
    type: 'object',
    properties: {
      element_id: { type: 'string', description: 'Element to delete. Defaults to the current selection.' },
    },
    additionalProperties: false,
  },
  annotations: { title: 'Delete an element', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  kind: 'write',
  appliesWhen: (s) => s.hasSelection,
  run: (args) => {
    const target = resolveTarget(args);
    if ('ok' in target) return target;
    const node = getNode(target.id)!;
    const summary = { id: node.id, tag: node.type, name: node.name ?? null };
    return runOperation({ op: 'delete', target: target.id }, { deleted: summary, undoable: true });
  },
  summarize: (args, result) => {
    const deleted = (result as { deleted?: { name?: string; id?: string } }).deleted;
    return result.ok ? `Deleted ${deleted?.name || deleted?.id}` : `Could not delete ${String(args.element_id ?? 'selection')}`;
  },
});

// ─── weave_propose_changes ──────────────────────────────────────────────────

const OPERATION_DOC =
  'Each operation is an object with an "op" field: ' +
  '{"op":"update_text","target":ELEMENT_ID,"value":TEXT} · ' +
  '{"op":"rename","target":ELEMENT_ID,"name":TEXT} · ' +
  '{"op":"update_style","target":ELEMENT_ID,"styles":{CSS}} · ' +
  '{"op":"update_attrs","target":ELEMENT_ID,"attrs":{HTML_ATTRS}} · ' +
  '{"op":"set_visible","target":ELEMENT_ID,"visible":BOOL} · ' +
  '{"op":"move","target":ELEMENT_ID,"index":N} or {"op":"move","target":ELEMENT_ID,"parent":ELEMENT_ID,"index":N} · ' +
  `{"op":"add_section","sectionType":ONE_OF(${SECTION_TYPES.join('|')}),"afterElementId":ELEMENT_ID} · ` +
  '{"op":"delete","target":ELEMENT_ID}';

defineWeaveTool({
  name: 'weave_propose_changes',
  description:
    'Propose several related edits as ONE reviewable change, instead of applying them ' +
    'one at a time. Use this for any request that touches more than one element — ' +
    'rewriting a hero, restructuring a page, adding and then populating a section. ' +
    'The proposal is shown to the human, who can edit individual values, skip parts ' +
    'of it, apply it or reject it; accepted operations then commit together as one ' +
    'undoable revision. Nothing changes on the page until the human applies it. ' +
    'The proposal is pinned to the current revision and is refused if the human ' +
    'edits the page first. ' + OPERATION_DOC,
  inputSchema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'One line stating the intent, shown to the human as the proposal title.' },
      operations: { type: 'array', description: 'The edits to propose, in the order they should apply.', items: { type: 'object' } },
    },
    required: ['summary', 'operations'],
    additionalProperties: false,
  },
  annotations: { title: 'Propose changes for human review', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, requiresHumanApproval: true },
  kind: 'proposal',
  run: (args) => {
    const result = proposeChangeSet({
      summary: String(args.summary ?? ''),
      operations: (args.operations ?? []) as WeaveOperation[],
      source: 'agent',
    });
    if (!result.ok || !result.changeset) {
      return toolError(result.error?.code ?? 'INVALID_ARGS', result.error?.message ?? 'Could not create the proposal.');
    }
    return {
      ok: true,
      status: 'awaiting_human_review',
      changeset: serializeChangeSet(result.changeset),
      message: 'Proposal sent to the human for review. Nothing has changed on the page yet. Poll weave_get_context to see the outcome.',
    };
  },
  summarize: (args, result) => {
    const ops = Array.isArray(args.operations) ? args.operations.length : 0;
    return result.ok ? `Proposed “${String(args.summary)}” — ${ops} operations` : 'Proposal rejected';
  },
  targets: (args) => {
    const ops = Array.isArray(args.operations) ? args.operations : [];
    return ops.map((o) => (o as { target?: string })?.target).filter((t): t is string => typeof t === 'string');
  },
});

// ─── weave_validate_site ────────────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_validate_site',
  description:
    'Check the current page for problems that would make it hard for people or agents ' +
    'to use: images without alternative text, links and buttons with no destination, ' +
    'unnamed or empty sections, sections with no recognisable type, empty text, and ' +
    'missing page metadata. Returns each finding with the element id it refers to, ' +
    'plus an explainable agent-readiness score out of 100.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { title: 'Validate the site', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  kind: 'read',
  run: () => {
    const report = validateSite();
    store.set(lastValidationAtom, report);
    return {
      ok: true,
      valid: report.valid,
      score: report.score,
      revision: currentRevision(),
      issues: report.issues,
      checks: report.checks.map((c) => ({ id: c.id, label: c.label, earned: c.earned, weight: c.weight, passed: c.passed, detail: c.detail })),
    };
  },
  summarize: (_a, result) => {
    if (!result.ok) return 'Validation failed';
    const r = result as unknown as { score: number; issues: unknown[] };
    return `Validated site — readiness ${r.score}%, ${r.issues.length} findings`;
  },
  targets: (_a, result) => {
    if (!result.ok) return undefined;
    const issues = (result as unknown as { issues: Array<{ target: string | null }> }).issues;
    return issues.map((i) => i.target).filter((t): t is string => !!t).slice(0, 8);
  },
});

// ─── weave_publish_site ─────────────────────────────────────────────────────

defineWeaveTool({
  name: 'weave_publish_site',
  description:
    'Ask the human to publish the site. This never publishes on its own: it opens an ' +
    'approval card in the WEAVE Agent panel showing the revision and what changed, and ' +
    'only the human’s explicit approval runs the publish. Poll weave_get_context to see ' +
    'whether the request is still awaiting approval.',
  inputSchema: {
    type: 'object',
    properties: {
      note: { type: 'string', description: 'Optional message shown to the human with the request.' },
    },
    additionalProperties: false,
  },
  annotations: { title: 'Request publish (human approves)', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, requiresHumanApproval: true },
  kind: 'approval',
  run: (args) => {
    if (store.get(pendingPublishAtom)) {
      return toolError('PUBLISH_ALREADY_PENDING', 'A publish request is already awaiting human approval.');
    }
    const revision = settleRevision();
    requestPublish('agent', typeof args.note === 'string' ? args.note : undefined);
    return {
      ok: true,
      status: 'awaiting_human_approval',
      revision,
      message: 'Publish requested. The human must approve it in the WEAVE Agent panel before anything is published.',
    };
  },
  summarize: (_a, result) => result.ok
    ? `Requested publish of revision ${(result as unknown as { revision: number }).revision} — awaiting human approval`
    : 'Publish request rejected',
});

export { getWeaveTools, pendingChangeSets, getChangeSet };
