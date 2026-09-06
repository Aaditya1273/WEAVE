// WEAVE addition (not upstream Revyme) — see src/weave/README.md.
//
// manifest.ts — what makes a PUBLISHED WEAVE site agent-ready.
//
// Two artifacts ship inside every approved publish:
//
//   weave.manifest.json  — the site's capability manifest: its pages, its
//                          sections and their semantic types, and the element
//                          ids an agent can address. Generated from the same
//                          parsed model the editor tools use, so the published
//                          description and the editing session agree.
//
//   public/weave-agent.js — a small, dependency-free runtime the published
//                          site loads. It reads the manifest, feature-detects
//                          the browser's WebMCP runtime and registers
//                          site-level tools against the live DOM (the ids in
//                          the manifest are real `data-id` attributes, because
//                          WEAVE ships the user's source verbatim).
//
// That closes the loop the product is built around: an agent helps author the
// site through WEAVE's editor tools, and the site it produces exposes its own
// tools to the next agent. The runtime is a working demonstrator — read-only
// site tools, no write path — and says so in its own README rather than
// implying more.

import { getDefaultStore } from 'jotai';
import { nodesAtom } from '@/code/stores/store';
import { activeFilePathAtom } from '@/code/project/active-file-store';
import type { CanvasNode } from '@/code/parsing/parser';
import { listPages, pageFileToRoute, projectName, elementSemanticType } from './context';
import { sectionSemanticType, validateSite } from './validate';
import { getWeaveTools } from './webmcp/registry';
import { currentRevision } from './revision';

const store = getDefaultStore();

/** Elements worth naming in the manifest: the things an agent would act on. */
function addressableElements(nodes: Map<string, CanvasNode>, sectionId: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const walk = (id: string, depth: number) => {
    const node = nodes.get(id);
    if (!node || depth > 4) return;
    const type = elementSemanticType(node, nodes);
    if (type === 'heading' || type === 'text' || type === 'link' || type === 'button' || type === 'image') {
      out.push({
        id: node.id,
        type,
        name: node.name ?? null,
        text: node.textContent ? node.textContent.slice(0, 120) : null,
      });
    }
    for (const child of node.children ?? []) walk(child, depth + 1);
  };
  walk(sectionId, 0);
  return out.slice(0, 40);
}

export function buildCapabilityManifest(): Record<string, unknown> {
  const nodes = store.get(nodesAtom);
  const activeFile = store.get(activeFilePathAtom);
  const activeRoute = pageFileToRoute(activeFile);
  const report = validateSite();

  const sections = (nodes.get('root')?.children ?? [])
    .map((id) => nodes.get(id))
    .filter((n): n is CanvasNode => !!n)
    .map((n, index) => ({
      id: n.id,
      index,
      name: n.name ?? null,
      type: sectionSemanticType(n) ?? 'unknown',
      elements: addressableElements(nodes, n.id),
    }));

  return {
    format: 'weave-capability-manifest',
    version: 1,
    generatedAt: new Date().toISOString(),
    generator: 'WEAVE — the website builder built for humans and agents',
    site: { name: projectName(), revision: currentRevision() },
    readiness: { score: report.score, valid: report.valid, issues: report.issues.length },
    pages: listPages().map((p) => ({
      route: p.route,
      file: p.file,
      // Section detail is emitted for the page that was open at publish time;
      // the other routes are listed for discovery. Parsing every page here
      // would be a per-publish cost with no consumer today.
      sections: p.route === activeRoute ? sections : undefined,
    })),
    editorTools: getWeaveTools().map((t) => ({
      name: t.name,
      title: t.annotations.title,
      description: t.description,
      readOnly: t.annotations.readOnlyHint,
      destructive: t.annotations.destructiveHint,
      requiresHumanApproval: t.annotations.requiresHumanApproval ?? false,
    })),
    siteTools: [
      { name: 'weave_site_get_context', readOnly: true, description: 'Read this published site’s pages, sections and addressable elements.' },
      { name: 'weave_site_read_section', readOnly: true, description: 'Read the live text content of one section by id.' },
      { name: 'weave_site_navigate', readOnly: false, description: 'Navigate this site to one of its own routes.' },
    ],
    runtime: {
      script: '/weave-agent.js',
      status: 'demonstrator',
      note:
        'Load /weave-agent.js on the published site to register the read-only site tools ' +
        'above with a WebMCP-capable browser. The runtime feature-detects document.modelContext ' +
        'and does nothing when no runtime is present. It exposes no write path: editing a ' +
        'published site remains a WEAVE-editor operation behind human approval.',
    },
  };
}

