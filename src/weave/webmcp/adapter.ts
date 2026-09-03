// WEAVE addition (not upstream Revyme) — see src/weave/README.md.
//
// adapter.ts — the ONLY file in WEAVE that touches the browser's WebMCP
// surface. Everything else works against the registry; this module decides
// what the running browser actually supports and speaks that dialect.
//
// The current Web Model Context draft puts the API on `document.modelContext`
// with:
//     registerTool(descriptor)   → registration handle / unregister
//     unregisterTool(name)
//     getTools()
//     executeTool(name, args)
//     addEventListener('toolchange', …)
// and passes an options bag carrying an `AbortSignal` into each tool's
// `execute`. Earlier drafts exposed the same object on `navigator` or `window`
// and offered only a replace-everything `provideContext({ tools })`.
//
// We feature-detect all of it. Nothing is assumed, nothing is polyfilled, and
// when no runtime is present `isWebMcpAvailable()` returns false so the UI can
// say so plainly instead of implying an agent could connect.

export interface WebMcpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  /** Structured twin of `content`, for runtimes that read it. */
  structuredContent?: unknown;
  isError?: boolean;
}

/** Options a spec-compliant runtime passes as the 2nd argument to `execute`. */
export interface WebMcpExecuteOptions {
  signal?: AbortSignal;
}

export interface WebMcpToolDescriptor {
  name: string;
  description: string;
  /** JSON Schema for the tool input. */
  inputSchema: Record<string, unknown>;
  /** MCP-style behavioural hints (readOnlyHint / destructiveHint / title). */
  annotations?: Record<string, unknown>;
  execute: (args: unknown, options?: WebMcpExecuteOptions) => Promise<WebMcpToolResult>;
}

interface ModelContextLike extends Partial<EventTarget> {
  registerTool?: (tool: WebMcpToolDescriptor) => unknown;
  unregisterTool?: (name: string) => unknown;
  provideContext?: (context: { tools: WebMcpToolDescriptor[] }) => unknown;
  getTools?: () => unknown;
  executeTool?: (name: string, args?: unknown) => unknown;
}

type ModelContextHost = { modelContext?: ModelContextLike };

/** Where the runtime was found — reported in the inspector, never guessed. */
export type WebMcpHost = 'document' | 'navigator' | 'window' | null;

let detectedHost: WebMcpHost = null;

function getModelContext(): ModelContextLike | null {
  // Order follows the spec's own migration: document first, then the two
  // earlier locations.
  if (typeof document !== 'undefined') {
    const mc = (document as unknown as ModelContextHost).modelContext;
    if (mc) { detectedHost = 'document'; return mc; }
  }
  if (typeof navigator !== 'undefined') {
    const mc = (navigator as unknown as ModelContextHost).modelContext;
    if (mc) { detectedHost = 'navigator'; return mc; }
  }
  if (typeof window !== 'undefined') {
    const mc = (window as unknown as ModelContextHost).modelContext;
    if (mc) { detectedHost = 'window'; return mc; }
  }
  detectedHost = null;
  return null;
}

export function isWebMcpAvailable(): boolean {
  const mc = getModelContext();
  return !!mc && (typeof mc.registerTool === 'function' || typeof mc.provideContext === 'function');
}

/** Which global carries the runtime, or null when there is none. */
export function webMcpHost(): WebMcpHost {
  getModelContext();
  return detectedHost;
}

/** Capability report for the inspector — all feature-detected, never claimed. */
export interface WebMcpCapabilities {
  available: boolean;
  host: WebMcpHost;
  registerTool: boolean;
  unregisterTool: boolean;
  provideContext: boolean;
  getTools: boolean;
  executeTool: boolean;
  events: boolean;
  /** WebMCP is a powerful capability; browsers gate it on a secure context. */
  secureContext: boolean;
}

