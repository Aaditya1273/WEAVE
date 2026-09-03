# WEAVE

**The website builder built for humans and agents.**

Build visually. Direct your agent. Publish an agent-ready website.

WEAVE is a visual website builder in which a human and an AI agent edit the **same live
project** through **WebMCP** structured tools. The human drags, types and restyles on a
real canvas; the agent reads structured page context and calls typed tools that go through
the exact same mutation pipeline. Both see the result in the same canvas, and nothing
consequential (publishing) happens without a human click.

WEAVE is built on top of the open-source [Revyme](docs/UPSTREAM-README.md) editor
(AGPL-3.0). The editor, canvas engine, code generation and every existing panel are
upstream work, preserved intact. WEAVE adds a clean layer around it — see
[What WEAVE added](#what-weave-added).

---

## 1. What WEAVE is

A code-first visual builder whose document is real Next.js source, plus:

- a **WebMCP tool surface** (`weave_*`) registered with the browser's model-context API
  when one is present, so an external agent can operate the open project;
- a **structured context loop** — the agent never scrapes the DOM; it reads the editor's
  parsed node model, which updates as the human edits;
- a **WEAVE Agent panel** that shows connection state, shared context, available tools,
  recent tool activity and human approvals;
- a **human-gated publish** that an agent can request but never execute;
- a **section library** shared by humans (Insert panel) and agents (`weave_add_section`);
- an **agent-ready bundle** on publish: full source plus a WebMCP capability manifest.

## 2. Why WebMCP matters

Today an agent that wants to change a website either edits raw files blind or drives the
UI by screenshots and clicks. Both are brittle, slow and unsafe. WebMCP lets a web page
expose **typed, described, annotated tools** to an agent running in or alongside the
browser. WEAVE uses that to make the *editor itself* an agent-operable surface: the tools
carry the editor's own vocabulary (elements, sections, selection, pages), the schemas are
validated, and the safety hints (`readOnlyHint`, `destructiveHint`) reflect real risk.

## 3. What humans can do

Everything the upstream editor does: draw, drag, resize, restyle, build components and
variants, animate, localise, manage CMS collections, edit code, preview, undo. Plus:

- open the **WEAVE Agent** panel (first icon in the left rail) to watch what an agent reads
  and does, in real time;
- **approve or cancel** any publish an agent requests;
- insert the same sections an agent can (Insert → Sections);
- run any tool by hand from the **WebMCP Test Console** (a developer tool — clearly
  labelled, and its calls are labelled `console` in the activity feed).

## 4. What agents can do

Through the seven `weave_*` tools an agent can read the project and selection, add
sections, update text / names / visibility / safe styles / link attributes, move and
reorder elements, delete elements, and *request* a publish. Every write goes through the
editor's validated mutation queue and code generators — an agent cannot write arbitrary
code, touch the DOM, or bypass the oracle that guards the file dialect.

## 5. Why WebMCP beats UI scraping here

| | Screenshot / DOM scraping | WEAVE over WebMCP |
|---|---|---|
| What the agent sees | Pixels or a DOM with no semantics | Parsed node model: ids, tags, names, text, sections, selection |
| How it acts | Synthetic clicks and keystrokes | Typed tools with JSON schemas and validation |
| Staleness | Unknown | `contextVersion` bumps on every human edit |
| Safety | None | Read/write/destructive annotations; publish is human-gated |
| Result | Fragile, slow, unauditable | Deterministic, logged, undoable |

## 6. Architecture

```
Human (canvas, panels)            External agent (WebMCP)
        │                                   │
        ▼                                   ▼
 editor panels ──► queueMutation()   navigator.modelContext.registerTool(weave_*)
        │                                   │
        │                        src/weave/webmcp/adapter.ts   (feature-detected)
        │                        src/weave/webmcp/registry.ts  (schemas, validation, errors)
        │                        src/weave/tools.ts            (7 tools)
        │                                   │
        └──────────────► code/mutation/mutation-queue.ts ◄──────┘
                                    │
                        code/generation/*  (pure code → code)
                                    │
                            ProjectFS (.tsx source)
                                    │
                          code/parsing/parser.ts
                                    │
                        Map<id, CanvasNode>  ──► src/weave/context.ts (structured context)
                                    │
                        canvas/Renderer.ts (sandboxed iframe)
```

The preferred shape from the brief — *existing editor state → canonical model → WEAVE
adapter → WebMCP tools → structured mutation → existing update pipeline → canvas* — maps
one-to-one onto this. The canonical model is the parsed `CanvasNode` map; the WEAVE
adapter is `src/weave/`; mutations are the upstream queue.

## 7. WebMCP tools

| Tool | Kind | What it does |
|---|---|---|
| `weave_get_context` | read-only | Bounded snapshot: pages, current page, viewports, selection, sections, element tree, `contextVersion` |
| `weave_get_selection` | read-only | Detailed view of the selected element(s) or a given `element_id`, with available mutations |
| `weave_add_section` | write | Inserts a library section (`hero`, `header`, `features`, `products`, `testimonials`, `pricing`, `faq`, `cta`, `contact`, `footer`) after an anchor or at the end |
| `weave_update_element` | write | `text`, `name`, `visible`, safe `styles`, allow-listed `attrs` (`href`, `src`, `alt`, `target`, `rel`, `aria-label`) |
| `weave_move_element` | write | Re-parent and/or reorder through the structured model (cycle-checked) |
| `weave_delete_element` | destructive | Removes an element and its children (undoable in the editor) |
| `weave_publish_site` | high consequence | Requests a publish; the human must approve in the Agent panel |

Every result is `{ ok: true, ... }` or `{ ok: false, error: { code, message } }`. Error
codes include `UNKNOWN_TOOL`, `INVALID_ARGS`, `ELEMENT_NOT_FOUND`, `NO_TARGET`,
`UNSUPPORTED_STYLE`, `UNSUPPORTED_ATTR`, `INVALID_MOVE`, `UNSUPPORTED_SECTION`,
`INSERT_FAILED`, `PUBLISH_ALREADY_PENDING`, `MUTATION_FAILED`, `INTERNAL_ERROR`.

**WebMCP registration.** `src/weave/webmcp/adapter.ts` feature-detects
`navigator.modelContext` (falling back to `window.modelContext`), prefers `registerTool`
and falls back to `provideContext({ tools })`. If neither exists the panel reports
*No WebMCP runtime* and nothing pretends otherwise. There is no polyfill dependency.

**Context loop.** `src/weave/context.ts` subscribes to the node map, selection and active
file, bumping `contextVersion` (debounced) on every change. The loop is pull-based: agents
call `weave_get_context` again. Push-style `provideContext` of page *content* is not
relied on because the shipping browser API does not offer a reliable channel for it —
this is documented rather than faked.

## 8. Human confirmation model

`weave_publish_site` never publishes. It writes a pending request, the Agent panel opens
with an **Agent requested publish** card, and only a human click on **Approve & publish**
runs the real flow: flush pending mutations → persist through the editor's autosave
backend → build a `weave-site.zip` (full Next.js source + `weave.manifest.json` +
`WEAVE-AGENT-README.md`) → download. **Cancel** discards the request. A second request
while one is pending is rejected with `PUBLISH_ALREADY_PENDING`.

No deployment provider is faked. In this repository "publish" is the reviewed, persisted,
exportable bundle; the upstream cloud publish endpoint is outside this repo.

## 9. Local development

```bash
npm install
npm run dev        # editor :3333, canvas sandbox :5174, preview :5175
```

Open <http://localhost:3333>. A fresh standalone session boots on the **ATELIER** starter
(hero, products, features, testimonials, FAQ, CTA, footer) with three viewports; work is
autosaved to `localStorage`. The first icon in the left rail is **WEAVE Agent**. Node ≥ 22.

## 10. Production / Vercel deployment

The editor is three Vite bundles. Upstream serves them on three ports; WEAVE adds a
**single-origin** layout so a static host can serve all of them:

```bash
npm run build:vercel   # → dist/ (editor), dist/sandbox/, dist/preview-sandbox/
```

`vercel.json` runs that command and serves `dist/`. The iframe URLs come from
`VITE_SANDBOX_URL=/sandbox` and `VITE_PREVIEW_URL=/preview-sandbox` (set by the script),
so nothing depends on localhost ports. Deploy with `vercel --prod` or by importing the repo
in the Vercel dashboard (no framework preset; the config file is authoritative).

Trade-off: on one origin the canvas iframe loses the separate-process isolation the
port-based layout gives. It is a performance nicety, not a functional requirement.

## 11. Testing

```bash
npx tsc --noEmit          # typecheck (vitest does not)
npm run lint
npx vitest run            # full suite
npx vitest run src/weave  # WEAVE: tools against the real mutation pipeline
```

`src/weave/weave.test.ts` drives the actual jotai store, parser, mutation queue and paste
engine on an in-memory project — it proves an agent's tool call changes the same source
the human edits (20 tests, including a stale-queue regression and the starter page's
oracle check). Every section blueprint is oracle-validated by the upstream
`sections-blueprints.test.ts`. The full upstream suite (609 files) passes.

Browser verification was done with a headless Playwright script against the dev servers:
editor boots on the starter, canvas click updates the panel's selection, every tool runs
from the Test Console, agent inserts / edits / moves appear in the canvas iframe DOM, the
publish request is blocked behind the approval card, and edits survive a reload.

## 12. Environment variables

None are required. See `.env.example`. WEAVE-specific: `VITE_SANDBOX_URL`,
`VITE_PREVIEW_URL` (single-origin deploys). No secrets are read or stored by the WEAVE
layer.

## 13. Upstream attribution

WEAVE is a derivative work of **Revyme** — open-source visual web builder,
Copyright © 2026 Nikita Kofman, AGPL-3.0. The original README is preserved at
[`docs/UPSTREAM-README.md`](docs/UPSTREAM-README.md); the original `LICENSE` and `NOTICE`
are preserved unchanged (NOTICE has a WEAVE section appended, nothing removed). All
upstream copyright notices and author attributions in source files are retained.

## 14. License

AGPL-3.0-only, including Revyme's section 7(b) additional term (see `NOTICE`). WEAVE's
additions are released under the same license.

## 15. What WEAVE added

| Area | Files |
|---|---|
| WebMCP adapter, registry, tools, context, publish gate, manifest, zip | `src/weave/**` |
| Agent panel + WebMCP Test Console | `src/weave/ui/AgentPanel.tsx` |
| Editor wiring (`'agent'` panel id, rail button, init call) | `src/code/stores/left-panel-store.ts`, `src/editor/left-toolbar/LeftMenu.tsx`, `src/editor/left-toolbar/LeftPanel.tsx`, `src/App.tsx` |
| Eight section blueprints + re-enabled Sections insert category | `src/shared/sections-library/blueprints/*` (marked), `src/shared/insert-items/element-data.ts` |
| ATELIER starter project (standalone boot state, composed from the blueprints) | `src/weave/starter-project.ts`, one branch in `src/ProjectLoader.tsx` |
| Test harness shim for Node ≥ 22's `localStorage` global | `src/test-setup.ts`, `vitest.config.ts` |
| Lint debt cleanup (unused imports, `prefer-const`, useless regex escapes) so `npm run lint` reports 0 errors | 34 upstream files, mechanical fixes only |
| Single-origin deploy | `vercel.json`, `build:vercel`, `VITE_SANDBOX_URL` / `VITE_PREVIEW_URL`, `base` support in the two iframe Vite configs |
| Branding | `index.html`, `src/editor/header/LeftHeader.tsx`, `package.json` |
| Docs | this README, `docs/HACKATHON.md`, `src/weave/README.md` |

Not implemented (deliberately, to keep P0 solid): Shopify connectors, multiple deployment
providers, push-style `provideContext` of page content.
