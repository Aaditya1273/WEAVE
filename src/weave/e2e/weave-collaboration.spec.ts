// weave-collaboration.spec.ts — the human + agent loop, end to end in a browser.
//
// Drives the WHOLE collaboration story against a real editor: the demo project
// renders, a human selection reaches the agent's context, an agent tool mutates
// the same canvas, a multi-operation proposal is reviewed and amended by the
// human before it commits atomically, a proposal that the human out-ran is
// refused as stale, the commit is undoable in one step, validation is real, and
// publishing cannot happen without an explicit human click.
//
// Tool calls go through the in-app WebMCP Test Console, which calls the exact
// implementations an external agent reaches through `document.modelContext` —
// the console is the only way to drive them deterministically in CI, since no
// headless browser ships a WebMCP runtime yet.

import { test, expect, type Page } from '@playwright/test';

type Json = Record<string, any>;

/** Run a WEAVE tool through the developer console and return its result. */
async function runTool(page: Page, tool: string, args: unknown): Promise<Json> {
  const panel = page.locator('[data-editor-panel="left-primary"]');
  await panel.locator('#weave-console-tool').selectOption(tool);
  await panel.locator('#weave-console-args').fill(JSON.stringify(args));
  await panel.getByRole('button', { name: 'Run tool' }).click();
  await expect(panel.locator('pre').last()).toBeVisible();
  // The console renders the result as pretty JSON once the call settles.
  await page.waitForTimeout(900);
  return JSON.parse((await panel.locator('pre').last().textContent()) ?? '{}');
}

/** First node of a given semantic type in a context tree. */
function findByType(node: Json, type: string): Json | null {
  if (node?.type === type) return node;
  for (const child of node?.children ?? []) {
    const hit = findByType(child, type);
    if (hit) return hit;
  }
  return null;
}
function findById(node: Json, id: string): Json | null {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const hit = findById(child, id);
    if (hit) return hit;
  }
  return null;
}

