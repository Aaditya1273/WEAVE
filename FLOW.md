# WEAVE — 3-minute demo flow

Everything in this document has been verified against the running build. Where a
number appears, it was measured, not estimated. Where something cannot be shown,
it says so and gives you the honest alternative.

- **Live:** https://weave-webmcp.vercel.app — landing at `/`, editor at `/app/`
- **Repo:** https://github.com/Aaditya1273/WEAVE
- **One-liner:** *A creative workspace where a human and an AI agent author the same
  website through a structured, inspectable, reversible WebMCP interaction model.*

---

## 0. What you actually built (say this in one breath)

> "Website builders are built for hands. Agents get screenshots. WEAVE makes the
> **editor itself** a WebMCP surface — so ChatGPT reads the real page model, proposes
> a set of changes, and I approve them. Same project, two authors, one undo stack."

The three things that make it not-a-chatbot-bolted-on:

| | What it is | Why a judge cares |
|---|---|---|
| **ChangeSets** | The agent proposes N edits as **one reviewable transaction**. You edit values, skip operations, apply the rest — it commits atomically as one undo step. | Nobody else demos *negotiation*. Everyone demos tool calls. |
| **Revisions + staleness** | Every proposal is pinned to a revision. Edit the page first and the proposal is **refused as stale**, not applied blind. | This is real concurrency engineering, visible in 5 seconds. |
| **Human gate + agent-ready output** | Publish requires your click. The bundle ships a capability manifest + runtime so the *published site* exposes its own tools. | Closes the loop: an agent-built site is itself agent-ready. |

---

## 1. Pre-flight (do this 15 minutes before recording)

### 1.1 ChatGPT desktop — enable site tools

WebMCP site tools are **officially supported in the ChatGPT desktop app's built-in
browser**. This is the real integration path — no extension, no bridge, no MCP server.

1. Update the ChatGPT desktop app to the latest version.
2. **Settings → Browser → Permissions → enable "Enable site tools."**
3. Set the model to **GPT-5.6 Sol** or **GPT-5.6 Terra**.
   ⚠️ **GPT-5.6 Luna has WebMCP disabled.** Enterprise/Edu workspaces are not supported.
4. In the ChatGPT built-in browser, open **https://weave-webmcp.vercel.app/app/**
5. Click **"Site tools"** in the address bar → **"Available site tools."**
   You should see the `weave_*` tools listed.

### 1.2 Confirm the connection before you hit record

Two independent confirmations — show at least one on camera:

- **In WEAVE:** the Agent panel chip reads **“WebMCP connected”** in green.
  (It reads “No WebMCP runtime” in a normal browser — that is the honest fallback,
  not a bug.)
- **In ChatGPT:** address bar → *Site tools → Available site tools* lists the tools.

### 1.3 Verified facts you can rely on

These were tested against a simulated runtime identical in shape to ChatGPT's:

| Check | Result |
|---|---|
| Tools register in the **top-level frame** | ✅ `TOP` — ChatGPT ignores tools registered inside iframes; ours are not |
| Tools defined | **48** |
| Tools exposed with **nothing selected** | **25** — reads, search, sections, pages, tokens, variables, comments, proposals, validate, publish |
| Tools after you **select an element** | **39** — adds the 14 element-scoped ones (`get_selection`, `update_element`, `duplicate`, `change_tag`, `set_link`, `animate`, `screenshot`, …) |
| Tools still hidden | **9** — gated on capabilities this project has yet to use (locales, components, undo/redo) |
| Agent-called `weave_get_context` | ✅ returns 7 typed sections |
| Agent-called `weave_propose_changes` | ✅ returns `awaiting_human_review`, card appears in WEAVE |
| Activity feed labels agent calls | ✅ rows marked `agent` |

> **This matters for your script:** with nothing selected the agent *cannot* call
> `update_element`. That is the adaptive surface working. Either **select the hero
> first**, or let the agent use `weave_propose_changes` (which takes explicit targets).
> Both are good demo beats — just don't be surprised by it live.
>
> The surface follows the PROJECT too, not just the cursor: `weave_list_locales` appears
> once the site has a second language, the component tools once a component exists, and
> `weave_undo` only when there is something to undo. If a judge asks why there aren't 48
> tools on screen, that is the answer — and it's the same argument as the token numbers.

