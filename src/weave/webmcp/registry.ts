// WEAVE addition (not upstream Revyme) — see src/weave/README.md.
//
// registry.ts — the WEAVE tool registry and dispatcher.
//
// One place defines what a tool is (name, schema, annotations, applicability,
// implementation); one dispatcher runs it with validation, cancellation and
// structured errors; one call syncs that set with the browser's WebMCP
// runtime. External agents arrive through the adapter with source 'agent';
// the in-app Test Console calls `executeWeaveTool` directly with source
// 'console'. Both hit the SAME implementations, and the activity feed labels
// which one it was — a local test run is never presented as an agent call.
//
// The surface is ADAPTIVE: tools declare when they are applicable (`appliesWhen`)
// and the registry registers/unregisters against the runtime as editor state
// changes, so an agent sees a concise, relevant tool set rather than every
// capability at all times.

import { getDefaultStore } from 'jotai';
import { trace } from '@/shared/debug-trace';
import { selectedIdsAtom } from '@/code/stores/store';
import { projectFS } from '@/code/project/project-fs';
import { activeFilePathAtom } from '@/code/project/active-file-store';
import { getHistoryState } from '@/code/mutation/history';
import { getI18nConfig } from '@/code/project/locale-ops';
import { listCollections } from '@/code/project/cms-ops';
import { getPageVariables } from '@/code/features/page-variables';
import {
  weaveActivityAtom, makeActivityEntry, appendActivity,
  webMcpStatusAtom, toolSurfaceVersionAtom, type ActivityKind,
} from '../store';
import {
  registerWebMcpTool, unregisterWebMcpTool, isWebMcpAvailable,
  registeredToolNames, type WebMcpToolResult, type WebMcpExecuteOptions,
} from './adapter';

const store = getDefaultStore();

// ─── Result envelope ────────────────────────────────────────────────────────

export interface WeaveToolError {
  ok: false;
  error: { code: string; message: string };
}
export type WeaveToolResult = ({ ok: true } & Record<string, unknown>) | WeaveToolError;

export function toolError(code: string, message: string): WeaveToolError {
  return { ok: false, error: { code, message } };
}

// ─── Tool definition ────────────────────────────────────────────────────────

export interface WeaveToolSchema {
  type: 'object';
  properties: Record<string, {
    type?: string; description?: string; enum?: string[];
    items?: unknown; [k: string]: unknown;
  }>;
  required?: string[];
  additionalProperties?: boolean;
}

/** Editor state the adaptive surface reasons about.
 *
 *  The surface follows the PROJECT, not just the cursor: a single-page site
 *  with no translations and no content collections has no reason to show an
 *  agent the page, locale and collection tools, and a page with no variables
 *  cannot bind one. Keeping the exposed set to what is actually actionable is
 *  the whole point of an adaptive surface — an agent that sees 40 tools on a
 *  one-page site spends its budget reading capabilities it cannot use. */
export interface ToolApplicability {
  hasSelection: boolean;
  selectionCount: number;
  /** The site has somewhere else to go — page and link tools become useful. */
  hasMultiplePages: boolean;
  /** The site is published in more than one language. */
  hasLocales: boolean;
  /** The project defines at least one content collection. */
  hasCollections: boolean;
  /** The project defines at least one reusable component. */
  hasComponents: boolean;
  /** The active page declares at least one variable to bind or drive. */
  hasVariables: boolean;
  /** Something can be undone right now. */
  canUndo: boolean;
  /** Something can be redone right now. */
  canRedo: boolean;
}

export interface WeaveToolAnnotations {
  /** Short human title shown in agent UIs. */
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  /** Calling twice with the same args has the same effect as calling once. */
  idempotentHint?: boolean;
  /** The tool interacts only with this page's own project state. */
  openWorldHint?: boolean;
  /** WEAVE-specific: the human must approve before anything happens. */
  requiresHumanApproval?: boolean;
}

export interface WeaveTool {
  name: string;
  description: string;
  inputSchema: WeaveToolSchema;
  annotations: WeaveToolAnnotations;
  kind: ActivityKind;
  run: (args: Record<string, unknown>, signal?: AbortSignal) => WeaveToolResult | Promise<WeaveToolResult>;
  /** One-line activity summary. */
  summarize: (args: Record<string, unknown>, result: WeaveToolResult) => string;
  /** Element ids this call touched — powers click-to-locate in the activity feed. */
  targets?: (args: Record<string, unknown>, result: WeaveToolResult) => string[] | undefined;
  /** Adaptive surface: when omitted the tool is always exposed. */
  appliesWhen?: (state: ToolApplicability) => boolean;
}

const TOOLS = new Map<string, WeaveTool>();

export function defineWeaveTool(tool: WeaveTool): void {
  TOOLS.set(tool.name, tool);
}

/** Every defined tool, applicable or not. */
export function getWeaveTools(): WeaveTool[] {
  return [...TOOLS.values()];
}

