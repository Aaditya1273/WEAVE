// payload.test.ts — what an agent has to read to understand the EMBER page.
//
// README and FLOW.md quote "≈10× fewer tokens per read". This file is where that
// number comes from. It seeds the REAL store with the EMBER starter, calls
// weave_get_context through the same dispatcher an external agent reaches, and
// compares the size of the answer with the two things an agent would otherwise
// have to read: the page source, and the DOM the canvas iframe renders. The
// ratio is asserted, not just printed, so the claim cannot drift from the code.
//
// Tokens are chars ÷ 4 — the usual rough estimate. The absolute numbers move
// with the starter project; the ratio is the claim.

import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { getDefaultStore } from 'jotai';
import { projectFS, resetProjectFS, projectVersionAtom } from '@/code/project/project-fs';
import { setActiveFilePath, initMutationQueue } from '@/code/mutation/mutation-queue';
import { nodesAtom, selectedIdsAtom } from '@/code/stores/store';
import { activeFilePathAtom } from '@/code/project/active-file-store';
import type { CanvasNode } from '@/code/parsing/parser';

import './tools';
import './tools-advanced';
import { executeWeaveTool, applicableTools } from './webmcp/registry';
import { createWeaveStarterProject, STARTER_HERO_ID } from './starter-project';
import { resetRevisionForTest } from './revision';

const FILE = 'app/page.client.tsx';
const SCREENSHOT = 'docs/proof/editor-1600x950.png';
const store = getDefaultStore();
const bump = () => store.set(projectVersionAtom, (v) => v + 1);

function seedEmber(): void {
  resetProjectFS(createWeaveStarterProject());
  bump();
  store.set(activeFilePathAtom, FILE);
  setActiveFilePath(FILE);
  initMutationQueue(projectFS.readFile(FILE)!, (c) => { projectFS.writeFile(FILE, c); bump(); });
  store.set(selectedIdsAtom, []);
  resetRevisionForTest(1);
}

// The canvas iframe paints every node as one element carrying data-id,
// data-name, its attributes and its full inline style. This emits exactly that
// markup for one breakpoint, which is the *smallest* honest DOM baseline — the
// real canvas renders three breakpoints side by side.
const VOID = new Set(['img', 'br', 'hr', 'input', 'source']);
const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
function renderDom(nodes: Map<string, CanvasNode>, id: string): string {
  const n = nodes.get(id);
  if (!n) return '';
  const style = Object.entries(n.styles).map(([k, v]) => `${kebab(k)}:${v}`).join(';');
  const attrs = Object.entries(n.attrs).map(([k, v]) => ` ${k}="${v}"`).join('');
  const open = `<${n.type} data-id="${n.id}" data-name="${n.name}"${attrs} style="${style}"`;
  if (VOID.has(n.type)) return `${open} />`;
  return `${open}>${n.textContent ?? ''}${n.children.map((c) => renderDom(nodes, c)).join('')}</${n.type}>`;
}

const tokens = (chars: number) => Math.round(chars / 4);
const fmt = (n: number) => n.toLocaleString('en-US');
const row = (label: string, chars: number, base: number) =>
  `  ${label.padEnd(48)}${fmt(chars).padStart(9)} chars${fmt(tokens(chars)).padStart(9)} tok${(chars / base).toFixed(1).padStart(9)}×`;

beforeEach(() => { seedEmber(); });

describe('payload: one "what is on the page" read', () => {
  it('structured context is an order of magnitude smaller than the DOM it describes', async () => {
    const nodes = store.get(nodesAtom);
    expect(nodes.size).toBeGreaterThan(50);

    const result = await executeWeaveTool('weave_get_context', {}, 'agent');
    expect(result.ok).toBe(true);
    const body = JSON.stringify(result);
    // What crosses the wire: the MCP envelope carries the body twice
    // (`content[0].text` and `structuredContent`). Counted, not hidden.
    const envelope = JSON.stringify({ content: [{ type: 'text', text: body }], structuredContent: result });

    const source = projectFS.readFile(FILE)!;
    const one = [...nodes.values()].filter((n) => n.parentId === null).map((n) => renderDom(nodes, n.id)).join('');
    // The canvas paints Desktop, Tablet and Mobile side by side — three copies.
    const dom = one.repeat(3);

    const lines = [
      '',
      `  EMBER — ${nodes.size} nodes, ${(result as { sections?: unknown[] }).sections?.length ?? '?'} sections. One read of the page, four ways.`,
      '',
      `  ${'approach'.padEnd(48)}${'size'.padStart(15)}${'~tokens'.padStart(13)}${'vs WEAVE'.padStart(10)}`,
      `  ${'-'.repeat(86)}`,
      row('WEAVE  weave_get_context  (JSON body)', body.length, body.length),
      row('WEAVE  same call, MCP envelope on the wire', envelope.length, body.length),
      row('Source app/page.client.tsx  (read the file)', source.length, body.length),
      row('DOM    one breakpoint, inline styles', one.length, body.length),
      row('DOM    as the canvas renders it (3 breakpoints)', dom.length, body.length),
    ];
    const shot = resolve(process.cwd(), SCREENSHOT);
    if (existsSync(shot)) {
      const bytes = statSync(shot).size;
      lines.push(`  ${'Screenshot 1600×950 PNG of the editor'.padEnd(48)}${fmt(bytes).padStart(9)} bytes     vision tokens; no element ids to act on`);
    }
    lines.push('', '  tokens ≈ chars ÷ 4. Every id in the WEAVE answer is a real data-id an agent can target directly.', '');
    console.log(lines.join('\n'));

    expect(dom.length / body.length).toBeGreaterThanOrEqual(5);      // the "≈10×" claim, with margin
    expect(one.length / body.length).toBeGreaterThanOrEqual(2);      // holds even for a single breakpoint
    expect(source.length / body.length).toBeGreaterThanOrEqual(2);
    expect(dom.length / envelope.length).toBeGreaterThanOrEqual(2.5); // and after the envelope doubles it
  });

  it('the tool surface is adaptive: it grows only when the human selects something', () => {
    const idle = applicableTools().map((t) => t.name);
    store.set(selectedIdsAtom, [STARTER_HERO_ID]);
    const selected = applicableTools().map((t) => t.name);
    const added = selected.filter((n) => !idle.includes(n));

    console.log([
      '',
      `  nothing selected  → ${idle.length} tools exposed`,
      ...idle.map((n) => `      ${n}`),
      `  hero selected     → ${selected.length} tools exposed  (+${added.length})`,
      ...added.map((n) => `    + ${n}`),
      '',
    ].join('\n'));

    // The surface follows the project AND the cursor, so the exact counts move
    // as capabilities are added. What must hold is the shape: element-scoped
    // tools are hidden until something is selected, and nothing is ever lost
    // by selecting.
    expect(idle.length).toBeGreaterThan(0);
    expect(selected.length).toBeGreaterThan(idle.length);
    for (const name of idle) expect(selected).toContain(name);
    for (const name of ['weave_update_element', 'weave_delete_element', 'weave_get_selection', 'weave_move_element']) {
      expect(idle, `${name} should be hidden with no selection`).not.toContain(name);
      expect(selected, `${name} should appear with a selection`).toContain(name);
    }
  });
});
