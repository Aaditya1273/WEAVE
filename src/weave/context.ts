// WEAVE addition (not upstream Revyme) — see src/weave/README.md.
//
// context.ts — the semantic project snapshot an agent reads.
//
// This is deliberately NOT a DOM dump. It is built from the same parsed
// `CanvasNode` model the canvas renders from, so every id an agent receives is
// a real, stable `data-id` in the user's source that the human can select and
// the tools can address. Sections carry a semantic TYPE (hero, products, faq…)
// rather than a tag name, so an agent reasons in the same vocabulary the
// section library and `weave_add_section` use.
//
// The snapshot carries the project REVISION. That number is the contract
// between the two actors: an agent reasons about revision 42, the human drags
// a section, the project becomes revision 43, and any proposal still pinned to
// 42 is refused as stale instead of being applied to state the agent never saw.
//
// Delivery is pull-based on purpose. The shipping WebMCP surface has no
// reliable push channel for page content, so rather than pretend otherwise the
// context version is bumped on every change and agents re-read through
// `weave_get_context`.

import { getDefaultStore } from 'jotai';
import { nodesAtom, selectedIdsAtom } from '@/code/stores/store';
import { activeFilePathAtom } from '@/code/project/active-file-store';
import { viewportsConfigAtom } from '@/code/stores/viewport-store';
import { projectFS } from '@/code/project/project-fs';
import type { CanvasNode } from '@/code/parsing/parser';
import { trace } from '@/shared/debug-trace';
import { weaveContextVersionAtom, lastValidationAtom, pendingPublishAtom } from './store';
import { currentRevision, onRevision, subscribeRevision } from './revision';
import { sectionSemanticType } from './validate';
import { pendingChangeSets, serializeChangeSet } from './changeset';
import { applicableTools } from './webmcp/registry';

const store = getDefaultStore();

// ─── Bounds ─────────────────────────────────────────────────────────────────
// The snapshot must stay inside an agent's token budget. A page over the cap
// returns a truncated tree plus `truncated: true`, and the agent drills in with
// weave_get_selection rather than receiving an unusable wall of nodes.

const MAX_TREE_NODES = 260;
const MAX_TEXT = 120;

function clip(text: string | undefined): string | undefined {
  if (!text) return undefined;
  return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + '…' : text;
}

// ─── Semantic element typing ────────────────────────────────────────────────

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const TEXT_TAGS = new Set(['p', 'span', 'li', 'blockquote']);

/**
 * Largest px value in a font-size, or null when there is none.
 *
 * Responsive type is authored as `clamp(56px, 9vw, 124px)`, and a naive
 * `parseInt` returns NaN on that — which typed the EMBER hero's headline, the
 * most important element on the page, as ordinary body text in the agent's
 * context. Taking the largest px in the expression classifies fluid type by
 * the size it actually reaches.
 */
function largestPx(value: string | undefined): number | null {
  if (!value) return null;
  const matches = value.match(/(\d+(?:\.\d+)?)px/g);
  if (!matches || matches.length === 0) return null;
  return Math.max(...matches.map((m) => parseFloat(m)));
}

/** What KIND of thing an element is, in product terms. */
export function elementSemanticType(node: CanvasNode, nodes: Map<string, CanvasNode>): string {
  if (HEADING_TAGS.has(node.type)) return 'heading';
  if (node.type === 'a') return 'link';
  if (node.type === 'img') return 'image';
  if (node.styles?.backgroundImage && node.styles.backgroundImage !== 'none') return 'image';
  if (TEXT_TAGS.has(node.type)) {
    // A large line of text reads as a heading even when it is authored as a
    // <p>, which the section library does throughout.
    const size = largestPx(node.styles?.fontSize);
    if (size !== null && size >= 32) return 'heading';
    return 'text';
  }
  const name = (node.name ?? '').toLowerCase();
  if (/button|cta/.test(name)) return 'button';
  if (!node.parentId || !nodes.has(node.parentId)) return 'page';
  if (nodes.get(node.parentId)?.id === 'root') return 'section';
  return 'container';
}

// ─── Tree ───────────────────────────────────────────────────────────────────

export interface WeaveContextNode {
  id: string;
  type: string;
  tag: string;
  name?: string;
  text?: string;
  children?: WeaveContextNode[];
}

function buildTree(
  nodes: Map<string, CanvasNode>,
  id: string,
  budget: { left: number },
): WeaveContextNode | null {
  const node = nodes.get(id);
  if (!node || budget.left <= 0) return null;
  budget.left--;
  const out: WeaveContextNode = { id: node.id, type: elementSemanticType(node, nodes), tag: node.type };
  if (node.name) out.name = node.name;
  const text = clip(node.textContent);
  if (text) out.text = text;
  const kids: WeaveContextNode[] = [];
  for (const childId of node.children ?? []) {
    const child = buildTree(nodes, childId, budget);
    if (child) kids.push(child);
  }
  if (kids.length > 0) out.children = kids;
  return out;
}

function rootIds(nodes: Map<string, CanvasNode>): string[] {
  return [...nodes.values()]
    .filter((n) => !n.parentId || !nodes.has(n.parentId))
    .map((n) => n.id);
}

// ─── Selection detail ───────────────────────────────────────────────────────