/**
 * The runtime shipped at `public/weave-agent.js`.
 *
 * Deliberately plain ES2019, no build step and no dependencies, so it runs as
 * a `<script src>` in any exported site regardless of framework. It reads the
 * manifest, then registers three read-only tools against whatever WebMCP
 * surface the browser exposes.
 */
export const AGENT_RUNTIME_SOURCE = `/**
 * weave-agent.js — makes a published WEAVE site readable by an AI agent.
 *
 * Generated by WEAVE (https://github.com/ — see the repository README).
 * Load it once, anywhere on the page:
 *
 *     <script src="/weave-agent.js" defer></script>
 *
 * It reads /weave.manifest.json (published alongside your site), detects the
 * browser's Web Model Context runtime and registers read-only tools that
 * describe this site's structure. If the browser has no WebMCP runtime it does
 * nothing at all — no polyfill, no globals, no errors.
 */
(function () {
  'use strict';

  function modelContext() {
    if (typeof document !== 'undefined' && document.modelContext) return document.modelContext;
    if (typeof navigator !== 'undefined' && navigator.modelContext) return navigator.modelContext;
    if (typeof window !== 'undefined' && window.modelContext) return window.modelContext;
    return null;
  }

  function ok(value) {
    var text = JSON.stringify(value);
    return { content: [{ type: 'text', text: text }], structuredContent: value };
  }
  function err(code, message) {
    var value = { ok: false, error: { code: code, message: message } };
    return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value, isError: true };
  }

  /** Live text of an element, by the data-id WEAVE wrote into the source. */
  function readElement(id) {
    var el = document.querySelector('[data-id="' + String(id).replace(/"/g, '') + '"]');
    if (!el) return null;
    return {
      id: id,
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || '').trim().slice(0, 400),
      href: el.getAttribute('href'),
      alt: el.getAttribute('alt')
    };
  }

  function register(manifest) {
    var mc = modelContext();
    if (!mc || typeof mc.registerTool !== 'function') return false;

    var page = (manifest.pages || []).filter(function (p) {
      return p.route === location.pathname || (p.route === '/' && location.pathname === '');
    })[0] || (manifest.pages || [])[0] || {};

    mc.registerTool({
      name: 'weave_site_get_context',
      description: 'Read this website\\'s structure: its name, its pages, and the sections of the ' +
        'current page with their semantic types and addressable element ids.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { title: 'Read site structure', readOnlyHint: true, destructiveHint: false },
      execute: function () {
        return Promise.resolve(ok({
          ok: true,
          site: manifest.site,
          currentRoute: location.pathname,
          pages: (manifest.pages || []).map(function (p) { return p.route; }),
          sections: (page.sections || []).map(function (s) {
            return { id: s.id, type: s.type, name: s.name, elementCount: (s.elements || []).length };
          })
        }));
      }
    });

    mc.registerTool({
      name: 'weave_site_read_section',
      description: 'Read the live text content of one section of this page, by the section id ' +
        'returned from weave_site_get_context.',
      inputSchema: {
        type: 'object',
        properties: { section_id: { type: 'string', description: 'Section id to read.' } },
        required: ['section_id'],
        additionalProperties: false
      },
      annotations: { title: 'Read a section', readOnlyHint: true, destructiveHint: false },
      execute: function (args) {
        var id = args && args.section_id;
        var section = (page.sections || []).filter(function (s) { return s.id === id; })[0];
        if (!section) return Promise.resolve(err('SECTION_NOT_FOUND', 'No section "' + id + '" on this page.'));
        var elements = (section.elements || []).map(function (e) { return readElement(e.id); })
          .filter(function (e) { return e !== null; });
        return Promise.resolve(ok({ ok: true, id: section.id, type: section.type, name: section.name, elements: elements }));
      }
    });

    mc.registerTool({
      name: 'weave_site_navigate',
      description: 'Navigate this site to one of its own routes. Only routes published with this ' +
        'site are accepted; external URLs are refused.',
      inputSchema: {
        type: 'object',
        properties: { route: { type: 'string', description: 'A route from weave_site_get_context, e.g. "/about".' } },
        required: ['route'],
        additionalProperties: false
      },
      annotations: { title: 'Navigate this site', readOnlyHint: false, destructiveHint: false },
      execute: function (args) {
        var route = args && args.route;
        var routes = (manifest.pages || []).map(function (p) { return p.route; });
        if (routes.indexOf(route) === -1) {
          return Promise.resolve(err('UNKNOWN_ROUTE', 'This site has no route "' + route + '". Known routes: ' + routes.join(', ')));
        }
        location.assign(route);
        return Promise.resolve(ok({ ok: true, navigatedTo: route }));
      }
    });

    return true;
  }

  if (!modelContext()) return;

  // An inline <script id="weave-manifest" type="application/json"> wins: it
  // needs no network round trip, works from a subdirectory, and works offline
  // or from file://. The fetch is the fallback for the ordinary case where the
  // manifest sits beside the site at its root.
  var inline = typeof document !== 'undefined' && document.getElementById
    ? document.getElementById('weave-manifest')
    : null;
  if (inline) {
    try {
      var parsed = JSON.parse(inline.textContent || 'null');
      if (parsed) { register(parsed); return; }
    } catch (e) { /* malformed inline manifest — fall through to the fetch */ }
  }

  // Resolve relative to THIS script, so a site published under a subdirectory
  // finds its own manifest rather than the domain root's.
  var here = (document.currentScript && document.currentScript.src) || '';
  var base = here ? here.slice(0, here.lastIndexOf('/') + 1) : '/';
  fetch(base + 'weave.manifest.json')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (manifest) { if (manifest) register(manifest); })
    .catch(function () { /* no manifest published — nothing to expose */ });
})();
`;