export function webMcpCapabilities(): WebMcpCapabilities {
  const mc = getModelContext();
  return {
    available: !!mc && (typeof mc.registerTool === 'function' || typeof mc.provideContext === 'function'),
    host: detectedHost,
    registerTool: typeof mc?.registerTool === 'function',
    unregisterTool: typeof mc?.unregisterTool === 'function',
    provideContext: typeof mc?.provideContext === 'function',
    getTools: typeof mc?.getTools === 'function',
    executeTool: typeof mc?.executeTool === 'function',
    events: typeof mc?.addEventListener === 'function',
    secureContext: typeof window !== 'undefined' ? window.isSecureContext !== false : false,
  };
}

// ─── Registration ───────────────────────────────────────────────────────────
//
// `provideContext` replaces the whole tool set, so that fallback path keeps a
// local mirror and re-provides it after every change. `registerTool` runtimes
// need no mirror, but we still track names so a re-registration (the adaptive
// tool surface swaps tools as the selection changes) unregisters first instead
// of stacking duplicates.

const provided = new Map<string, WebMcpToolDescriptor>();

function reprovide(mc: ModelContextLike): void {
  mc.provideContext?.({ tools: [...provided.values()] });
}

/** Remove a tool from the runtime. Safe to call for an unregistered name. */
export function unregisterWebMcpTool(name: string): void {
  const mc = getModelContext();
  if (!mc) return;
  const handle = handles.get(name);
  handles.delete(name);
  const wasProvided = provided.delete(name);
  try {
    if (handle) { handle(); return; }
    if (typeof mc.unregisterTool === 'function') { mc.unregisterTool(name); return; }
    // provideContext runtimes replace the whole set — re-provide without it.
    if (wasProvided && typeof mc.provideContext === 'function') reprovide(mc);
  } catch {
    // A throwing experimental API must never break the editor.
  }
}

/** Per-tool unregister handles returned by `registerTool`, when it returns one. */
const handles = new Map<string, () => void>();

/**
 * Register one tool with the browser's model-context runtime.
 * Idempotent: re-registering a name replaces the previous registration.
 * @returns true when the tool is genuinely reachable by an external agent.
 */
export function registerWebMcpTool(tool: WebMcpToolDescriptor): boolean {
  const mc = getModelContext();
  if (!mc) return false;
  // Duplicate-safe: drop any previous registration for this name first.
  if (handles.has(tool.name) || provided.has(tool.name)) unregisterWebMcpTool(tool.name);
  try {
    if (typeof mc.registerTool === 'function') {
      const handle = mc.registerTool(tool);
      // Spec runtimes may return an unregister function, a registration object
      // with `.unregister()`, or nothing at all.
      if (typeof handle === 'function') {
        handles.set(tool.name, handle as () => void);
      } else if (handle && typeof (handle as { unregister?: unknown }).unregister === 'function') {
        handles.set(tool.name, () => (handle as { unregister: () => void }).unregister());
      }
      provided.set(tool.name, tool);
      return true;
    }
    if (typeof mc.provideContext === 'function') {
      provided.set(tool.name, tool);
      reprovide(mc);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** Names WEAVE currently has registered with the runtime. */
export function registeredToolNames(): string[] {
  return [...provided.keys()];
}

/** Tools the RUNTIME reports, when it exposes `getTools()`. Null otherwise. */
export function runtimeToolNames(): string[] | null {
  const mc = getModelContext();
  if (!mc || typeof mc.getTools !== 'function') return null;
  try {
    const tools = mc.getTools();
    if (!Array.isArray(tools)) return null;
    return tools.map((t: unknown) => String((t as { name?: unknown })?.name ?? '')).filter(Boolean);
  } catch {
    return null;
  }
}

/** Subscribe to the runtime's `toolchange` event, when it emits one. */
export function onToolChange(fn: () => void): () => void {
  const mc = getModelContext();
  if (!mc || typeof mc.addEventListener !== 'function') return () => {};
  const handler = () => fn();
  try {
    (mc as EventTarget).addEventListener('toolchange', handler);
    return () => { try { (mc as EventTarget).removeEventListener('toolchange', handler); } catch { /* detached */ } };
  } catch {
    return () => {};
  }
}