/** Full, agent-facing description of one element. */
export function describeSelection(node: CanvasNode): Record<string, unknown> {
  const nodes = store.get(nodesAtom);
  const parent = node.parentId && nodes.has(node.parentId) ? nodes.get(node.parentId)! : null;
  return {
    id: node.id,
    type: elementSemanticType(node, nodes),
    tag: node.type,
    name: node.name ?? null,
    text: node.textContent ?? null,
    parent: parent ? { id: parent.id, name: parent.name ?? null } : null,
    positionInParent: parent ? parent.children.indexOf(node.id) : null,
    children: (node.children ?? []).filter((c) => nodes.has(c)).map((c) => ({
      id: c, type: elementSemanticType(nodes.get(c)!, nodes), name: nodes.get(c)!.name ?? null,
    })),
    layout: {
      display: node.styles?.display ?? null,
      flexDirection: node.styles?.flexDirection ?? null,
      width: node.styles?.width ?? null,
      height: node.styles?.height ?? null,
      padding: node.styles?.padding ?? null,
      gap: node.styles?.gap ?? null,
    },
    styles: node.styles ?? {},
    attrs: node.attrs ?? {},
    availableActions: ['weave_update_element', 'weave_move_element', 'weave_delete_element', 'weave_propose_changes'],
  };
}

// ─── Pages ──────────────────────────────────────────────────────────────────

/** `app/about/page.client.tsx` → `/about`; route groups `(x)` are stripped. */
export function pageFileToRoute(path: string): string {
  const route = path
    .replace(/^app\//, '')
    .replace(/page(\.client)?\.tsx$/, '')
    .split('/')
    .filter((seg) => seg && !seg.startsWith('('))
    .join('/');
  return '/' + route.replace(/\/$/, '');
}

export function listPages(): Array<{ route: string; file: string }> {
  return projectFS
    .listFiles()
    .filter((f) => /(^|\/)page\.client\.tsx$/.test(f))
    .sort()
    .map((file) => ({ route: pageFileToRoute(file), file }));
}

/** The site's display name, read from the project's own metadata. */
export function projectName(): string {
  const source = projectFS.readFile('app/layout.tsx') ?? '';
  const match = source.match(/title\s*:\s*['"`]([^'"`]+)['"`]/);
  return match?.[1]?.trim() || 'Untitled site';
}

// ─── Snapshot ───────────────────────────────────────────────────────────────

export function buildWeaveContext(): Record<string, unknown> {
  const nodes = store.get(nodesAtom);
  const activeFile = store.get(activeFilePathAtom);
  const selection = store.get(selectedIdsAtom);
  const viewports = store.get(viewportsConfigAtom);
  const validation = store.get(lastValidationAtom);
  const pendingPublish = store.get(pendingPublishAtom);

  const budget = { left: MAX_TREE_NODES };
  const tree = rootIds(nodes)
    .map((id) => buildTree(nodes, id, budget))
    .filter((n): n is WeaveContextNode => n !== null);

  const pageRoot = nodes.get('root');
  const sections = (pageRoot?.children ?? [])
    .map((id) => nodes.get(id))
    .filter((n): n is CanvasNode => !!n)
    .map((n, index) => ({
      id: n.id,
      name: n.name ?? null,
      type: sectionSemanticType(n) ?? 'unknown',
      index,
    }));

  const selectedNodes = selection
    .map((id) => nodes.get(id))
    .filter((n): n is CanvasNode => !!n);

  return {
    project: {
      name: projectName(),
      page: pageFileToRoute(activeFile),
      pageFile: activeFile,
      revision: currentRevision(),
      contextVersion: store.get(weaveContextVersionAtom),
    },
    pages: listPages(),
    viewport: viewports.find((v: { isPrimary?: boolean }) => v.isPrimary)?.id ?? viewports[0]?.id ?? 'desktop',
    viewports: viewports.map((v: { id: string; label: string; width: number }) => ({ id: v.id, label: v.label, width: v.width })),
    selection: selectedNodes.length === 0
      ? { count: 0, ids: [], elements: [] }
      : {
        count: selectedNodes.length,
        ids: selectedNodes.map((n) => n.id),
        elements: selectedNodes.map((n) => ({
          id: n.id, type: elementSemanticType(n, nodes), name: n.name ?? null, text: clip(n.textContent) ?? null,
        })),
      },
    sections,
    nodeCount: nodes.size,
    tree,
    truncated: budget.left <= 0,
    pendingChangesets: pendingChangeSets().map(serializeChangeSet),
    pendingPublish: pendingPublish
      ? { revision: pendingPublish.revision, requestedAt: pendingPublish.requestedAt, status: 'awaiting_human_approval' }
      : null,
    readiness: validation
      ? { score: validation.score, valid: validation.valid, issueCount: validation.issues.length, staleAsOfRevision: currentRevision() }
      : { score: null, note: 'Run weave_validate_site to compute the agent-readiness score.' },
    capabilities: applicableTools().map((t) => t.name),
  };
}

// ─── Change subscription ────────────────────────────────────────────────────

let subscribed = false;

/** Keep the agent-visible context version in step with human and agent edits.
 *  Idempotent. */
export function subscribeWeaveContext(): void {
  if (subscribed) return;
  subscribed = true;
  subscribeRevision();

  const bump = () => {
    store.set(weaveContextVersionAtom, (v) => v + 1);
    trace.action('weave:context-version-bump', {});
  };

  // Selection is context but not a project change, so it bumps the context
  // version without moving the revision (a proposal must NOT go stale merely
  // because the human clicked something).
  let selectionTimer: ReturnType<typeof setTimeout> | null = null;
  store.sub(selectedIdsAtom, () => {
    if (selectionTimer) return;
    selectionTimer = setTimeout(() => { selectionTimer = null; bump(); }, 150);
  });
  store.sub(activeFilePathAtom, bump);
  // Every settled project change (human or agent) is a new revision.
  onRevision(() => bump());
}