### 1.4 Reset to a clean demo state

The project autosaves to `localStorage`. To start fresh:
open DevTools → Application → Local Storage → delete `revyme-project-local` →
reload `/app/`. You'll get the EMBER storefront, focused on the hero at 53% zoom.

### 1.5 Recording setup

- 1600×950 or larger. The Agent panel is on the left; keep it visible the whole time.
- Have **two windows side by side**: ChatGPT desktop (left) and WEAVE (right) —
  or use ChatGPT's built-in browser and screen-record the whole app.
- Dismiss the onboarding tutorial ("Don't show again") **before** recording.

---

## 2. The 3-minute script

Total: **180 seconds.** Times are cumulative. Narration is written to be read aloud.

### 0:00 – 0:20 — The landing page (what and why)

**Show:** `https://weave-webmcp.vercel.app` — scroll slowly through the hero into
"One project. Two authors."

> "This is WEAVE. Website builders are built for hands and mice; AI agents get
> screenshots and synthetic clicks. WEAVE makes the editor itself an agent surface,
> so a person and an agent can author the same site through WebMCP."

**Point at:** the HUMAN / AGENT / WEAVE loop strip — orange is you, green is the agent.

Click **Open the editor**.

---

### 0:20 – 0:35 — The product is real

**Show:** the EMBER storefront on the canvas, three breakpoints in the layers panel.

> "This is a real visual builder — the document is actual Next.js source, not a
> proprietary format. Seven sections, three breakpoints."

**Open the Agent panel** (first icon in the left rail).

> "And this is the agent's window into it."

**Point at:** the green **“WebMCP connected”** chip.

---

### 0:35 – 1:05 — The agent reads real structure (Prompt 1)

**In ChatGPT, type Prompt 1** (§3.1). While it runs:

**Point at, in order:**
1. **Activity feed** — a new row appears, labelled **`agent`**, `weave_get_context`.
2. **Shared context** — Page `/`, Sections 7, Revision 1.

> "The agent just read the page. Not pixels, not a DOM dump — typed sections, stable
> element ids, and my current selection. Twelve kilobytes instead of a hundred-and-twenty."

**Now click the hero headline on the canvas.**

**Point at:** *Selection* in Shared context changes, and the **tool list grows from
25 to 39**.

> "The tool surface is adaptive. Element tools only exist while I'm pointing at
> something — so the agent sees a relevant surface, not every capability at once."

---

### 1:05 – 1:50 — The centrepiece: a negotiated ChangeSet (Prompt 2)

**In ChatGPT, type Prompt 2** (§3.2).

**Point at:** the canvas — **nothing moves.**

> "The agent didn't edit anything. It proposed. Three operations, one transaction,
> pinned to the revision it was looking at."

**Click "Review proposal."**

**In the overlay, do all three of these on camera:**
1. **Read a row aloud** — "here's the current headline, here's what it would become."
2. **Retype one value** in the editable field → the **“edited by you”** badge appears.
3. **Click "Skip"** on one operation → the button changes to **“Apply 2 changes.”**

> "I can rewrite what it said, drop what I don't want, and apply the rest. This is
> negotiation, not automation."

**Click "Apply 2 changes."**

**Point at:** canvas updates, **Revision increments**, activity shows the agent's
proposal and *your* amendment as separate rows.

> "Committed atomically as one revision."

**Press Ctrl+Z once.**

> "And one undo reverses the entire agent transaction — never half of it."

**Press Ctrl+Shift+Z** to redo.

---

### 1:50 – 2:15 — Staleness: the safety story (Prompt 3)

**In ChatGPT, type Prompt 3** (§3.3) — asks for another proposal.

**Then, before approving, edit the hero headline yourself on the canvas.**

**Click "Review proposal."**

**Point at:** the red **“Stale proposal”** banner and the **disabled Apply button**.

> "I moved while it was thinking. The page is now revision 4; the proposal was built
> on revision 3. WEAVE refuses it rather than applying it to state the agent never saw.
> My edit survives."

Click **Dismiss**.

---

### 2:15 – 2:40 — Validation, readiness, and the publish gate (Prompts 4 & 5)

**In ChatGPT, type Prompt 4** (§3.4).