test.describe('WEAVE — human and agent author the same site', () => {
  test.beforeEach(async ({ page }) => {
    // The editor lives at /app/; `/` is the marketing landing page.
    await page.goto('/app/');
    // The canvas iframe rendering the project is the readiness signal.
    await page.waitForSelector('iframe', { timeout: 30_000 });
    await page.waitForTimeout(5_000);
    const dismiss = page.getByText("Don't show again");
    if (await dismiss.isVisible().catch(() => false)) {
      await dismiss.click();
      await page.waitForTimeout(400);
    }
    await page.locator('[data-tutorial="agent-button"]').click();
    await page.getByText('WEAVE Agent').first().waitFor();
    await page.locator('[data-editor-panel="left-primary"]').getByText('WebMCP Test Console').click();
    await page.locator('#weave-console-tool').waitFor();
  });

  test('the agent reads real structured context, not the DOM', async ({ page }) => {
    const ctx = await runTool(page, 'weave_get_context', {});
    expect(ctx.ok).toBe(true);
    // Sections carry SEMANTIC types from the shared vocabulary.
    expect(ctx.sections.map((s: Json) => s.type)).toContain('hero');
    expect(ctx.project.revision).toBeGreaterThanOrEqual(1);
    expect(ctx.capabilities).toContain('weave_propose_changes');
    // Bounded: a snapshot an agent can afford to read, not a page dump.
    expect(JSON.stringify(ctx).length).toBeLessThan(120_000);
  });

  test('a human selection changes what the agent sees', async ({ page }) => {
    const before = await runTool(page, 'weave_get_context', {});
    expect(before.selection.count).toBe(0);

    // Click the canvas — a real human selection.
    await page.mouse.click(760, 320);
    await page.waitForTimeout(900);

    const after = await runTool(page, 'weave_get_context', {});
    expect(after.selection.count).toBeGreaterThan(0);
    // Element-scoped tools appear only once there is something to act on.
    expect(after.capabilities).toContain('weave_update_element');
  });

  test('an agent edit lands in the same canvas the human is looking at', async ({ page }) => {
    const ctx = await runTool(page, 'weave_get_context', {});
    const heading = findByType(ctx.tree[0], 'heading')!;
    expect(heading).toBeTruthy();

    const result = await runTool(page, 'weave_update_element', {
      element_id: heading.id, text: 'Objects for slow rooms',
    });
    expect(result.ok).toBe(true);
    expect(result.revision).toBeGreaterThan(ctx.project.revision);

    const frame = page.frames().find((f) => f.url().includes('5174'))!;
    await expect(frame.locator(`[data-node-id="${heading.id}"]`).first())
      .toContainText('Objects for slow rooms');
  });

  test('an agent restyle actually repaints the canvas', async ({ page }) => {
    // Regression: a human style edit patches the canvas DOM imperatively AND
    // queues the mutation, so the flush gate skips a redundant render. An agent
    // only queues — nothing patched the DOM — and the gate skipped anyway, so
    // the code changed while the canvas kept its old paint. Restyles looked
    // like they did nothing until the next page switch.
    const ctx = await runTool(page, 'weave_get_context', {});
    const section = ctx.sections[1];

    await runTool(page, 'weave_update_element', {
      element_id: section.id, styles: { backgroundColor: 'rgb(11, 11, 13)' },
    });

    const frame = page.frames().find((f) => f.url().includes('5174'))!;
    await expect.poll(
      () => frame.evaluate(
        (id) => {
          const el = document.querySelector(`[data-node-id="${id}"]`);
          return el ? getComputedStyle(el).backgroundColor : null;
        },
        section.id,
      ),
      { timeout: 10_000 },
    ).toBe('rgb(11, 11, 13)');
  });

  test('a multi-operation proposal is reviewed, amended and committed atomically', async ({ page }) => {
    const ctx = await runTool(page, 'weave_get_context', {});
    const heading = findByType(ctx.tree[0], 'heading')!;
    const sectionsBefore = ctx.sections.length;

    const proposal = await runTool(page, 'weave_propose_changes', {
      summary: 'Make the homepage feel more premium',
      operations: [
        { op: 'update_text', target: heading.id, value: 'Quietly made, kept for decades' },
        { op: 'move', target: ctx.sections[ctx.sections.length - 2].id, index: 1 },
        { op: 'add_section', sectionType: 'testimonials' },
      ],
    });
    expect(proposal.ok).toBe(true);
    expect(proposal.status).toBe('awaiting_human_review');

    // NOTHING has changed yet — a proposal is not an edit.
    const during = await runTool(page, 'weave_get_context', {});
    expect(during.sections.length).toBe(sectionsBefore);
    expect(during.pendingChangesets).toHaveLength(1);
    // And it does not seize the canvas.
    await expect(page.locator('[role="dialog"][aria-label*="Agent proposal"]')).toBeHidden();

    const panel = page.locator('[data-editor-panel="left-primary"]');
    await panel.getByRole('button', { name: 'Review proposal' }).click();
    const dialog = page.locator('[role="dialog"][aria-label*="Agent proposal"]');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Make the homepage feel more premium')).toBeVisible();

    // The human rewrites one value and drops another operation entirely.
    const editable = dialog.locator('textarea').first();
    await editable.fill('Made slowly, kept for decades');
    await editable.blur();
    await expect(dialog.getByText('edited by you').first()).toBeVisible();
    await dialog.getByRole('button', { name: 'Skip' }).nth(1).click();

    const apply = dialog.getByRole('button', { name: /^Apply 2 changes$/ });
    await expect(apply).toBeVisible();
    await apply.click();
    await expect(dialog).toBeHidden();
    await page.waitForTimeout(2_000);

    const after = await runTool(page, 'weave_get_context', {});
    // The accepted operations landed…
    expect(after.sections.length).toBe(sectionsBefore + 1);
    expect(findById(after.tree[0], heading.id)?.text).toBe('Made slowly, kept for decades');
    // …and the whole thing is one new revision.
    expect(after.project.revision).toBeGreaterThan(during.project.revision);
  });

  test('a proposal the human out-ran is refused as stale, and their work survives', async ({ page }) => {
    const ctx = await runTool(page, 'weave_get_context', {});
    const heading = findByType(ctx.tree[0], 'heading')!;

    await runTool(page, 'weave_propose_changes', {
      summary: 'Rewrite the hero',
      operations: [{ op: 'update_text', target: heading.id, value: 'Agent headline' }],
    });

    // The human edits the page underneath the open proposal.
    await runTool(page, 'weave_update_element', { element_id: heading.id, text: 'Human headline' });
    await page.waitForTimeout(700);

    const panel = page.locator('[data-editor-panel="left-primary"]');
    await panel.getByRole('button', { name: /Review/ }).first().click();
    const dialog = page.locator('[role="dialog"][aria-label*="Agent proposal"]');
    await expect(dialog.getByText('Stale proposal')).toBeVisible();
    // There is no way to apply it.
    await expect(dialog.getByRole('button', { name: /^Apply/ })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Dismiss' }).click();

    const after = await runTool(page, 'weave_get_context', {});
    expect(findById(after.tree[0], heading.id)?.text).toBe('Human headline');
  });

  test('an agent transaction is undoable in one step', async ({ page }) => {
    const ctx = await runTool(page, 'weave_get_context', {});
    const heading = findByType(ctx.tree[0], 'heading')!;
    const sectionsBefore = ctx.sections.length;

    await runTool(page, 'weave_propose_changes', {
      summary: 'Two edits at once',
      operations: [
        { op: 'update_text', target: heading.id, value: 'Committed by the agent' },
        { op: 'add_section', sectionType: 'cta' },
      ],
    });
    const panel = page.locator('[data-editor-panel="left-primary"]');
    await panel.getByRole('button', { name: 'Review proposal' }).click();
    await page.getByRole('button', { name: /^Apply 2 changes$/ }).click();
    await page.waitForTimeout(2_000);

    const applied = await runTool(page, 'weave_get_context', {});
    expect(applied.sections.length).toBe(sectionsBefore + 1);

    await page.keyboard.press('Control+z');
    await page.waitForTimeout(1_800);
    const undone = await runTool(page, 'weave_get_context', {});
    // ONE undo reverses the WHOLE transaction, not half of it.
    expect(undone.sections.length).toBe(sectionsBefore);
    expect(findById(undone.tree[0], heading.id)?.text).not.toBe('Committed by the agent');
  });

  test('validation is real and the readiness score is explainable', async ({ page }) => {
    const report = await runTool(page, 'weave_validate_site', {});
    expect(report.ok).toBe(true);
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(100);
    // The score is exactly the sum of its published checks.
    const weight = report.checks.reduce((s: number, c: Json) => s + c.weight, 0);
    const earned = report.checks.reduce((s: number, c: Json) => s + c.earned, 0);
    expect(weight).toBe(100);
    expect(earned).toBe(report.score);

    const panel = page.locator('[data-editor-panel="left-primary"]');
    await expect(panel.getByText('Agent readiness')).toBeVisible();
  });

  test('publishing cannot happen without an explicit human click', async ({ page }) => {
    const request = await runTool(page, 'weave_publish_site', { note: 'Ready to ship?' });
    expect(request.ok).toBe(true);
    expect(request.status).toBe('awaiting_human_approval');

    const panel = page.locator('[data-editor-panel="left-primary"]');
    await expect(panel.getByText('Agent requested publish')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Approve & publish' })).toBeVisible();

    // A second request cannot slip past the gate.
    const dup = await runTool(page, 'weave_publish_site', {});
    expect(dup.ok).toBe(false);
    expect(dup.error.code).toBe('PUBLISH_ALREADY_PENDING');

    // The pending request is visible to the agent too.
    const ctx = await runTool(page, 'weave_get_context', {});
    expect(ctx.pendingPublish.status).toBe('awaiting_human_approval');

    await panel.getByRole('button', { name: 'Cancel' }).first().click();
    await expect(panel.getByText('Agent requested publish')).toBeHidden();
  });

  test('the inspector reports the real WebMCP state', async ({ page }) => {
    const panel = page.locator('[data-editor-panel="left-primary"]');
    await panel.getByRole('button', { name: 'Inspect' }).click();
    const inspector = page.locator('[role="dialog"][aria-label="WebMCP Inspector"]');
    await expect(inspector).toBeVisible();
    await expect(inspector.getByText('Host object')).toBeVisible();
    // Every defined tool is listed with its schema.
    await expect(inspector.locator('button[aria-expanded]')).toHaveCount(9);
    await inspector.getByText('weave_propose_changes').first().click();
    await expect(inspector.getByText('Input schema')).toBeVisible();
  });
});
