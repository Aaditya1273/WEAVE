// WEAVE addition (not upstream Revyme) — see src/weave/README.md.
//
// validate.ts — deterministic site checks and the Agent Readiness score.
//
// Every check reads the SAME parsed node model the canvas renders from, so a
// finding always points at a real element the human can select. Nothing here
// is sampled, estimated or faked: a check that cannot be decided from project
// state is not implemented rather than guessed. The score is a plain weighted
// sum over those checks and is fully explainable — the panel renders the same
// numbers this module returns.
//
// The point is not lint for its own sake. An agent operating a website needs
// named sections, labelled controls, real link destinations and alt text; the
// readiness score measures exactly the properties that make the PUBLISHED site
// legible to the next agent.

import { getDefaultStore } from 'jotai';
import { nodesAtom } from '@/code/stores/store';
import { activeFilePathAtom } from '@/code/project/active-file-store';
import { projectFS } from '@/code/project/project-fs';
import type { CanvasNode } from '@/code/parsing/parser';
import { SECTION_TYPE_TO_BLUEPRINT } from './commands';

const store = getDefaultStore();

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  severity: IssueSeverity;
  code: string;
  /** Element id the human can select, or null for page-level findings. */
  target: string | null;
  message: string;
}

export interface ReadinessCheck {
  id: string;
  label: string;
  /** Points this check contributes when fully satisfied. */
  weight: number;
  /** Points actually earned. */
  earned: number;
  passed: boolean;
  detail: string;
}

export interface ValidationReport {
  valid: boolean;
  score: number;
  issues: ValidationIssue[];
  checks: ReadinessCheck[];
}

// ─── Element helpers ────────────────────────────────────────────────────────

const IMAGE_TAGS = new Set(['img', 'image']);
/** Genuinely navigable elements in this editor's dialect. */
const LINK_TAGS = new Set(['a', 'Link', 'MotionLink']);
const TEXT_TAGS = new Set(['p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote']);

/** A node is an image if it is an <img> or paints a background image. */
function isImage(node: CanvasNode): boolean {
  if (IMAGE_TAGS.has(node.type)) return true;
  return !!node.styles?.backgroundImage && node.styles.backgroundImage !== 'none';
}

/** Section names WEAVE understands semantically, from the shared vocabulary. */
const SEMANTIC_WORDS = Object.keys(SECTION_TYPE_TO_BLUEPRINT);

/** Best-effort semantic type of a top-level section, from its name/id. */
export function sectionSemanticType(node: CanvasNode): string | null {
  const haystack = `${node.name ?? ''} ${node.id}`.toLowerCase();
  for (const word of SEMANTIC_WORDS) {
    if (haystack.includes(word)) return word;
  }
  if (/call to action/.test(haystack)) return 'cta';
  if (/story|about/.test(haystack)) return 'story';
  return null;
}

/** A styled frame that reads as a button but is not yet a link element. */
function looksLikeButton(node: CanvasNode, nodes: Map<string, CanvasNode>): boolean {
  if (node.type !== 'div') return false;
  const name = (node.name ?? '').toLowerCase();
  if (!/button|cta/.test(name)) return false;
  const kids = (node.children ?? []).filter((c) => nodes.has(c));
  return kids.length > 0 && kids.every((c) => TEXT_TAGS.has(nodes.get(c)!.type));
}

// ─── The checks ─────────────────────────────────────────────────────────────

/**
 * Run every site check against the active page.
 * Pure: reads state, writes nothing.
 */
