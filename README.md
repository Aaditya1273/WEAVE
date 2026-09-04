# WEAVE

**The website builder built for humans and agents.**

Build visually. Direct your agent. Publish an agent-ready website.

WEAVE is a visual website builder in which a person and an AI agent author the **same live
project** through **WebMCP**. The human drags, types and restyles on a real canvas. The
agent reads structured project state — never the DOM — and proposes changes the human
inspects, edits and approves. Accepted work commits atomically as a new revision, and one
undo reverses it. Nothing consequential happens without a human click.

WEAVE is built on the open-source [Revyme](docs/UPSTREAM-README.md) editor (AGPL-3.0). The
editor, canvas engine, code generation and every existing panel are upstream work,
preserved intact. WEAVE adds a layer around them — see [What WEAVE added](#15-what-weave-added).

---

## 1. What WEAVE is

https://weave-webmcp.vercel.app

A code-first visual builder whose document is real Next.js source, plus:

- a **unified action pipeline** — human panels, WebMCP tools and the developer console all
  drive one command layer, so an agent edit and a human edit are literally the same
  mutation, the same generated code and the same undo entry;
- **ChangeSets** — an agent proposes several related edits as ONE reviewable transaction,
  which the human amends, partially skips, applies or rejects;
- **revisions and staleness** — every proposal is pinned to the revision it was reasoning
  about and is refused if the human has since moved the project;
- **structured semantic context** — sections with types, elements with stable ids, bounded
  for an agent's budget;
- **deterministic validation** and an **explainable agent-readiness score**;
- a **human publish gate** an agent cannot bypass;
- an **agent-ready published site** — the bundle carries a capability manifest and a small
  runtime that registers the site's own tools.

## 2. Why WebMCP matters

An agent that wants to change a website today either edits raw files blind or drives the UI
by screenshots and synthetic clicks. Both are brittle, slow and unauditable. WebMCP lets a
page expose typed, described, annotated tools to an agent running in the browser. WEAVE
uses that to make the *editor itself* agent-operable: the tools speak the editor's own
vocabulary, every input is validated three times before it reaches the project, and the
safety hints reflect real consequences.

## 3. What humans can do

Everything the upstream editor does — draw, drag, resize, restyle, build components and
variants, animate, localise, manage CMS collections, edit code, preview, undo. Plus:

- watch, in the **WEAVE Agent** panel, exactly what an agent can see and has done;
- **review proposals**: read each operation's before and after, retype values, skip
  individual operations, apply or reject the rest;
- **approve or decline** any publish an agent requests;
- **check agent readiness** and jump straight to the element behind any finding;
- **inspect the WebMCP integration** — runtime, capabilities, schemas, last invocations;
- run any tool by hand from the **WebMCP Test Console**, clearly labelled as a developer
  surface, with its calls labelled `console` in the activity feed.

## 4. What agents can do

Read the project and the human's selection, add library sections, update content and safe
styles, move and delete elements, propose multi-operation changes for review, validate the
site, and *request* a publish. Every write goes through the editor's validated mutation
pipeline: an agent cannot write arbitrary code, touch the DOM, execute anything, or reach
the project without passing schema validation, command-layer validation and the editor's
own generators.

## 5. Why WebMCP beats UI scraping here

| | Screenshot / DOM scraping | WEAVE over WebMCP |
|---|---|---|
| What the agent sees | Pixels, or a DOM with no semantics | Parsed model: section types, element ids, layout, selection |
| How it acts | Synthetic clicks and keystrokes | Typed tools, validated, with real safety annotations |
| Multi-step work | Fire-and-hope, one action at a time | One ChangeSet the human reviews, amends and applies atomically |
| Concurrency | Silent clobbering | Revision-pinned; a stale proposal is refused, not applied |
| Reversibility | None | One undo reverses an entire agent transaction |
| Consequences | Whatever the model decides | Publish is gated on an explicit human click |

## 6. Architecture

```
   Human (canvas, panels)                 External agent (WebMCP)
            │                                       │
            │                        document.modelContext.registerTool(weave_*)
            │                                       │
            │                    src/weave/webmcp/adapter.ts   (feature-detected)
            │                    src/weave/webmcp/registry.ts  (schema · cancel · adaptive)
            │                    src/weave/tools.ts            (9 product tools)
            │                                       │
            │                          ┌────────────┴────────────┐
            │                          │                         │
            │                   direct operation        weave_propose_changes
            │                          │                         │
            │                          │                 src/weave/changeset.ts
            │                          │              propose → amend/skip → apply
            │                          │                         │
            ▼                          ▼                         ▼
        ══════════════ src/weave/commands.ts — ONE action pipeline ══════════════
                                       │ validate · allow-lists · atomic + rollback
                                       ▼
                    code/mutation/mutation-queue.ts  ──►  generators  ──►  ProjectFS
                                       │                                      │
                             history (one undo step)                    parser.ts
                                       │                                      │
                                       │                          Map<id, CanvasNode>
                                       │                              │           │
                                       │              src/weave/context.ts   canvas iframe
                                       │            (semantic snapshot + revision)
                                       ▼
                              src/weave/revision.ts  ── pins every ChangeSet
```

The shape the brief asks for — *editor state → canonical model → WEAVE adapter → WebMCP
tools → structured mutation → existing update pipeline → canvas* — maps onto this exactly.
The canonical model is the parsed `CanvasNode` map; the adapter is `src/weave/`; mutations
are the upstream queue.

## 7. WebMCP tools

| Tool | Class | What it does |
|---|---|---|
| `weave_get_context` | read-only | Project, page, revision, viewports, selection, typed sections, bounded element tree, pending proposals, capabilities |
| `weave_get_selection` | read-only | Full detail for the selected element: type, parent, children, layout, styles, attributes |
| `weave_add_section` | write | Inserts an oracle-validated library section (`hero`, `products`, `features`, `testimonials`, `pricing`, `faq`, `cta`, `contact`, `footer`, `header`) |
| `weave_update_element` | write | Text, layer name, visibility, allow-listed styles, allow-listed attributes |
| `weave_move_element` | write | Reorder among siblings or re-parent, cycle-checked |
| `weave_delete_element` | **destructive** | Removes an element and its children; undoable |
| `weave_propose_changes` | **human-gated** | Submits several operations as ONE reviewable ChangeSet; changes nothing until applied |
| `weave_validate_site` | read-only | Real findings with element ids, plus the explainable readiness score |
| `weave_publish_site` | **human-gated** | Requests a publish; only a human click performs one |

Element-scoped tools are exposed **adaptively** — they appear when the human has a
selection, so an agent sees a relevant surface rather than every capability at once. The
Inspector shows what is exposed and what is hidden, and why.

Every result is `{ ok: true, ... }` or `{ ok: false, error: { code, message } }`. Codes
include `UNKNOWN_TOOL`, `INVALID_ARGS`, `CANCELLED`, `ELEMENT_NOT_FOUND`, `NO_TARGET`,
`AMBIGUOUS_TARGET`, `UNSUPPORTED_STYLE`, `UNSUPPORTED_ATTR`, `NOT_A_LINK`, `INVALID_MOVE`,
`UNSUPPORTED_SECTION`, `CHANGESET_STALE`, `CHANGESET_EMPTY`, `PUBLISH_ALREADY_PENDING`.

### WebMCP API usage

`src/weave/webmcp/adapter.ts` is the only file that touches the browser surface. It
feature-detects `document.modelContext` first (the current draft), falling back to
`navigator.modelContext` and `window.modelContext`, and uses `registerTool` where present
with `provideContext({ tools })` as the legacy path. It supports `unregisterTool`,
duplicate-safe re-registration, `getTools()`, and `toolchange` events where the runtime
offers them, and passes each call's `AbortSignal` through to the dispatcher. Nothing is
polyfilled: with no runtime the panel says *No WebMCP runtime* and the Inspector reports
exactly which parts of the API were found.

## 8. Human confirmation model

**Proposals.** `weave_propose_changes` writes nothing. The Agent panel shows a proposal
card; the human opens the review, sees each operation's *now* and *will become*, retypes
editable values, skips what they dislike, and applies. Accepted operations commit
atomically as ONE undo step and one new revision. If the human edited the page since the
proposal was made, applying is refused with `CHANGESET_STALE` and their work is untouched.

**Publish.** `weave_publish_site` never publishes. It opens an approval card showing the
revision, what changed since the last publish and the readiness score. Only
**Approve & publish** flushes mutations, persists through the editor's autosave, and
produces `weave-site.zip`: your full Next.js source, `weave.manifest.json` and
`public/weave-agent.js`. No third-party deployment provider is contacted or simulated.

## 9. Local development

```bash
npm install
npm run dev        # editor :3333, canvas sandbox :5174, preview :5175
```

Open <http://localhost:3333>. A fresh standalone session boots on **EMBER**, a hand-built
ceramics storefront (hero, products, features, testimonials, FAQ, call to action, footer)
across three breakpoints, focused on the hero at a readable zoom. The first icon in the
left rail is **WEAVE Agent**. Node ≥ 22.

Open the Inspector directly with <http://localhost:3333/?weave=inspector>.

## 10. Production / Vercel deployment

The editor is three Vite bundles. Upstream serves them on three ports; WEAVE adds a
single-origin layout so a static host can serve all of them:

```bash
npm run build:vercel   # → dist/ (editor), dist/sandbox/, dist/preview-sandbox/
```

`vercel.json` runs that command and serves `dist/`. Iframe URLs come from
`VITE_SANDBOX_URL=/sandbox` and `VITE_PREVIEW_URL=/preview-sandbox` (set by the script), so
nothing depends on localhost ports. Deploy with `vercel --prod`, or import the repository
in the Vercel dashboard with no framework preset.

WebMCP is a powerful capability and browsers gate it on a secure context, so a deployed
HTTPS origin is where an external agent can actually connect; the Inspector reports the
secure-context state it observes.

Trade-off: on one origin the canvas iframe loses the separate-process isolation the
port-based layout provides. That is a performance nicety, not a functional requirement.

## 11. Testing

```bash
npx tsc --noEmit                                     # typecheck (vitest does not)
npm run lint
npx vitest run                                       # full unit + integration suite
npx vitest run src/weave                             # WEAVE behaviour tests
npx playwright test src/weave/e2e                    # the collaboration loop in a browser
```

`src/weave/weave.test.ts` drives the real jotai store, parser, mutation queue, paste engine
and undo history on an in-memory project: tool registration and annotations, schema
rejection, adapter registration/unregistration/cancellation against a mock runtime, context
and selection shape, each mutation tool, ChangeSet creation, amendment, skipping,
rejection, atomic apply, mid-transaction rollback, staleness, undo/redo of an agent
transaction, validation and score arithmetic, the publish gate, the activity feed, and the
generated site runtime actually executing and registering its tools.

`src/weave/e2e/weave-collaboration.spec.ts` runs the same story in Chromium against a real
editor: structured context, a human selection reaching the agent, an agent edit appearing
in the canvas iframe, a three-operation proposal reviewed/amended/applied, a stale proposal
refused, a one-step undo of an agent transaction, real validation, and the publish gate.

## 12. Environment variables

None are required. See `.env.example`. WEAVE-specific: `VITE_SANDBOX_URL`,
`VITE_PREVIEW_URL` for single-origin deploys. The WEAVE layer reads and stores no secrets.

## 13. Upstream attribution

WEAVE is a derivative work of **Revyme** — open-source visual web builder,
Copyright © 2026 Nikita Kofman, AGPL-3.0. The original README is preserved at
[`docs/UPSTREAM-README.md`](docs/UPSTREAM-README.md); the original `LICENSE` and `NOTICE`
are preserved (NOTICE has a WEAVE section appended, nothing removed). All upstream
copyright notices and author attributions in source files are retained.

## 14. License

AGPL-3.0-only, including Revyme's section 7(b) additional term (see `NOTICE`). WEAVE's
additions are released under the same license.

## 15. What WEAVE added

| Area | Where |
|---|---|
| Unified action pipeline, ChangeSets, revisions, validation, publish gate, manifest, adapter, registry, tools | `src/weave/**` (see [`src/weave/README.md`](src/weave/README.md)) |
| Agent panel, proposal review overlay, WebMCP Inspector | `src/weave/ui/**` |
| Editor wiring (`'agent'` panel, rail button, init, overlay mounts) | `src/App.tsx`, `src/code/stores/left-panel-store.ts`, `src/editor/left-toolbar/*` |
| Eight section blueprints, accessibility fixes, Sections insert category | `src/shared/sections-library/**`, `src/shared/insert-items/element-data.ts` |
| EMBER starter project, first-run camera and naming | `src/weave/starter-project.ts`, `src/weave/first-run.ts`, one branch in `src/ProjectLoader.tsx` |
| Published-site agent runtime and capability manifest | `src/weave/manifest.ts` |
| Single-origin deployment | `vercel.json`, `build:vercel`, `base` support in the two iframe Vite configs |
| Branding | `index.html`, `src/editor/header/LeftHeader.tsx`, `package.json` |
| Test harness shim for Node ≥ 22 `localStorage`; upstream lint-debt cleanup | `src/test-setup.ts`, `vitest.config.ts`, 34 upstream files (mechanical) |

**Deliberately not built**, to keep the core solid: Shopify connectors, multiple deployment
providers, and push-style `provideContext` of page content (the shipping API has no
reliable channel for it, so context is pull-based and the code says so).

