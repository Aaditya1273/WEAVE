// WEAVE addition (not upstream Revyme) — see src/weave/README.md.
//
// commands.ts — THE UNIFIED ACTION PIPELINE.
//
// Every authoring action in WEAVE — a WebMCP tool call from an external agent,
// a run from the developer Test Console, or an operation inside an applied
// ChangeSet — is expressed as a `WeaveOperation` and executed here. There is
// no second implementation anywhere: the tools are thin schema wrappers over
// this module, and this module drives the editor's own page-agent executors,
// which wrap `queueMutation` + `flushNow` — the exact path the human panels
// use. So a human drag and an agent move produce the same mutation, the same
// generated source, the same history entry and the same canvas render.
//
//   human panels ──► queueMutation ──► generators ──► ProjectFS ──► canvas
//                          ▲
//   WebMCP tool ──┐        │
//   ChangeSet   ──┼──► WeaveOperation ──► executeTool ──┘
//   Test console ─┘        (this file)
//
// Operations are pure data: they can be validated, previewed, described to a
// human, amended, skipped and replayed without being executed.

import { getDefaultStore } from 'jotai';
import { nodesAtom, selectedIdsAtom } from '@/code/stores/store';
import { executeTool } from '@/ai/page-agent/tool-executors';
import { flushNow, syncQueueCode, getCurrentCode } from '@/code/mutation/mutation-queue';
import { projectFS, projectVersionAtom } from '@/code/project/project-fs';
import { activeFilePathAtom } from '@/code/project/active-file-store';
import { dragStateOps } from '@/canvas/drag/drag-state-store';
import { insertSectionBlueprint } from '@/canvas/section-insert';
import { forceRenderAfterExternalEdit } from '@/canvas/node-ops';
import { getSectionBlueprint } from '@/shared/sections-library';
import type { CanvasNode } from '@/code/parsing/parser';
import type { PresetToken } from '@/shared/types';
import { queueMutation } from '@/code/mutation/mutation-queue';
import { copyNodes, getClipboardData } from '@/code/features/paste-engine/copy';
import { insertNodes } from '@/canvas/insertion-bridge';
import { generateNodeId } from '@/shared/id-utils';
import {
  INTERACTION_TRIGGERS, type InteractionTrigger,
} from '@/code/features/page-interactions';
import { getPageVariables, type PageVariableType } from '@/code/features/page-variables';
import { getI18nConfig } from '@/code/project/locale-ops';
import { commitTranslationText } from '@/code/project/translation-ops';
import {
  listCollections, getCollectionSchema, getCollectionData,
  addCollectionItem, updateCollectionItem, removeCollectionItem,
} from '@/code/project/cms-ops';
import { trace } from '@/shared/debug-trace';

const store = getDefaultStore();

// ─── Operation model ────────────────────────────────────────────────────────

/** Semantic authoring operations. Product-level intent, not DOM surgery. */
export type WeaveOperation =
  | { op: 'update_text'; target: string; value: string }
  | { op: 'update_style'; target: string; styles: Record<string, string> }
  | { op: 'update_attrs'; target: string; attrs: Record<string, string> }
  | { op: 'rename'; target: string; name: string }
  | { op: 'set_visible'; target: string; visible: boolean }
  | { op: 'move'; target: string; parent?: string; index?: number }
  | { op: 'add_section'; sectionType: string; afterElementId?: string }
  | { op: 'delete'; target: string }
  // ── Tier 1: structure ──
  | { op: 'duplicate'; target: string }
  | { op: 'wrap'; targets: string[]; name?: string }
  | { op: 'unwrap'; target: string }
  | { op: 'change_tag'; target: string; tag: string }
  | { op: 'set_link'; target: string; href: string }
  // ── Tier 2: design system, behaviour, motion, i18n, content ──
  | { op: 'set_token'; name: string; value: string; category?: PresetToken['category']; label?: string }
  | { op: 'set_variable'; name: string; varType?: PageVariableType; value: string }
  | { op: 'bind_style_variable'; target: string; property: string; varName: string }
  | { op: 'add_interaction'; target: string; trigger: InteractionTrigger; varName: string; value: string }
  | { op: 'remove_interaction'; target: string; trigger: InteractionTrigger; varName: string }
  | { op: 'animate'; target: string; kind: 'appear' | 'hover' | 'loop'; props?: Record<string, string>; transition?: Record<string, string> }
  | { op: 'remove_animation'; target: string; kind: 'appear' | 'hover' | 'loop' }
  | { op: 'set_translation'; target: string; locale: string; text: string }
  | { op: 'set_metadata'; title?: string; description?: string }
  | { op: 'cms_upsert'; collection: string; itemId?: string; values: Record<string, unknown> }
  | { op: 'cms_remove'; collection: string; itemId: string };

export type WeaveOperationKind = WeaveOperation['op'];

export const OPERATION_KINDS: WeaveOperationKind[] = [
  'update_text', 'update_style', 'update_attrs', 'rename',
  'set_visible', 'move', 'add_section', 'delete',
  'duplicate', 'wrap', 'unwrap', 'change_tag', 'set_link',
  'set_token', 'set_variable', 'bind_style_variable',
  'add_interaction', 'remove_interaction', 'animate', 'remove_animation',
  'set_translation', 'set_metadata', 'cms_upsert', 'cms_remove',
];

/** Operations that take a single element id in `target`. */
const TARGETED_KINDS = new Set<WeaveOperationKind>([
  'update_text', 'update_style', 'update_attrs', 'rename', 'set_visible', 'move', 'delete',
  'duplicate', 'unwrap', 'change_tag', 'set_link', 'bind_style_variable',
  'add_interaction', 'remove_interaction', 'animate', 'remove_animation', 'set_translation',
]);

/** Operations that destroy content. Surfaced in proposals and tool hints. */
export const DESTRUCTIVE_KINDS = new Set<WeaveOperationKind>([
  'delete', 'unwrap', 'cms_remove', 'remove_interaction', 'remove_animation',
]);

export interface CommandError { code: string; message: string }
export type CommandResult =
  | { ok: true; detail: Record<string, unknown> }
  | { ok: false; error: CommandError };