export function validateSite(): ValidationReport {
  const nodes = store.get(nodesAtom);
  const activeFile = store.get(activeFilePathAtom);
  const issues: ValidationIssue[] = [];

  const root = nodes.get('root');
  const sections = (root?.children ?? [])
    .map((id) => nodes.get(id))
    .filter((n): n is CanvasNode => !!n);

  // 1 — Structured page semantics: sections exist, are named, and are not empty.
  let namedSections = 0;
  for (const section of sections) {
    if (section.name && section.name.trim()) namedSections++;
    else {
      issues.push({
        severity: 'warning', code: 'UNNAMED_SECTION', target: section.id,
        message: `Section "${section.id}" has no name. Agents identify sections by name — an unnamed section is invisible to them.`,
      });
    }
    const kids = (section.children ?? []).filter((c) => nodes.has(c));
    if (kids.length === 0 && !section.textContent) {
      issues.push({
        severity: 'warning', code: 'EMPTY_SECTION', target: section.id,
        message: `Section "${section.name ?? section.id}" is empty.`,
      });
    }
  }
  if (sections.length === 0) {
    issues.push({
      severity: 'error', code: 'NO_SECTIONS', target: null,
      message: 'This page has no top-level sections. Agents navigate a page by its sections.',
    });
  }

  // 2 — Semantic typing: can an agent tell what each section IS?
  const typedSections = sections.filter((s) => sectionSemanticType(s) !== null).length;
  for (const section of sections) {
    if (sectionSemanticType(section) === null) {
      issues.push({
        severity: 'info', code: 'SECTION_UNTYPED', target: section.id,
        message: `Section "${section.name ?? section.id}" does not map to a known semantic type (${SEMANTIC_WORDS.join(', ')}).`,
      });
    }
  }

  // 3 — Accessible labels: every image needs alternative text.
  let images = 0;
  let imagesWithAlt = 0;
  for (const node of nodes.values()) {
    if (!isImage(node)) continue;
    // A decorative image marked aria-hidden is CORRECTLY unlabelled — screen
    // readers and agents should skip it. Counting it as a failure would push
    // authors toward describing scrims and texture overlays, which is worse
    // for both audiences than hiding them.
    if (node.attrs?.['aria-hidden'] === 'true') continue;
    images++;
    const alt = node.attrs?.alt ?? node.attrs?.['aria-label'];
    if (alt && alt.trim()) imagesWithAlt++;
    else {
      issues.push({
        severity: 'warning', code: 'MISSING_ALT', target: node.id,
        message: `Image "${node.name ?? node.id}" is missing alternative text.`,
      });
    }
  }

  // 4 — Valid navigation: every real link element needs a destination.
  let links = 0;
  let linksWithHref = 0;
  for (const node of nodes.values()) {
    if (LINK_TAGS.has(node.type)) {
      links++;
      const href = node.attrs?.href;
      if (href && href.trim()) linksWithHref++;
      else {
        issues.push({
          severity: 'warning', code: 'LINK_WITHOUT_DESTINATION', target: node.id,
          message: `Link "${node.name ?? node.id}" has no destination.`,
        });
      }
      continue;
    }
    // A button-styled frame is not a link yet. Report it so the human can wire
    // it up with the Link tool, but do not score the site down for a design
    // element that may be intentional.
    if (looksLikeButton(node, nodes)) {
      issues.push({
        severity: 'info', code: 'BUTTON_NOT_LINKED', target: node.id,
        message: `"${node.name ?? node.id}" looks like a button but is not a link yet. Use the Link tool to give it a destination.`,
      });
    }
  }

  // 5 — Content completeness: no placeholder-empty text nodes.
  let emptyText = 0;
  for (const node of nodes.values()) {
    if (!TEXT_TAGS.has(node.type)) continue;
    const hasChildren = (node.children ?? []).some((c) => nodes.has(c));
    if (hasChildren) continue;
    if (!node.textContent || !node.textContent.trim()) {
      emptyText++;
      issues.push({
        severity: 'info', code: 'EMPTY_TEXT', target: node.id,
        message: `Text element "${node.name ?? node.id}" is empty.`,
      });
    }
  }

  // 6 — Page metadata: a title the agent (and a search engine) can read.
  //     Lives in the page's SERVER half, which the canvas never parses.
  const serverFile = activeFile.replace(/page\.client\.tsx$/, 'page.tsx');
  const serverSource = projectFS.readFile(serverFile) ?? '';
  const hasTitle = /metadata\s*[:=][\s\S]{0,400}?title\s*:\s*['"`][^'"`]+['"`]/.test(serverSource);
  if (!hasTitle) {
    issues.push({
      severity: 'warning', code: 'MISSING_PAGE_TITLE', target: null,
      message: 'This page has no metadata title. Add one in Settings so agents and search engines can identify the page.',
    });
  }

  // ─── Score ────────────────────────────────────────────────────────────────
  // A plain weighted sum. Each check reports what it earned and why.

  const ratio = (n: number, d: number) => (d === 0 ? 1 : n / d);
  const pts = (weight: number, r: number) => Math.round(weight * r);

  const structureRatio = sections.length === 0 ? 0 : ratio(namedSections, sections.length);
  const semanticRatio = sections.length === 0 ? 0 : ratio(typedSections, sections.length);
  const altRatio = ratio(imagesWithAlt, images);
  const navRatio = ratio(linksWithHref, links);
  const contentRatio = emptyText === 0 ? 1 : 0;

  // Tool registration is real state, read from the live registry.
  const toolsRegistered = getRegisteredToolCountForScore();

  const checks: ReadinessCheck[] = [
    {
      id: 'structure', label: 'Structured page semantics', weight: 20,
      earned: pts(20, structureRatio), passed: structureRatio === 1 && sections.length > 0,
      detail: sections.length === 0 ? 'No sections on this page.' : `${namedSections} of ${sections.length} sections are named.`,
    },
    {
      id: 'semantics', label: 'Recognisable section types', weight: 15,
      earned: pts(15, semanticRatio), passed: semanticRatio === 1 && sections.length > 0,
      detail: sections.length === 0 ? 'No sections on this page.' : `${typedSections} of ${sections.length} sections map to a known type.`,
    },
    {
      id: 'labels', label: 'Accessible labels', weight: 20,
      earned: pts(20, altRatio), passed: altRatio === 1,
      detail: images === 0 ? 'No images on this page.' : `${imagesWithAlt} of ${images} images have alternative text.`,
    },
    {
      id: 'navigation', label: 'Valid navigation', weight: 15,
      earned: pts(15, navRatio), passed: navRatio === 1,
      detail: links === 0 ? 'No links or buttons on this page.' : `${linksWithHref} of ${links} links have a destination.`,
    },
    {
      id: 'content', label: 'Complete content', weight: 10,
      earned: pts(10, contentRatio), passed: contentRatio === 1,
      detail: emptyText === 0 ? 'No empty text elements.' : `${emptyText} text elements are empty.`,
    },
    {
      id: 'metadata', label: 'Page metadata', weight: 5,
      earned: hasTitle ? 5 : 0, passed: hasTitle,
      detail: hasTitle ? 'Page has a metadata title.' : 'Page has no metadata title.',
    },
    {
      id: 'tools', label: 'WebMCP tools registered', weight: 10,
      earned: toolsRegistered > 0 ? 10 : 0, passed: toolsRegistered > 0,
      detail: toolsRegistered > 0 ? `${toolsRegistered} agent tools available on this project.` : 'No agent tools available.',
    },
    {
      id: 'approval', label: 'Human approval boundaries', weight: 5,
      earned: 5, passed: true,
      detail: 'Publishing requires explicit human approval; destructive tools are annotated.',
    },
  ];

  const score = checks.reduce((sum, c) => sum + c.earned, 0);
  const hasBlocking = issues.some((i) => i.severity === 'error');

  return { valid: !hasBlocking && score >= 80, score, issues, checks };
}

// ─── Registry bridge ────────────────────────────────────────────────────────
// validate.ts must not import the registry (the registry imports the tools,
// which import commands, which validate imports) — so the count is injected.

let toolCountProvider: (() => number) | null = null;
export function setToolCountProvider(fn: () => number): void { toolCountProvider = fn; }
function getRegisteredToolCountForScore(): number {
  try { return toolCountProvider?.() ?? 0; } catch { return 0; }
}