**Point at:** **Agent readiness** in the panel → click **Show checks**.

> "The score is the published sum of its checks — labels, link destinations, section
> semantics, metadata. Clicking a finding selects the element it's about. Nothing here
> is a made-up percentage."

**In ChatGPT, type Prompt 5** (§3.5).

**Point at:** the **“Agent requested publish”** card — revision, what changed, and two
buttons.

> "The agent can *ask* to publish. It cannot publish. There is no code path from a tool
> call to a deploy — only this button."

**Click "Approve & publish."**

> "That persists the project and produces the bundle: my real Next.js source, plus a
> capability manifest and a runtime — so the site I just shipped exposes its **own**
> tools to the next agent."

---

### 2:40 – 3:00 — Close on the Inspector

**Click "Inspect"** in the Agent panel.

**Point at:** Host object `document.modelContext`, the capability pills, and the
48 tools with **exposed / hidden** state.

> "And none of this is a claim — the Inspector reports what's actually registered
> right now: which global carries the runtime, which parts of the API it implements,
> every schema, and the last call each tool received.
>
> WEAVE: a human and an agent, authoring the same website, through structured,
> inspectable, reversible WebMCP."

---

## 3. The ChatGPT prompts (type these verbatim)

Keep them conversational — you're demonstrating that a *normal request* produces
structured tool use, not that you know the tool names.

### 3.1 Prompt 1 — read the page

```
What's on this page right now? Tell me the sections and which one is the hero.
```

**Expect:** `weave_get_context`. **Point at:** the `agent`-labelled activity row and
Shared context. **Fallback line if it's slow:** "it's reading the structured model,
not the pixels."

---

### 3.2 Prompt 2 — the multi-operation proposal ★ the money shot

```
Make this homepage feel more premium. Rewrite the hero headline and the line under
it, and add a testimonials section. Propose it as one change I can review.
```

**Expect:** `weave_propose_changes` → `awaiting_human_review`.
**Point at:** canvas doesn't move → proposal card → review overlay.

> If ChatGPT tries to edit one element at a time instead, say on camera:
> *"I'll ask it to bundle that,"* and add: `Bundle those into a single proposal
> instead of separate edits.` That recovery is itself a good demo beat.

---

### 3.3 Prompt 3 — set up the staleness beat

```
Now propose a shorter, punchier version of that headline.
```

**Then edit the headline yourself before approving.** → Stale banner.

---

### 3.4 Prompt 4 — validation

```
Check whether this site is ready for agents to use, and tell me what's weakest.
```

**Expect:** `weave_validate_site` → score + findings with element ids.

---

### 3.5 Prompt 5 — the gate

```
Looks good — publish it.
```

**Expect:** `weave_publish_site` → `awaiting_human_approval`. **The site does not
publish.** Point at the approval card. This is the strongest safety moment in the demo.

---

## 4. How WEAVE uses WebMCP *deeply* (say one of these if asked)

Most integrations register a few tools and stop. Ours uses the API's real surface:

| WebMCP capability | How WEAVE uses it |
|---|---|
| `document.modelContext` | Preferred host, with `navigator`/`window` fallbacks for older drafts. Chrome deprecated `navigator.modelContext` in 150; we already moved. |
| `registerTool` / `unregisterTool` | **Adaptive surface** — element tools are registered and unregistered live as your selection changes. Duplicate-safe: re-registering a name replaces it rather than stacking. |
| `getTools()` | The Inspector reads back what the *runtime* reports, not just what we think we sent. |
| **Annotations** | `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`, plus our own `requiresHumanApproval`. Declared *and* enforced in code. |
| **`AbortSignal`** | Passed through to the dispatcher; an aborted call is refused *before* it touches project state. |
| `toolchange` events | Subscribed where the runtime emits them. |
| **Feature detection** | Every one of the above is detected, never assumed. No polyfill. With no runtime the UI says so plainly. |
| **Structured results** | Every tool returns `structuredContent` alongside `content`, and a uniform `{ ok, error: { code, message } }` envelope. |

**Security posture** (worth 10 seconds if a judge asks): three validation layers —
JSON schema → command-layer allow-lists → the editor's own code generators. No `eval`.
`javascript:` and `data:` URLs refused. `href` is refused on non-link elements because
this editor's dialect requires a Next.js `<Link>`. Tool descriptions are purely
descriptive — there's a test asserting they contain no instruction-shaped text, because
a tool description is an injection surface.