const fail = (code: string, message: string): CommandResult => ({ ok: false, error: { code, message } });

// ─── Safety allow-lists ─────────────────────────────────────────────────────
// Enforced HERE, at the pipeline, so no caller (tool, changeset, console) can
// route around them. Visual and layout properties only: nothing that loads or
// executes code, and no positioning that could hide content off-canvas.

export const ALLOWED_STYLE_KEYS = new Set([
  'color', 'backgroundColor', 'background', 'backgroundImage', 'backgroundSize', 'backgroundPosition',
  'fontSize', 'fontWeight', 'fontFamily', 'lineHeight', 'letterSpacing', 'textAlign', 'textTransform',
  'display', 'flexDirection', 'alignItems', 'justifyContent', 'gap', 'flexWrap',
  'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'border', 'borderRadius', 'borderColor', 'borderWidth', 'boxShadow',
  'opacity', 'overflow', 'objectFit', 'aspectRatio', 'gridTemplateColumns',
]);

/** `url(...)` values are allowed to reference http(s) images only — never a
 *  `javascript:` or `data:text/html` payload smuggled through a style. */
const SAFE_URL = /^(https?:)?\/\//i;
function styleValueIsSafe(key: string, value: string): boolean {
  if (typeof value !== 'string') return false;
  if (/expression\s*\(|javascript:/i.test(value)) return false;
  const urls = value.match(/url\(\s*['"]?([^'")]+)/gi);
  if (urls && key !== 'backgroundImage' && key !== 'background') return false;
  if (urls) {
    for (const raw of urls) {
      const url = raw.replace(/^url\(\s*['"]?/i, '');
      if (!SAFE_URL.test(url)) return false;
    }
  }
  return true;
}

/** Tags that are genuinely navigable in this editor's dialect. */
export const LINK_TAGS = new Set(['a', 'Link', 'MotionLink']);

/** Tags an agent may retag an element to. Semantic containers and text only:
 *  nothing that loads a subresource (`iframe`, `script`, `object`), takes user
 *  input, or changes the element's security posture. */
export const ALLOWED_TAGS = new Set([
  'div', 'section', 'article', 'aside', 'header', 'footer', 'main', 'nav',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'blockquote', 'figure', 'figcaption',
  'ul', 'ol', 'li',
]);

/** motion props an agent may animate. A subset of upstream's motion schema:
 *  transform and paint only, so an animation can never reposition content out
 *  of the document flow or load a resource. */
export const ALLOWED_MOTION_PROPS = new Set([
  'opacity', 'scale', 'scaleX', 'scaleY', 'rotate', 'rotateX', 'rotateY',
  'x', 'y', 'xPercent', 'yPercent',
  'backgroundColor', 'color', 'borderColor', 'borderRadius', 'boxShadow', 'filter',
]);

export const ANIMATION_KINDS = ['appear', 'hover', 'loop'] as const;

export const PAGE_VARIABLE_TYPES: PageVariableType[] = ['number', 'text', 'boolean', 'color', 'image'];

/** Page variables declared on the ACTIVE page, by name. */
function pageVariableNames(): string[] {
  const code = projectFS.readFile(store.get(activeFilePathAtom));
  return code ? getPageVariables(code).map((v) => v.name) : [];
}

export const ALLOWED_ATTRS: Record<string, (v: string) => boolean> = {
  // Destinations must be a real page route or an absolute http(s) URL — never
  // a javascript:/data: URI, which is the classic injection route for an
  // agent-supplied string.
  href: (v) => /^(\/|#|https?:\/\/|mailto:|tel:)/i.test(v),
  src: (v) => /^(\/|https?:\/\/)/i.test(v),
  alt: () => true,
  title: () => true,
  target: (v) => v === '_blank' || v === '_self',
  rel: () => true,
  'aria-label': () => true,
};

// ─── Section vocabulary ─────────────────────────────────────────────────────
// section_type → oracle-validated blueprint. Humans insert the same set from
// the Insert panel, so both actors share one section vocabulary.

export const SECTION_TYPE_TO_BLUEPRINT: Record<string, string> = {
  header: 'header-editorial',
  hero: 'hero-editorial',
  features: 'features-grid',
  products: 'product-grid',
  testimonials: 'testimonials-cards',
  pricing: 'pricing-tiers',
  faq: 'faq-list',
  cta: 'cta-banner',
  contact: 'contact-panel',
  footer: 'footer-columns',
};
export const SECTION_TYPES = Object.keys(SECTION_TYPE_TO_BLUEPRINT);

// ─── Helpers ────────────────────────────────────────────────────────────────

export function getNode(id: unknown): CanvasNode | null {
  if (typeof id !== 'string' || !id) return null;
  return store.get(nodesAtom).get(id) ?? null;
}

/**
 * Bring the mutation queue's code reference up to the ACTIVE FILE before a
 * programmatic mutation. Between human gestures the queue's `currentCode` can
 * lag ProjectFS; an agent call would then apply its mutation to a stale base
 * and replace the page. Same rule `modifyProjectFile` uses: during a live drag
 * the queue is authoritative, otherwise flush and reseed from ProjectFS.
 */
export function syncQueueToActiveFile(): void {
  if (dragStateOps.get()) return;
  flushNow();
  const fresh = projectFS.readFile(store.get(activeFilePathAtom));
  if (fresh && fresh !== getCurrentCode()) syncQueueCode(fresh);
}

function viaExecutor(name: string, args: Record<string, unknown>): CommandResult {
  const { response, isError } = executeTool(name, args);
  if (isError) {
    const message = String(response.error ?? 'Mutation failed');
    const code = /No node with data-id/i.test(message) ? 'ELEMENT_NOT_FOUND' : 'MUTATION_FAILED';
    return fail(code, message);
  }
  return { ok: true, detail: response };
}

// ─── Validation ─────────────────────────────────────────────────────────────

/** Static + live validation of one operation. Returns null when it is
 *  applicable to the CURRENT project state. */
export function validateOperation(operation: WeaveOperation): CommandError | null {
  const op = operation as WeaveOperation & { target?: string };
  if (!operation || typeof operation !== 'object' || !('op' in operation)) {
    return { code: 'INVALID_OPERATION', message: 'Operation must be an object with an "op" field.' };
  }
  if (!OPERATION_KINDS.includes(operation.op)) {
    return { code: 'UNSUPPORTED_OPERATION', message: `Unsupported operation "${String(operation.op)}". Supported: ${OPERATION_KINDS.join(', ')}.` };
  }
  if (TARGETED_KINDS.has(operation.op)) {
    if (typeof op.target !== 'string' || !op.target) {
      return { code: 'INVALID_OPERATION', message: `Operation "${operation.op}" requires a target element id.` };
    }
    if (!getNode(op.target)) {
      return { code: 'ELEMENT_NOT_FOUND', message: `Element "${op.target}" no longer exists on the current page.` };
    }
  }

  switch (operation.op) {
    case 'update_text':
      if (typeof operation.value !== 'string') {
        return { code: 'INVALID_OPERATION', message: 'update_text requires a string "value".' };
      }
      return null;
    case 'update_style': {
      const entries = Object.entries(operation.styles ?? {});
      if (entries.length === 0) return { code: 'INVALID_OPERATION', message: 'update_style requires at least one style property.' };
      for (const [k, v] of entries) {
        if (!ALLOWED_STYLE_KEYS.has(k)) return { code: 'UNSUPPORTED_STYLE', message: `Style property "${k}" is not editable through WEAVE tools.` };
        if (typeof v !== 'string' || !styleValueIsSafe(k, v)) return { code: 'UNSUPPORTED_STYLE', message: `Value for "${k}" is not an accepted CSS value.` };
      }
      return null;
    }
    case 'update_attrs': {
      const entries = Object.entries(operation.attrs ?? {});
      if (entries.length === 0) return { code: 'INVALID_OPERATION', message: 'update_attrs requires at least one attribute.' };
      const node = getNode(operation.target)!;
      for (const [k, v] of entries) {
        const check = ALLOWED_ATTRS[k];
        if (!check) return { code: 'UNSUPPORTED_ATTR', message: `Attribute "${k}" is not editable through WEAVE tools.` };
        if (typeof v !== 'string' || !check(v)) return { code: 'UNSUPPORTED_ATTR', message: `Value for "${k}" is not accepted (destinations must be a page route or an http(s) URL).` };
        if (k === 'href' && !LINK_TAGS.has(node.type)) {
          return {
            code: 'NOT_A_LINK',
            message: `"${node.name ?? operation.target}" is a <${node.type}>, not a link, so it cannot take an href. ` +
              'In this builder a navigating element must be a Next.js Link: a human turns an element into one ' +
              'with the Link tool, and an agent can then set its destination.',
          };
        }
      }
      return null;
    }
    case 'rename':
      if (typeof operation.name !== 'string' || !operation.name.trim()) {
        return { code: 'INVALID_OPERATION', message: 'rename requires a non-empty "name".' };
      }
      return null;
    case 'set_visible':
      if (typeof operation.visible !== 'boolean') {
        return { code: 'INVALID_OPERATION', message: 'set_visible requires a boolean "visible".' };
      }
      return null;
    case 'move': {
      const node = getNode(operation.target)!;
      const nodes = store.get(nodesAtom);
      if (operation.parent !== undefined) {
        if (!getNode(operation.parent)) return { code: 'ELEMENT_NOT_FOUND', message: `Element "${operation.parent}" no longer exists on the current page.` };
        if (operation.parent === operation.target) return { code: 'INVALID_MOVE', message: 'An element cannot become its own parent.' };
        let cursor: string | null | undefined = nodes.get(operation.parent)!.parentId;
        while (cursor) {
          if (cursor === operation.target) return { code: 'INVALID_MOVE', message: 'Cannot move an element into its own descendant.' };
          cursor = nodes.get(cursor)?.parentId;
        }
      } else if (typeof operation.index !== 'number') {
        return { code: 'INVALID_OPERATION', message: 'move requires "parent" and/or "index".' };
      } else if (!node.parentId || !nodes.has(node.parentId)) {
        return { code: 'INVALID_MOVE', message: 'This element has no parent to reorder within.' };
      }
      if (operation.index !== undefined && (typeof operation.index !== 'number' || !Number.isFinite(operation.index) || operation.index < 0)) {
        return { code: 'INVALID_OPERATION', message: '"index" must be a non-negative number.' };
      }
      return null;
    }
    case 'add_section': {
      const blueprint = SECTION_TYPE_TO_BLUEPRINT[operation.sectionType];
      if (!blueprint || !getSectionBlueprint(blueprint)) {
        return { code: 'UNSUPPORTED_SECTION', message: `No section blueprint for type "${String(operation.sectionType)}". Supported: ${SECTION_TYPES.join(', ')}.` };
      }
      if (operation.afterElementId !== undefined && !getNode(operation.afterElementId)) {
        return { code: 'ELEMENT_NOT_FOUND', message: `Element "${operation.afterElementId}" no longer exists on the current page.` };
      }
      return null;
    }
    case 'delete':
      return null;

    // ── Tier 1 ──
    case 'duplicate':
      if (!getNode(operation.target)!.parentId) {
        return { code: 'INVALID_OPERATION', message: 'The page root cannot be duplicated.' };
      }
      return null;
    case 'wrap': {
      if (!Array.isArray(operation.targets) || operation.targets.length === 0) {
        return { code: 'INVALID_OPERATION', message: 'wrap requires a non-empty "targets" array.' };
      }
      const nodes = store.get(nodesAtom);
      let parent: string | null | undefined;
      for (const id of operation.targets) {
        const node = getNode(id);
        if (!node) return { code: 'ELEMENT_NOT_FOUND', message: `Element "${id}" no longer exists on the current page.` };
        if (!node.parentId) return { code: 'INVALID_OPERATION', message: 'The page root cannot be wrapped.' };
        if (parent === undefined) parent = node.parentId;
        else if (parent !== node.parentId) {
          return { code: 'INVALID_OPERATION', message: 'Every element in a wrap must share the same parent.' };
        }
      }
      if (!parent || !nodes.has(parent)) {
        return { code: 'INVALID_OPERATION', message: 'The elements have no common parent to wrap inside.' };
      }
      return null;
    }
    case 'unwrap': {
      const node = getNode(operation.target)!;
      if (!node.parentId) return { code: 'INVALID_OPERATION', message: 'The page root cannot be unwrapped.' };
      if ((node.children ?? []).length === 0) {
        return { code: 'INVALID_OPERATION', message: `"${node.name ?? operation.target}" has no children to unwrap.` };
      }
      return null;
    }
    case 'change_tag': {
      if (!ALLOWED_TAGS.has(operation.tag)) {
        return { code: 'UNSUPPORTED_TAG', message: `Tag "${String(operation.tag)}" is not available through WEAVE tools. Supported: ${[...ALLOWED_TAGS].join(', ')}.` };
      }
      if (!getNode(operation.target)!.parentId) {
        return { code: 'INVALID_OPERATION', message: 'The page root\u2019s tag cannot be changed.' };
      }
      return null;
    }
    case 'set_link':
      if (typeof operation.href !== 'string' || !ALLOWED_ATTRS.href(operation.href)) {
        return { code: 'UNSUPPORTED_ATTR', message: 'A destination must be a page route (/about), an anchor (#pricing), or an http(s), mailto: or tel: URL.' };
      }
      return null;

    // ── Tier 2 ──
    case 'set_token': {
      if (typeof operation.name !== 'string' || !/^[a-z][a-z0-9-]*$/i.test(operation.name)) {
        return { code: 'INVALID_OPERATION', message: 'A token name must be a plain identifier such as "brand-primary" (no -- prefix).' };
      }
      if (typeof operation.value !== 'string' || !operation.value.trim() || !styleValueIsSafe('color', operation.value)) {
        return { code: 'INVALID_OPERATION', message: 'A token needs a plain CSS value such as "#6366f1" or "48px".' };
      }
      return null;
    }
    case 'set_variable': {
      if (typeof operation.name !== 'string' || !/^[a-z][a-zA-Z0-9]*$/.test(operation.name)) {
        return { code: 'INVALID_OPERATION', message: 'A variable name must be camelCase, e.g. "heroFade".' };
      }
      if (typeof operation.value !== 'string') {
        return { code: 'INVALID_OPERATION', message: 'set_variable requires a string "value".' };
      }
      if (operation.varType !== undefined && !PAGE_VARIABLE_TYPES.includes(operation.varType)) {
        return { code: 'INVALID_OPERATION', message: `Unsupported variable type. Supported: ${PAGE_VARIABLE_TYPES.join(', ')}.` };
      }
      return null;
    }
    case 'bind_style_variable': {
      if (!ALLOWED_STYLE_KEYS.has(operation.property)) {
        return { code: 'UNSUPPORTED_STYLE', message: `Style property "${String(operation.property)}" is not editable through WEAVE tools.` };
      }
      if (!pageVariableNames().includes(operation.varName)) {
        return { code: 'VARIABLE_NOT_FOUND', message: `No page variable named "${String(operation.varName)}". Create it with set_variable first.` };
      }
      return null;
    }
    case 'add_interaction': {
      if (!INTERACTION_TRIGGERS.includes(operation.trigger)) {
        return { code: 'INVALID_OPERATION', message: `Unsupported trigger. Supported: ${INTERACTION_TRIGGERS.join(', ')}.` };
      }
      if (!pageVariableNames().includes(operation.varName)) {
        return { code: 'VARIABLE_NOT_FOUND', message: `No page variable named "${String(operation.varName)}". Create it with set_variable first.` };
      }
      if (typeof operation.value !== 'string') {
        return { code: 'INVALID_OPERATION', message: 'add_interaction requires a string "value".' };
      }
      return null;
    }
    case 'remove_interaction':
      if (!INTERACTION_TRIGGERS.includes(operation.trigger)) {
        return { code: 'INVALID_OPERATION', message: `Unsupported trigger. Supported: ${INTERACTION_TRIGGERS.join(', ')}.` };
      }
      return null;
    case 'animate': {
      if (!ANIMATION_KINDS.includes(operation.kind)) {
        return { code: 'INVALID_OPERATION', message: `Unsupported animation. Supported: ${ANIMATION_KINDS.join(', ')}.` };
      }
      const props = Object.entries(operation.props ?? {});
      if (props.length === 0) {
        return { code: 'INVALID_OPERATION', message: 'animate requires at least one motion property, e.g. { "opacity": "1" }.' };
      }
      for (const [k, v] of props) {
        if (!ALLOWED_MOTION_PROPS.has(k)) {
          return { code: 'UNSUPPORTED_MOTION', message: `Motion property "${k}" is not available. Supported: ${[...ALLOWED_MOTION_PROPS].join(', ')}.` };
        }
        if (typeof v !== 'string' || !styleValueIsSafe(k, v)) {
          return { code: 'UNSUPPORTED_MOTION', message: `Value for "${k}" is not an accepted motion value.` };
        }
      }
      return null;
    }
    case 'remove_animation':
      if (!ANIMATION_KINDS.includes(operation.kind)) {
        return { code: 'INVALID_OPERATION', message: `Unsupported animation. Supported: ${ANIMATION_KINDS.join(', ')}.` };
      }
      return null;
    case 'set_translation': {
      if (typeof operation.text !== 'string') {
        return { code: 'INVALID_OPERATION', message: 'set_translation requires a string "text".' };
      }
      const codes = getI18nConfig().locales.map((l) => l.code);
      if (!codes.includes(operation.locale)) {
        return { code: 'LOCALE_NOT_FOUND', message: `This project has no "${String(operation.locale)}" locale. Available: ${codes.join(', ')}.` };
      }
      return null;
    }
    case 'set_metadata':
      if (typeof operation.title !== 'string' && typeof operation.description !== 'string') {
        return { code: 'INVALID_OPERATION', message: 'set_metadata requires a title and/or a description.' };
      }
      return null;
    case 'cms_upsert': {
      if (!listCollections().includes(operation.collection)) {
        return { code: 'COLLECTION_NOT_FOUND', message: `No CMS collection "${String(operation.collection)}". Available: ${listCollections().join(', ') || 'none'}.` };
      }
      if (!operation.values || typeof operation.values !== 'object' || Array.isArray(operation.values)) {
        return { code: 'INVALID_OPERATION', message: 'cms_upsert requires a "values" object of field ids to values.' };
      }
      const schema = getCollectionSchema(operation.collection);
      const known = new Set((schema?.fields ?? []).map((f) => f.id));
      for (const key of Object.keys(operation.values)) {
        if (!known.has(key)) {
          return { code: 'UNKNOWN_FIELD', message: `Collection "${operation.collection}" has no field "${key}". Fields: ${[...known].join(', ') || 'none'}.` };
        }
      }
      if (operation.itemId !== undefined && !getCollectionData(operation.collection).some((i) => i._id === operation.itemId)) {
        return { code: 'ITEM_NOT_FOUND', message: `No item "${String(operation.itemId)}" in "${operation.collection}".` };
      }
      return null;
    }
    case 'cms_remove': {
      if (!listCollections().includes(operation.collection)) {
        return { code: 'COLLECTION_NOT_FOUND', message: `No CMS collection "${String(operation.collection)}". Available: ${listCollections().join(', ') || 'none'}.` };
      }
      if (!getCollectionData(operation.collection).some((i) => i._id === operation.itemId)) {
        return { code: 'ITEM_NOT_FOUND', message: `No item "${String(operation.itemId)}" in "${operation.collection}".` };
      }
      return null;
    }
  }
}

// ─── Description + before-state capture ─────────────────────────────────────

function label(id: string): string {
  const node = getNode(id);
  return node?.name || node?.type || id;
}

/** One-line human summary of an operation — what the proposal UI shows. */
export function describeOperation(operation: WeaveOperation): string {
  switch (operation.op) {
    case 'update_text': return `Set text of ${label(operation.target)}`;
    case 'update_style': return `Restyle ${label(operation.target)} (${Object.keys(operation.styles).join(', ')})`;
    case 'update_attrs': return `Set ${Object.keys(operation.attrs).join(', ')} on ${label(operation.target)}`;
    case 'rename': return `Rename ${label(operation.target)} to “${operation.name}”`;
    case 'set_visible': return `${operation.visible ? 'Show' : 'Hide'} ${label(operation.target)}`;
    case 'move': return operation.parent
      ? `Move ${label(operation.target)} into ${label(operation.parent)}`
      : `Reorder ${label(operation.target)} to position ${(operation.index ?? 0) + 1}`;
    case 'add_section': return `Add a ${operation.sectionType} section`;
    case 'delete': return `Delete ${label(operation.target)}`;
    case 'duplicate': return `Duplicate ${label(operation.target)}`;
    case 'wrap': return `Group ${operation.targets.length} element${operation.targets.length === 1 ? '' : 's'}${operation.name ? ` as “${operation.name}”` : ''}`;
    case 'unwrap': return `Ungroup ${label(operation.target)}`;
    case 'change_tag': return `Change ${label(operation.target)} to <${operation.tag}>`;
    case 'set_link': return `Link ${label(operation.target)} to ${operation.href}`;
    case 'set_token': return `Set design token “${operation.name}” to ${operation.value}`;
    case 'set_variable': return `Set page variable “${operation.name}” to ${operation.value}`;
    case 'bind_style_variable': return `Bind ${operation.property} of ${label(operation.target)} to “${operation.varName}”`;
    case 'add_interaction': return `On ${operation.trigger}, set “${operation.varName}” to ${operation.value} (${label(operation.target)})`;
    case 'remove_interaction': return `Remove the ${operation.trigger} interaction on ${label(operation.target)}`;
    case 'animate': return `Add a ${operation.kind} animation to ${label(operation.target)}`;
    case 'remove_animation': return `Remove the ${operation.kind} animation from ${label(operation.target)}`;
    case 'set_translation': return `Set the ${operation.locale} text of ${label(operation.target)}`;
    case 'set_metadata': return `Set the page ${[operation.title !== undefined ? 'title' : null, operation.description !== undefined ? 'description' : null].filter(Boolean).join(' and ')}`;
    case 'cms_upsert': return operation.itemId
      ? `Update an item in the “${operation.collection}” collection`
      : `Add an item to the “${operation.collection}” collection`;
    case 'cms_remove': return `Remove an item from the “${operation.collection}” collection`;
  }
}

/** The current value an operation would replace — shown as "before" in a
 *  proposal so the human sees the change, not just the intent. */
export function captureBefore(operation: WeaveOperation): unknown {
  switch (operation.op) {
    case 'set_token': {
      const css = projectFS.readFile('app/globals.css') ?? '';
      return new RegExp(`--${operation.name}\\s*:\\s*([^;]+);`).exec(css)?.[1]?.trim() ?? '';
    }
    case 'set_variable': {
      const code = projectFS.readFile(store.get(activeFilePathAtom));
      return (code ? getPageVariables(code) : []).find((v) => v.name === operation.name)?.default ?? '';
    }
    case 'cms_upsert':
      return operation.itemId
        ? getCollectionData(operation.collection).find((i) => i._id === operation.itemId) ?? null
        : null;
    case 'cms_remove':
      return getCollectionData(operation.collection).find((i) => i._id === operation.itemId) ?? null;
    default: break;
  }
  const node = TARGETED_KINDS.has(operation.op) ? getNode((operation as { target: string }).target) : null;
  if (!node) return null;
  switch (operation.op) {
    case 'update_text': return node.textContent ?? '';
    case 'update_style': {
      const out: Record<string, string> = {};
      for (const k of Object.keys(operation.styles)) out[k] = node.styles?.[k] ?? '';
      return out;
    }
    case 'update_attrs': {
      const out: Record<string, string> = {};
      for (const k of Object.keys(operation.attrs)) out[k] = node.attrs?.[k] ?? '';
      return out;
    }
    case 'rename': return node.name ?? '';
    case 'set_visible': return node.styles?.display !== 'none';
    case 'move': {
      const nodes = store.get(nodesAtom);
      const parent = node.parentId && nodes.has(node.parentId) ? nodes.get(node.parentId)! : null;
      return { parent: parent?.id ?? null, index: parent ? parent.children.indexOf(node.id) : null };
    }
    case 'delete': return { id: node.id, tag: node.type, name: node.name ?? null, text: node.textContent ?? null };
    case 'change_tag': return node.type;
    case 'set_link': return node.attrs?.href ?? '';
    case 'unwrap': return { children: (node.children ?? []).length };
    case 'bind_style_variable': return node.styles?.[(operation as { property: string }).property] ?? '';
    case 'set_translation': return node.textContent ?? '';
    default: return null;
  }
}

/** The value an operation writes — the editable half of an amendable op. */
export function operationValue(operation: WeaveOperation): unknown {
  switch (operation.op) {
    case 'update_text': return operation.value;
    case 'rename': return operation.name;
    case 'update_style': return operation.styles;
    case 'update_attrs': return operation.attrs;
    case 'set_visible': return operation.visible;
    case 'move': return { parent: operation.parent ?? null, index: operation.index ?? null };
    case 'add_section': return { sectionType: operation.sectionType, afterElementId: operation.afterElementId ?? null };
    case 'delete': return null;
    case 'duplicate': return null;
    case 'wrap': return { targets: operation.targets, name: operation.name ?? null };
    case 'unwrap': return null;
    case 'change_tag': return operation.tag;
    case 'set_link': return operation.href;
    case 'set_token': return operation.value;
    case 'set_variable': return operation.value;
    case 'bind_style_variable': return { property: operation.property, varName: operation.varName };
    case 'add_interaction': return { trigger: operation.trigger, varName: operation.varName, value: operation.value };
    case 'remove_interaction': return { trigger: operation.trigger, varName: operation.varName };
    case 'animate': return { kind: operation.kind, props: operation.props ?? {}, transition: operation.transition ?? {} };
    case 'remove_animation': return operation.kind;
    case 'set_translation': return operation.text;
    case 'set_metadata': return { title: operation.title ?? null, description: operation.description ?? null };
    case 'cms_upsert': return operation.values;
    case 'cms_remove': return null;
  }
}

/** Operations whose value a human can retype in the proposal UI. */
export function isTextEditable(operation: WeaveOperation): boolean {
  return operation.op === 'update_text' || operation.op === 'rename'
    || operation.op === 'set_translation' || operation.op === 'set_link'
    || operation.op === 'set_token' || operation.op === 'set_variable';
}

/** Apply a human amendment to a text-editable operation. */
export function amendOperationValue(operation: WeaveOperation, value: string): WeaveOperation {
  if (operation.op === 'update_text') return { ...operation, value };
  if (operation.op === 'rename') return { ...operation, name: value };
  if (operation.op === 'set_translation') return { ...operation, text: value };
  if (operation.op === 'set_link') return { ...operation, href: value };
  if (operation.op === 'set_token') return { ...operation, value };
  if (operation.op === 'set_variable') return { ...operation, value };
  return operation;
}

// ─── Execution ──────────────────────────────────────────────────────────────

/**
 * Execute ONE validated operation against the live project. Returns a
 * structured result; never throws. Callers that need atomicity across several
 * operations use `applyOperations`.
 */
/**
 * Repaint the canvas after an agent write.
 *
 * A HUMAN style edit patches the canvas DOM imperatively (node-ops) *and*
 * queues the mutation, so the flush gate correctly skips a second render. An
 * agent only queues — nothing patched the DOM — yet the gate still classes
 * `updateStyles` as already-painted and skips. The code was updated and the
 * canvas kept the old paint, so a restyle looked like it did nothing until the
 * next page switch. This is the same escape hatch the panels use when they
 * write outside the imperative path; it is idempotent and safe to over-call.
 */
function repaintAfterAgentWrite(op: WeaveOperationKind): void {
  forceRenderAfterExternalEdit('weave:agent-edit', { op });
}

export function executeOperation(
  operation: WeaveOperation,
  /** Batch callers defer the repaint and do it once after the whole set. */
  opts: { deferRender?: boolean } = {},
): CommandResult {
  const invalid = validateOperation(operation);
  if (invalid) return { ok: false, error: invalid };
  syncQueueToActiveFile();
  trace.action('weave:command', { op: operation.op });
  const done = (r: CommandResult): CommandResult => {
    if (r.ok && !opts.deferRender) repaintAfterAgentWrite(operation.op);
    return r;
  };

  switch (operation.op) {
    case 'update_text':
      return done(viaExecutor('update_node_text', { nodeId: operation.target, text: operation.value }));
    case 'update_style':
      return done(viaExecutor('update_node_styles', { nodeId: operation.target, styles: operation.styles }));
    case 'update_attrs':
      return done(viaExecutor('update_html_attrs', { nodeId: operation.target, attrs: operation.attrs }));
    case 'rename':
      return done(viaExecutor('rename_node', { nodeId: operation.target, name: operation.name }));
    case 'set_visible':
      // Empty string DELETES the property (upstream invariant #3), so showing
      // an element removes `display:none` rather than guessing a display value.
      return done(viaExecutor('update_node_styles', { nodeId: operation.target, styles: { display: operation.visible ? '' : 'none' } }));
    case 'move': {
      if (operation.parent) {
        return done(viaExecutor('move_node', {
          nodeId: operation.target, newParentId: operation.parent,
          ...(typeof operation.index === 'number' ? { index: Math.max(0, Math.floor(operation.index)) } : {}),
        }));
      }
      const parentId = getNode(operation.target)!.parentId!;
      return done(viaExecutor('reorder_node', { nodeId: operation.target, parentId, index: Math.max(0, Math.floor(operation.index!)) }));
    }
    case 'delete': {
      const result = viaExecutor('remove_node', { nodeId: operation.target });
      if (result.ok) {
        store.set(selectedIdsAtom, store.get(selectedIdsAtom).filter((id) => id !== operation.target));
      }
      return done(result);
    }
    // ── Tier 1: structure ───────────────────────────────────────────────
    case 'duplicate': {
      // Duplicate rides the paste engine, exactly like the human's Ctrl+D:
      // `copyNodes` serialises the subtree and `insertNodes` re-mints ids and
      // routes placement through the same rules. We never touch the real
      // clipboard — that belongs to the human.
      // `copyNodes` writes the editor clipboard, so the human's own clipboard
      // is saved and restored around it — a duplicate is not a copy.
      const nodes = store.get(nodesAtom);
      const prevSelection = store.get(selectedIdsAtom);
      const savedClipboard = localStorage.getItem('canvas_clipboard');
      const copied = copyNodes([operation.target], nodes);
      const clipboard = copied.success ? getClipboardData()?.nodes ?? null : null;
      if (savedClipboard !== null) localStorage.setItem('canvas_clipboard', savedClipboard);
      else localStorage.removeItem('canvas_clipboard');
      if (!clipboard || clipboard.length === 0) return fail('DUPLICATE_FAILED', 'Could not copy that element.');
      store.set(selectedIdsAtom, [operation.target]);
      syncQueueToActiveFile();
      const created = insertNodes(clipboard);
      flushNow();
      if (created.length === 0) {
        store.set(selectedIdsAtom, prevSelection);
        return fail('DUPLICATE_FAILED', 'Could not duplicate that element.');
      }
      store.set(selectedIdsAtom, created);
      return done({ ok: true, detail: { created, source: operation.target } });
    }
    case 'wrap': {
      const nodes = store.get(nodesAtom);
      const first = nodes.get(operation.targets[0])!;
      const parentId = first.parentId!;
      const siblings = nodes.get(parentId)!.children;
      // Insert the wrapper where the FIRST selected element sits, so the
      // group keeps its position in the page rather than jumping to the end.
      const index = Math.min(...operation.targets.map((id) => siblings.indexOf(id)).filter((i) => i >= 0));
      const wrapperId = generateNodeId('frame');
      const add = viaExecutor('add_node', {
        parentId, nodeType: 'div', index,
        name: operation.name || 'Group',
        styles: {
          position: 'relative', display: 'flex', flexDirection: 'column',
          width: '100%', height: 'min-content', flex: '0 0 auto',
        },
      });
      if (!add.ok) return add;
      const created = String((add.detail as { newNodeId?: string }).newNodeId ?? wrapperId);
      // Order preserved: each element moves to the end of the wrapper in the
      // order the caller listed them.
      for (let i = 0; i < operation.targets.length; i++) {
        const moved = viaExecutor('move_node', { nodeId: operation.targets[i], newParentId: created, index: i });
        if (!moved.ok) return moved;
      }
      store.set(selectedIdsAtom, [created]);
      return done({ ok: true, detail: { created, wrapped: operation.targets } });
    }
    case 'unwrap': {
      const node = getNode(operation.target)!;
      const parentId = node.parentId!;
      const siblings = store.get(nodesAtom).get(parentId)!.children;
      const at = siblings.indexOf(operation.target);
      const children = [...(node.children ?? [])];
      // Lift children into the parent at the wrapper's own position, in order,
      // then delete the empty wrapper.
      for (let i = 0; i < children.length; i++) {
        const moved = viaExecutor('move_node', { nodeId: children[i], newParentId: parentId, index: at + i });
        if (!moved.ok) return moved;
      }
      const removed = viaExecutor('remove_node', { nodeId: operation.target });
      if (!removed.ok) return removed;
      store.set(selectedIdsAtom, children);
      return done({ ok: true, detail: { unwrapped: operation.target, lifted: children } });
    }
    case 'change_tag':
      return done(viaExecutor('change_tag', { nodeId: operation.target, newTag: operation.tag }));
    case 'set_link': {
      const node = getNode(operation.target)!;
      // This editor's dialect requires a real Next.js Link to navigate. Rather
      // than refusing (the old NOT_A_LINK dead end), convert the element first
      // — the same mutation the human's Link tool queues — then set the href.
      if (!LINK_TAGS.has(node.type)) {
        queueMutation({ type: 'convertToMotionLink', nodeId: operation.target });
        flushNow();
      }
      return done(viaExecutor('update_html_attrs', { nodeId: operation.target, attrs: { href: operation.href } }));
    }

    // ── Tier 2: design system, behaviour, motion, i18n, content ─────────
    case 'set_token': {
      const css = projectFS.readFile('app/globals.css') ?? '';
      const exists = new RegExp(`--${operation.name}\\s*:`).test(css);
      queueMutation(exists
        ? { type: 'updatePresetToken', name: operation.name, value: operation.value }
        : { type: 'addPresetToken', token: {
            name: operation.name, value: operation.value,
            category: operation.category ?? 'other',
            ...(operation.label ? { label: operation.label } : {}),
          } });
      flushNow();
      return done({ ok: true, detail: { token: operation.name, value: operation.value, created: !exists } });
    }
    case 'set_variable': {
      const existing = pageVariableNames().includes(operation.name);
      queueMutation(existing
        ? { type: 'updatePageVariable', oldName: operation.name, updates: { default: operation.value } }
        : { type: 'addPageVariable', variable: {
            name: operation.name,
            type: operation.varType ?? 'text',
            default: operation.value,
          } });
      flushNow();
      return done({ ok: true, detail: { variable: operation.name, value: operation.value, created: !existing } });
    }
    case 'bind_style_variable':
      queueMutation({
        type: 'bindStylePageVariable',
        nodeId: operation.target, styleProperty: operation.property, varName: operation.varName,
      });
      flushNow();
      return done({ ok: true, detail: { bound: operation.property, to: operation.varName } });
    case 'add_interaction':
      queueMutation({
        type: 'addPageInteraction',
        nodeId: operation.target, trigger: operation.trigger,
        varName: operation.varName, value: operation.value,
      });
      flushNow();
      return done({ ok: true, detail: { trigger: operation.trigger, varName: operation.varName, value: operation.value } });
    case 'remove_interaction':
      queueMutation({
        type: 'removePageInteraction',
        nodeId: operation.target, trigger: operation.trigger, varName: operation.varName,
      });
      flushNow();
      return done({ ok: true, detail: { removed: operation.trigger } });
    case 'animate': {
      const props = operation.props ?? {};
      const transition = operation.transition ?? {};
      if (operation.kind === 'loop') {
        // A loop animates keyframe ARRAYS; a single value is expanded to a
        // there-and-back pair so a caller can say `{ scale: '1.05' }`.
        const spec: Record<string, string> = {};
        for (const [k, v] of Object.entries(props)) spec[k] = v.trim().startsWith('[') ? v : `[1, ${v}]`;
        queueMutation({ type: 'updateLoop', nodeId: operation.target, spec: { props: spec, transition } });
      } else if (operation.kind === 'hover') {
        queueMutation({ type: 'updateMotionProp', nodeId: operation.target, propName: 'whileHover', props });
        if (Object.keys(transition).length > 0) {
          queueMutation({ type: 'updateMotionProp', nodeId: operation.target, propName: 'transition', props: transition });
        }
      } else {
        // Appear: `initial` is the hidden state, `whileInView` the visible one.
        // Callers give the visible state; the hidden state is its complement.
        const initial: Record<string, string> = {};
        for (const k of Object.keys(props)) {
          if (k === 'opacity') initial[k] = '0';
          else if (k === 'y' || k === 'x') initial[k] = '24';
          else if (k === 'scale') initial[k] = '0.96';
        }
        if (Object.keys(initial).length > 0) {
          queueMutation({ type: 'updateMotionProp', nodeId: operation.target, propName: 'initial', props: initial });
        }
        queueMutation({ type: 'updateMotionProp', nodeId: operation.target, propName: 'whileInView', props });
        if (Object.keys(transition).length > 0) {
          queueMutation({ type: 'updateMotionProp', nodeId: operation.target, propName: 'transition', props: transition });
        }
      }
      flushNow();
      return done({ ok: true, detail: { animated: operation.kind, props } });
    }
    case 'remove_animation': {
      if (operation.kind === 'loop') {
        queueMutation({ type: 'removeLoop', nodeId: operation.target });
      } else if (operation.kind === 'hover') {
        queueMutation({ type: 'removeMotionProp', nodeId: operation.target, propName: 'whileHover' });
      } else {
        queueMutation({ type: 'removeMotionProp', nodeId: operation.target, propName: 'initial' });
        queueMutation({ type: 'removeMotionProp', nodeId: operation.target, propName: 'whileInView' });
      }
      flushNow();
      return done({ ok: true, detail: { removed: operation.kind } });
    }
    case 'set_translation': {
      const config = getI18nConfig();
      const filePath = store.get(activeFilePathAtom);
      const node = getNode(operation.target)!;
      commitTranslationText({
        filePath,
        nodeId: operation.target,
        locale: operation.locale,
        defaultLocale: config.defaultLocale,
        text: operation.text,
        fallbackDefaultText: node.textContent ?? '',
      });
      syncQueueToActiveFile();
      return done({ ok: true, detail: { locale: operation.locale, target: operation.target } });
    }
    case 'set_metadata': {
      const metadata: Record<string, unknown> = {};
      if (typeof operation.title === 'string') metadata.title = operation.title;
      if (typeof operation.description === 'string') metadata.description = operation.description;
      queueMutation({ type: 'updateMetadata', metadata });
      flushNow();
      return done({ ok: true, detail: { metadata } });
    }
    case 'cms_upsert': {
      if (operation.itemId) {
        updateCollectionItem(operation.collection, operation.itemId, operation.values);
        return done({ ok: true, detail: { collection: operation.collection, itemId: operation.itemId, created: false } });
      }
      const item = addCollectionItem(operation.collection, operation.values);
      return done({ ok: true, detail: { collection: operation.collection, itemId: item._id, created: true } });
    }
    case 'cms_remove':
      removeCollectionItem(operation.collection, operation.itemId);
      return done({ ok: true, detail: { collection: operation.collection, itemId: operation.itemId } });

    case 'add_section': {
      const blueprintId = SECTION_TYPE_TO_BLUEPRINT[operation.sectionType];
      const nodes = store.get(nodesAtom);
      let anchorId: string | null = operation.afterElementId ?? null;
      if (!anchorId) {
        const kids = (nodes.get('root')?.children ?? []).filter((c) => nodes.has(c));
        anchorId = kids.length > 0 ? kids[kids.length - 1] : null;
      }
      // Placement rides the paste rules: with a top-level section selected the
      // blueprint lands as its next sibling.
      const prevSelection = store.get(selectedIdsAtom);
      store.set(selectedIdsAtom, anchorId ? [anchorId] : []);
      syncQueueToActiveFile();
      const created = insertSectionBlueprint(blueprintId);
      flushNow();
      if (created.length === 0) {
        store.set(selectedIdsAtom, prevSelection);
        return fail('INSERT_FAILED', `Could not insert a "${operation.sectionType}" section.`);
      }
      // Select what was just created — the human immediately sees WHERE the
      // agent worked.
      store.set(selectedIdsAtom, created);
      return done({ ok: true, detail: { created } });
    }
  }
}

/**
 * Execute several operations as ONE atomic unit.
 *
 * The whole ProjectFS is snapshotted first; if any operation fails the
 * snapshot is restored, so a half-applied proposal can never reach the canvas.
 * On success the caller is responsible for the history entry — see
 * `changeset.ts`, which wraps this in a single undoable step.
 */
export function applyOperations(operations: WeaveOperation[]): {
  ok: boolean;
  results: CommandResult[];
  failedIndex?: number;
  error?: CommandError;
} {
  const snapshot = projectFS.getSnapshot();
  const results: CommandResult[] = [];
  for (let i = 0; i < operations.length; i++) {
    const result = executeOperation(operations[i], { deferRender: true });
    results.push(result);
    if (!result.ok) {
      // ROLLBACK — restore every file, then re-seed the mutation queue from the
      // restored active file so the next write does not apply to the abandoned
      // intermediate state.
      projectFS.loadSnapshot(snapshot);
      const restored = projectFS.readFile(store.get(activeFilePathAtom));
      if (restored) syncQueueCode(restored);
      // Restoring FILES is not enough: `nodesAtom` memoises on the project
      // version, so without this bump the canvas and every subsequent
      // validation would still be reading the abandoned intermediate tree.
      store.set(projectVersionAtom, (v) => v + 1);
      trace.error('weave:changeset-rollback', { failedIndex: i, code: result.error.code });
      return { ok: false, results, failedIndex: i, error: result.error };
    }
  }
  // One repaint for the whole transaction rather than per operation.
  if (operations.length > 0) repaintAfterAgentWrite(operations[operations.length - 1].op);
  return { ok: true, results };
}