export function getWeaveTool(name: string): WeaveTool | null {
  return TOOLS.get(name) ?? null;
}

// ─── Telemetry (for the inspector) ──────────────────────────────────────────

export interface ToolInvocation {
  at: number;
  source: 'agent' | 'console';
  args: unknown;
  result: WeaveToolResult;
  durationMs: number;
}

const lastInvocation = new Map<string, ToolInvocation>();
export function getLastInvocation(name: string): ToolInvocation | null {
  return lastInvocation.get(name) ?? null;
}

// ─── Validation ─────────────────────────────────────────────────────────────
// Required-key presence plus primitive type/enum checks against the declared
// schema. Per-tool semantic validation lives in each tool's `run`, and every
// mutation is validated a third time by the command layer — an agent cannot
// reach the project without passing all three.

const JS_TYPE: Record<string, (v: unknown) => boolean> = {
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  boolean: (v) => typeof v === 'boolean',
  object: (v) => typeof v === 'object' && v !== null && !Array.isArray(v),
  array: (v) => Array.isArray(v),
};

function validateArgs(schema: WeaveToolSchema, args: Record<string, unknown>): string | null {
  for (const key of schema.required ?? []) {
    if (args[key] === undefined || args[key] === null) return `Missing required argument "${key}".`;
  }
  for (const [key, value] of Object.entries(args)) {
    const prop = schema.properties[key];
    if (!prop) {
      if (schema.additionalProperties === false) {
        return `Unknown argument "${key}". Accepted: ${Object.keys(schema.properties).join(', ') || '(none)'}.`;
      }
      continue;
    }
    if (value === undefined || value === null) continue;
    if (prop.type && JS_TYPE[prop.type] && !JS_TYPE[prop.type](value)) {
      return `Argument "${key}" must be of type ${prop.type}.`;
    }
    if (prop.enum && typeof value === 'string' && !prop.enum.includes(value)) {
      return `Argument "${key}" must be one of: ${prop.enum.join(', ')}.`;
    }
  }
  return null;
}

// ─── Dispatch ───────────────────────────────────────────────────────────────

function logActivity(
  tool: string, summary: string, ok: boolean,
  source: 'agent' | 'console' | 'human',
  extra: Parameters<typeof makeActivityEntry>[4] = {},
): void {
  store.set(weaveActivityAtom, appendActivity(
    store.get(weaveActivityAtom),
    makeActivityEntry(tool, summary, ok, source, extra),
  ));
}

/** Record a human action (approval, amendment) in the same timeline. */
export function logHumanActivity(tool: string, summary: string, extra: Parameters<typeof makeActivityEntry>[4] = {}): void {
  logActivity(tool, summary, true, 'human', { kind: 'approval', ...extra });
}

/**
 * Run one WEAVE tool. Never throws — every failure becomes a structured
 * `{ ok:false, error:{ code, message } }` an agent can act on.
 *
 * `signal` is honoured where a runtime supplies one: an already-aborted call
 * is refused before it touches project state, which is the only point at which
 * cancellation is meaningful for these tools (each is a short, atomic action —
 * there is no long-running work to interrupt halfway, and aborting mid-write
 * would be strictly worse than completing).
 */
export async function executeWeaveTool(
  name: string,
  args: unknown,
  source: 'agent' | 'console',
  signal?: AbortSignal,
): Promise<WeaveToolResult> {
  const started = Date.now();
  trace.action('weave:tool-call', { name, source });

  const tool = TOOLS.get(name);
  if (!tool) {
    const result = toolError('UNKNOWN_TOOL', `Unknown tool "${name}". Available: ${[...TOOLS.keys()].join(', ')}.`);
    logActivity(name, result.error.message, false, source);
    return result;
  }

  if (signal?.aborted) {
    const result = toolError('CANCELLED', 'The caller cancelled this request before it ran.');
    logActivity(name, result.error.message, false, source, { kind: tool.kind });
    return result;
  }

  if (args !== undefined && args !== null && (typeof args !== 'object' || Array.isArray(args))) {
    const result = toolError('INVALID_ARGS', 'Tool arguments must be a JSON object.');
    logActivity(name, result.error.message, false, source, { kind: tool.kind });
    return result;
  }
  const argObj = (args ?? {}) as Record<string, unknown>;

  const invalid = validateArgs(tool.inputSchema, argObj);
  if (invalid) {
    const result = toolError('INVALID_ARGS', invalid);
    logActivity(name, invalid, false, source, { kind: tool.kind });
    return result;
  }

  let result: WeaveToolResult;
  try {
    result = await tool.run(argObj, signal);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    result = toolError('INTERNAL_ERROR', message);
  }

  const durationMs = Date.now() - started;
  lastInvocation.set(name, { at: started, source, args: argObj, result, durationMs });

  const summary = result.ok ? tool.summarize(argObj, result) : result.error.message;
  logActivity(name, summary, result.ok, source, {
    kind: tool.kind,
    targets: tool.targets?.(argObj, result),
    revision: typeof (result as Record<string, unknown>).revision === 'number'
      ? ((result as Record<string, unknown>).revision as number) : undefined,
    durationMs,
  });
  trace.action('weave:tool-result', { name, ok: result.ok, durationMs });
  return result;
}

