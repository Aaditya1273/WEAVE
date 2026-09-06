# WEAVE — high-impact demo prompts

Six prompts that produce **large, visually obvious changes** rather than a single
text edit. Every one was run end to end against this build: the operation counts,
section counts and revision numbers below are measured, not estimated.

They all funnel through `weave_propose_changes`, so each lands as **one proposal,
one atomic commit, one revision, one undo** — which is the point worth showing.

> **Setup:** ChatGPT desktop → Settings → Browser → Permissions → *Enable site
> tools*; model **GPT-5.6 Sol or Terra** (Luna has WebMCP disabled). Open the
> editor in ChatGPT's built-in browser. See `FLOW.md` for the full checklist.

---

## The hard limits (so nothing fails live)

| Constraint | Value |
|---|---|
| Operations per proposal | **25 max** |
| Section types | `header hero features products testimonials pricing faq cta contact footer` |
| Editable styles | colour, background, typography, spacing, sizing, border, radius, shadow, opacity, flex/grid — **not** `position` |
| `href` | only on real link elements, never a `<div>` |
| Element tools | appear **only when something is selected** — with nothing selected the agent must use `weave_propose_changes` |
| Tool surface | **48 defined**; 25 exposed with nothing selected, 39 with an element selected, the rest gated on capabilities the project has yet to use |

**One rule that matters:** a proposal cannot add a section *and then* edit inside
it — the new element ids do not exist until the proposal is applied. Add first,
then ask for a second pass.

---

## 1 — Restructure the whole page

> Measured: **5 operations**, 7 → 9 sections, one revision.

```
Restructure this homepage into a proper conversion funnel: hero, then social
proof, then products, then pricing, then FAQ, then a closing call to action,
then the footer. Add whatever is missing and reorder what's already there.
Give it to me as one proposal.
```

**Why it lands:** the page visibly reorders *and* grows in a single commit. Point
at the section count in Shared Context going 7 → 9, and at the canvas reflowing.

---

## 2 — Rewrite every line on the page

> Measured: **18 operations**, one revision.

```
Reposition this entire site from a ceramics studio to a specialty coffee
roastery. Rewrite every headline, every paragraph and every button label on the
page — not just the hero. One proposal.
```

**Why it lands:** eighteen before/after rows in the review overlay. Scroll the
proposal list on camera — that alone communicates "this is a transaction, not a
tool call". Amend one line so the *edited by you* badge appears.

---

## 3 — Flip the entire palette to dark

> Measured: **21 operations**, one revision, canvas repaints in under a second.

```
Convert this whole page to a dark editorial palette — dark backgrounds across
every section and the page itself, light type on top. Keep it readable. Do it in
one proposal.
```

**Why it lands:** the most dramatic single moment in the demo. The whole canvas
inverts at once when you hit Apply.

> Tell it *"and the page itself"* — the page root carries its own background, and
> recolouring only the sections leaves a light margin behind.

---

## 4 — Delete a section and replace it

> Measured: **4 operations**, 7 → 8 sections, one revision.

```
The features section isn't pulling its weight. Remove it, put a pricing table
and a testimonials block in its place, and move the call to action up to right
after the hero.
```

**Why it lands:** shows a **destructive** operation inside a reviewable
transaction. Point at the red `delete` badge in the proposal, then at Skip —
you can refuse just the deletion and keep the rest.

---

## 5 — Overhaul the typography system

> Measured: **16 operations**, one revision.

```
Tighten the typography across the whole page: bigger, tighter headlines with
negative letter-spacing, and more generous line-height on body copy. Apply it
consistently to every section in one proposal.
```

**Why it lands:** a systemic design change no one would do by hand element by
element. Good follow-up to #3 — palette then type, two commits, two revisions.

---

## 6 — Find problems, then fix them

```
Check whether this site is ready for agents to use. Then fix everything you can
in a single proposal, and tell me what only a human can fix.
```

**Why it lands:** closes the loop — `weave_validate_site` produces a real score
and findings, the agent proposes fixes, you apply, and the score moves. It also
shows the honest boundary: link destinations need a Next.js `<Link>`, which is a
human action, and a good answer will say so.

---

## Running them well

**Order for a 3-minute demo:** 1 → 3 → (undo) → 4. Restructure, invert, undo the
inversion to show one-step reversal, then the destructive review.

**If ChatGPT edits one element at a time** instead of proposing, say:

```
Bundle all of that into a single proposal I can review, not separate edits.
```

That recovery is itself a good beat — it shows the transaction is the intended path.

**To demo staleness:** ask for any proposal above, then edit the page yourself
before approving. The proposal is refused as stale and your edit survives.

**Between takes:** DevTools → Application → Local Storage → delete
`revyme-project-local`, reload. You get the EMBER starter back.