---

## 5. Credits and efficiency — with real measured numbers

> Measured on the live EMBER page in this build. Token figures are chars ÷ 4.

| Approach | Payload for one "what's on the page" read | Approx tokens |
|---|---|---|
| **WEAVE structured context** | 12,335 chars | **~3,100** |
| Raw DOM of the same canvas | 119,875 chars | ~30,000 |
| Screenshot (1600×950 PNG) | 509 KB image | vision tokens + no ids to act on |

**≈10× fewer tokens per read** — and unlike a screenshot, every id in the response is
directly actionable, so there's no second "find the element" step.

**Where the bigger saving actually comes from — round trips.**

A five-part change, done the usual way:

```
5 × (mutate → screenshot/DOM read to verify)  ≈ 5 mutations + 5 × 30k-token reads
```

The same change in WEAVE:

```
1 × get_context (3k)  →  1 × propose_changes  →  human applies  →  1 × get_context (3k)
```

One proposal replaces five verify-loops. The agent also stops paying to *re-discover*
the page: ids are stable across the round trip because they're real `data-id`
attributes in the source.

**And staleness prevents the most expensive failure of all** — an agent applying work
against state that moved, then paying again to detect and undo it. WEAVE refuses it up
front for free.

> Phrase it honestly on camera: *"This is an architectural saving backed by measured
> payload sizes — ten times less to read, and one proposal instead of five verify
> loops."* Don't claim a billing benchmark you didn't run.

---

## 6. Judging criteria — what to point at

| Criterion | Your evidence on screen |
|---|---|
| **WebMCP leverage** | The Inspector (host, capabilities, 48 schemas, exposed/hidden), adaptive surface growing 25→39 on selection, real annotations enforced in code |
| **Execution** | It's a genuine visual builder, not a demo shell. 609 test files / 10,042 tests, 9 Playwright specs, production build live |
| **Potential impact** | Agent-ready output: manifest + runtime in the published bundle. Plain Next.js — no lock-in |
| **Creativity & ambition** | ChangeSet negotiation, revision staleness, one-step undo of an agent transaction |

---

## 7. If something goes wrong (rehearse this)

| Problem | Do this |
|---|---|
| Panel says **“No WebMCP runtime”** | You're not in ChatGPT's built-in browser, site tools are off, or you're on GPT-5.6 Luna. Recheck §1.1. **Do not claim a connection you don't have.** |
| ChatGPT won't call a tool | Say: *"Use this site's tools."* If still not, fall back to the **WebMCP Test Console** in the panel — but **say out loud** that it's the developer console running the same implementations, labelled `console` in the feed. Never present it as ChatGPT. |
| `update_element` unavailable | Nothing is selected — that's the adaptive surface. Select the element, or ask for a proposal. |
| Proposal shows **stale** unexpectedly | You edited the page after it was made. That *is* the feature — pivot and demo it. |
| Canvas won't load | Hard-reload `/app/`. If it persists, clear `revyme-project-local` and reload. |

**The honesty rule:** if the live agent connection fails, demo the Test Console and say
what it is. A judge who catches you overstating loses trust in everything else; a judge
who hears you distinguish "agent" from "console" trusts the whole submission.

---

## 8. Final 60-second checklist before you hit record

- [ ] ChatGPT desktop updated, **site tools enabled**, model = **Sol or Terra**
- [ ] `https://weave-webmcp.vercel.app/app/` open in ChatGPT's built-in browser
- [ ] Address bar → *Site tools → Available site tools* lists `weave_*`
- [ ] Agent panel chip reads **“WebMCP connected”** (green)
- [ ] Onboarding modal dismissed
- [ ] `localStorage` cleared → EMBER loads focused on the hero
- [ ] Agent panel open, Test Console **collapsed** (so the feed is visible)
- [ ] The five prompts from §3 in a scratch file, ready to paste
- [ ] Screen recorder capturing both ChatGPT and WEAVE

**Your closing line:**

> "A human and an AI agent, authoring the same website — through structured,
> inspectable, reversible WebMCP."