// ─── WebMCP registration + adaptive surface ─────────────────────────────────

function toMcpResult(result: WeaveToolResult): WebMcpToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    structuredContent: result,
    ...(result.ok ? {} : { isError: true }),
  };
}

function applicability(): ToolApplicability {
  const selection = store.get(selectedIdsAtom);
  // Each probe is defensive: the surface is recomputed on every selection
  // change, and a throwing probe would take the whole tool set down with it.
  const safe = <T>(fn: () => T, fallback: T): T => {
    try { return fn(); } catch { return fallback; }
  };
  const files = safe(() => projectFS.listFiles(), [] as string[]);
  const history = safe(() => getHistoryState(), { canUndo: false, canRedo: false, undoSize: 0, redoSize: 0 });
  const activeCode = safe(() => projectFS.readFile(store.get(activeFilePathAtom)) ?? '', '');
  return {
    hasSelection: selection.length > 0,
    selectionCount: selection.length,
    hasMultiplePages: files.filter((f) => f.endsWith('page.client.tsx')).length > 1,
    hasLocales: safe(() => getI18nConfig().locales.length > 1, false),
    hasCollections: safe(() => listCollections().length > 0, false),
    hasComponents: files.some((f) => f.startsWith('components/') && f.endsWith('.tsx')),
    hasVariables: safe(() => getPageVariables(activeCode).length > 0, false),
    canUndo: history.canUndo,
    canRedo: history.canRedo,
  };
}

/**
 * The tools that are RELEVANT to the current editor state.
 *
 * This drives the Agent panel's "available now" list and the readiness score.
 * It is deliberately NOT what gets registered with the runtime — see
 * `registrableTools`. An agent must be able to DISCOVER the whole surface on
 * page load (a headless visitor never makes a selection, and a capability it
 * cannot see is a capability it will never use); what changes with editor
 * state is which tools are immediately meaningful, not which exist.
 */
export function applicableTools(state: ToolApplicability = applicability()): WeaveTool[] {
  return getWeaveTools().filter((t) => (t.appliesWhen ? t.appliesWhen(state) : true));
}

/**
 * Every tool, ordered so the ones relevant right now come first.
 *
 * The full surface is always registered: discovery is not gated on the human
 * having clicked something. Tools that need a selection say so in their
 * description and return a precise `NO_TARGET` telling the agent how to
 * proceed (pass `element_id`, or call `weave_find_elements`), which is far
 * more useful to a model than the tool silently not existing.
 */
export function registrableTools(state: ToolApplicability = applicability()): WeaveTool[] {
  const relevant = new Set(applicableTools(state).map((t) => t.name));
  const all = getWeaveTools();
  return [...all.filter((t) => relevant.has(t.name)), ...all.filter((t) => !relevant.has(t.name))];
}

let started = false;

/**
 * Bring the runtime's tool set in line with what is applicable right now.
 * Registers newly-applicable tools, unregisters ones that no longer apply, and
 * leaves the rest untouched so the surface does not churn on every keystroke.
 */
export function syncToolSurface(): void {
  if (!isWebMcpAvailable()) {
    store.set(webMcpStatusAtom, 'unavailable');
    return;
  }
  const want = new Set(registrableTools().map((t) => t.name));
  const have = new Set(registeredToolNames());
  let changed = false;

  for (const name of have) {
    if (!want.has(name)) { unregisterWebMcpTool(name); changed = true; }
  }
  let allOk = true;
  for (const tool of registrableTools()) {
    if (have.has(tool.name)) continue;
    const ok = registerWebMcpTool({
      name: tool.name,
      description: tool.description,
      inputSchema: { ...tool.inputSchema },
      annotations: { ...tool.annotations },
      execute: async (args: unknown, options?: WebMcpExecuteOptions) =>
        toMcpResult(await executeWeaveTool(tool.name, args, 'agent', options?.signal)),
    });
    if (!ok) allOk = false;
    changed = true;
  }

  store.set(webMcpStatusAtom, allOk ? 'native' : 'unavailable');
  if (changed) {
    store.set(toolSurfaceVersionAtom, (v) => v + 1);
    trace.action('weave:tool-surface', { registered: registeredToolNames().length });
  }
}

/** Register the tool surface and keep it in sync with the selection. */
export function startToolSurface(): void {
  if (started) return;
  started = true;
  syncToolSurface();
  // The adaptive surface follows the human's selection: with nothing selected
  // an agent sees the page-level tools; with an element selected the
  // element-scoped tools appear.
  store.sub(selectedIdsAtom, () => syncToolSurface());
}

/** Names WEAVE currently has registered with the runtime. */
export { registeredToolNames };