/** The README dropped next to the manifest inside a published bundle. */
export const BUNDLE_AGENT_README = `# Agent-ready WEAVE bundle

This site was produced by WEAVE, a visual website builder operated jointly by a
human and an AI agent over WebMCP.

## What is in here

- \`weave.manifest.json\` — this site's capability manifest: pages, sections and
  their semantic types, addressable element ids, the editor tools that built it,
  and the readiness score at publish time.
- \`public/weave-agent.js\` — a dependency-free runtime that makes the PUBLISHED
  site readable by an agent.
- everything else — your real Next.js App Router source. No proprietary format.

## Making the published site agent-operable

Add one line to your layout:

\`\`\`html
<script src="/weave-agent.js" defer></script>
\`\`\`

On a browser exposing \`document.modelContext\`, the site then registers:

| Tool | Access | What it does |
|---|---|---|
| \`weave_site_get_context\` | read-only | Site name, routes, sections of the current page |
| \`weave_site_read_section\` | read-only | Live text of one section, read from the DOM by its stable id |
| \`weave_site_navigate\` | navigation | Navigates to one of this site's own routes; external URLs are refused |

Where no WebMCP runtime is present the script does nothing — it adds no
globals and throws no errors.

## Honest scope

The published runtime is a working demonstrator and is deliberately read-only
plus same-site navigation. It has no write path: changing a site remains an
operation inside the WEAVE editor, where every mutation is validated and
publishing requires explicit human approval.
`;
