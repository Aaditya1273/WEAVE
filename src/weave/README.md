# src/weave — the WEAVE layer

Everything under `src/weave/` is **original WEAVE code**, added on top of the
upstream Revyme editor (AGPL-3.0 — see `/LICENSE` and `/NOTICE`). Upstream code
is reused, never replaced: every WEAVE mutation ends up in the editor's own
mutation queue, generators, oracle and undo history.

## The one pipeline

```
human panels ──► queueMutation ──► generators ──► ProjectFS ──► canvas
                       ▲
WebMCP tool ──┐        │
ChangeSet   ──┼──► WeaveOperation ──► executeTool ──┘
Test console ─┘     (commands.ts)
```

`commands.ts` is the single chokepoint. Tools are schema wrappers over it;
ChangeSets are batches of its operations; the developer console calls the same
dispatcher an external agent reaches. There is no second write path.

## Files

| File | Owns |
|---|---|
| `commands.ts` | **The unified action pipeline.** The 24-member `WeaveOperation` union, validation, safety allow-lists (styles, attributes, tags, motion), `executeOperation`, atomic `applyOperations` with rollback |
| `changeset.ts` | ChangeSet model and lifecycle: propose → amend/skip → apply/reject, staleness, atomic commit as one undo step |
| `revision.ts` | The project revision counter every ChangeSet is pinned to; coalesced so a drag is one revision |
| `context.ts` | The bounded, semantic snapshot an agent reads, plus the change subscription |
| `validate.ts` | Deterministic site checks and the explainable agent-readiness score |
| `publish.ts` | Human-gated publish: request → approval card → persist → bundle |
| `manifest.ts` | `weave.manifest.json` + the `weave-agent.js` runtime shipped with a published site |
| `webmcp/adapter.ts` | The only file touching `document.modelContext`. Feature detection, register/unregister, capability report |
| `webmcp/registry.ts` | Tool definitions, schema validation, cancellation, telemetry, the adaptive tool surface |
| `tools.ts` | The nine core `weave_*` tools — read, edit one element, propose, validate, publish |
| `tools-advanced.ts` | The other 39: search, structure, pages, design tokens, variables and interactions, motion, languages, content collections, components, comments, history, and the deeper reads |
| `starter-project.ts` | The EMBER demo storefront, composed from oracle-validated blueprints |
| `first-run.ts` | Fail-safe first-load camera focus and project naming |
| `zip.ts` | Dependency-free store-only zip writer |
| `store.ts` | Jotai atoms: WebMCP status, activity feed, pending publish, validation, inspector |
| `ui/AgentPanel.tsx` | Status, shared context, readiness, tools, activity, Test Console |
| `ui/ProposalOverlay.tsx` | The ChangeSet review surface — inspect, amend, skip, apply |
| `ui/InspectorOverlay.tsx` | Live WebMCP state: runtime, capabilities, schemas, last invocations |
| `init.ts` | One call, invoked from `App.tsx` after mount |
| `weave.test.ts` | Behaviour tests against the real store, parser, queue and history |
| `tools-advanced.test.ts` | Every extended tool against the same real pipeline — outcomes in the project, not return values |
| `payload.test.ts` | The measured token comparison behind the README's efficiency claim |
| `e2e/weave-collaboration.spec.ts` | 9 Playwright specs covering the whole loop in a browser |

## Changes outside this directory

Small and listed so the boundary stays legible:

- `index.html` / `app/index.html` — the landing page and the editor shell; the editor moved
  to `/app/` so `/` can introduce the product instead of dropping visitors into the canvas.
- `src/App.tsx` — `initWeave()` after mount, mounts the two overlays.
- `src/code/stores/left-panel-store.ts` — the `'agent'` panel id.
- `src/editor/left-toolbar/{LeftMenu,LeftPanel}.tsx` — the Agent rail button and panel.
- `src/editor/header/LeftHeader.tsx` — the WEAVE mark.
- `src/ProjectLoader.tsx` — seeds the EMBER starter in standalone mode.
- `src/shared/sections-library/` — eight new blueprints (each marked) and their categories.
- `src/shared/insert-items/element-data.ts` — re-enabled the Sections insert category.
- `src/test-setup.ts`, `vitest.config.ts` — `localStorage` shim for Node ≥ 22.
