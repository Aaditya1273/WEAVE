// WEAVE addition (not upstream Revyme) — see src/weave/README.md.
//
// InspectorOverlay.tsx — the WebMCP Inspector.
//
// A technical surface that reports what is ACTUALLY registered with the
// browser right now: which global carries the runtime, which parts of the API
// it implements, every tool with its schema and annotations, whether it is
// currently exposed (the surface is adaptive) and what its last invocation
// did. Every value is read from the live adapter and registry — nothing here
// is illustrative.
//
// Reachable from the Agent panel, or by opening the editor with `?weave=inspector`.

import { useEffect, useState } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { inspectorOpenAtom, toolSurfaceVersionAtom, weaveContextVersionAtom } from '../store';
import { currentRevision } from '../revision';
import {
  getWeaveTools, applicableTools, getLastInvocation, registeredToolNames,
} from '../webmcp/registry';
import { webMcpCapabilities, runtimeToolNames } from '../webmcp/adapter';

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className="text-[11px] text-[var(--text-secondary)] shrink-0">{label}</span>
      <span className={`text-[11px] text-[var(--text-primary)] text-right break-all ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

function Pill({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider cut-corners"
      style={{
        backgroundColor: ok ? 'color-mix(in srgb, #10B981 16%, transparent)' : 'var(--bg-hover)',
        color: ok ? '#10B981' : 'var(--text-secondary)',
      }}
    >
      <span aria-hidden className="w-1 h-1 rounded-full" style={{ backgroundColor: ok ? '#10B981' : 'var(--text-secondary)' }} />
      {children}
    </span>
  );
}

export default function InspectorOverlay() {
  const [open, setOpen] = useAtom(inspectorOpenAtom);
  const surfaceVersion = useAtomValue(toolSurfaceVersionAtom);
  const contextVersion = useAtomValue(weaveContextVersionAtom);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Deep link: /?weave=inspector opens straight onto this surface.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get('weave') === 'inspector') setOpen(true);
  }, [setOpen]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, setOpen]);

  const caps = webMcpCapabilities();
  const exposed = new Set(applicableTools().map((t) => t.name));
  const registered = new Set(registeredToolNames());
  const runtimeNames = runtimeToolNames();
  const tools = getWeaveTools();
  const hidden = tools.length - exposed.size;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div data-modal-root className="fixed inset-0 flex items-center justify-center" style={{ zIndex: 100010 }}>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }} className="absolute inset-0 bg-black/60"
            onClick={() => setOpen(false)}
          />
          <motion.div
            role="dialog" aria-modal="true" aria-label="WebMCP Inspector"
            initial={{ opacity: 0, scale: 0.97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ type: 'spring', bounce: 0.16, duration: 0.3 }}
            className="relative flex flex-col cut-corners cut-lg border border-[var(--border-light)] bg-[var(--bg-surface)] shadow-2xl"
            style={{ width: 760, maxWidth: 'calc(100vw - 48px)', maxHeight: '84vh' }}
          >
            <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3 border-b border-[var(--border-light)] shrink-0">
              <div>
                <h2 className="text-[16px] font-semibold tracking-tight text-[var(--text-primary)] m-0">WebMCP Inspector</h2>
                <p className="text-[11px] text-[var(--text-secondary)] m-0 mt-1">
                  Live state of this page&rsquo;s Web Model Context integration.
                </p>
              </div>
              <button
                onClick={() => setOpen(false)} aria-label="Close inspector"
                className="w-7 h-7 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] cut-corners transition-colors"
              >×</button>
            </div>

            <div className="overflow-y-auto flex-1 min-h-0 px-5 py-4 grid grid-cols-2 gap-x-8 gap-y-5">
              <section>
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2">Runtime</h3>
                <Row label="WebMCP detected" value={caps.available ? 'yes' : 'no'} />
                <Row label="Host object" value={caps.host ? `${caps.host}.modelContext` : 'none'} mono />
                <Row label="Secure context" value={caps.secureContext ? 'yes' : 'no'} />
                <div className="flex flex-wrap gap-1 mt-2">
                  <Pill ok={caps.registerTool}>registerTool</Pill>
                  <Pill ok={caps.unregisterTool}>unregisterTool</Pill>
                  <Pill ok={caps.getTools}>getTools</Pill>
                  <Pill ok={caps.executeTool}>executeTool</Pill>
                  <Pill ok={caps.provideContext}>provideContext</Pill>
                  <Pill ok={caps.events}>toolchange</Pill>
                </div>
                {!caps.available && (
                  <p className="text-[10px] leading-relaxed text-[var(--text-secondary)] mt-2 m-0">
                    No runtime in this browser, so no external agent can reach these tools. They remain
                    fully functional through the Test Console, which calls the same implementations.
                  </p>
                )}
              </section>

              <section>
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2">Project</h3>
                <Row label="Revision" value={String(currentRevision())} />
                <Row label="Context version" value={String(contextVersion)} />
                <Row label="Tools defined" value={String(tools.length)} />
                <Row label="Exposed right now" value={`${exposed.size}${hidden > 0 ? ` (${hidden} hidden)` : ''}`} />
                <Row label="Registered with runtime" value={caps.available ? String(registered.size) : '0 — no runtime'} />
                {runtimeNames && <Row label="Runtime reports" value={String(runtimeNames.length)} />}
                <Row label="Surface version" value={String(surfaceVersion)} />
                {hidden > 0 && (
                  <p className="text-[10px] leading-relaxed text-[var(--text-secondary)] mt-2 m-0">
                    The surface is adaptive: element-scoped tools are exposed only while the human has a
                    selection, so an agent sees a relevant tool set rather than every capability at once.
                  </p>
                )}
              </section>

              <section className="col-span-2">
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2">Tools</h3>
                <div className="flex flex-col">
                  {tools.map((tool) => {
                    const last = getLastInvocation(tool.name);
                    const isOpen = expanded === tool.name;
                    const live = exposed.has(tool.name);
                    return (
                      <div key={tool.name} className="border-t border-[var(--border-light)] first:border-t-0 py-2">
                        <button
                          onClick={() => setExpanded(isOpen ? null : tool.name)}
                          aria-expanded={isOpen}
                          className="w-full flex items-center justify-between gap-3 text-left"
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <span className="text-[11px] font-mono text-[var(--text-primary)]">{tool.name}</span>
                            <span className="text-[10px] text-[var(--text-secondary)] truncate">{tool.annotations.title}</span>
                          </span>
                          <span className="flex items-center gap-1.5 shrink-0">
                            <span className="text-[9px] font-semibold uppercase tracking-wider"
                              style={{ color: tool.annotations.readOnlyHint ? 'var(--text-secondary)' : tool.annotations.destructiveHint ? '#ef4444' : 'var(--accent)' }}>
                              {tool.annotations.readOnlyHint ? 'read' : tool.annotations.destructiveHint ? 'destructive' : 'write'}
                            </span>
                            {tool.annotations.requiresHumanApproval && (
                              <span className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">gated</span>
                            )}
                            <Pill ok={live}>{live ? 'exposed' : 'hidden'}</Pill>
                          </span>
                        </button>
                        {isOpen && (
                          <div className="mt-2 pl-1 flex flex-col gap-2">
                            <p className="text-[10px] leading-relaxed text-[var(--text-secondary)] m-0">{tool.description}</p>
                            <div>
                              <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Input schema</div>
                              <pre className="px-2 py-1.5 text-[9px] leading-relaxed font-mono cut-corners bg-[var(--bg-hover)] text-[var(--text-secondary)] overflow-x-auto m-0">
                                {JSON.stringify(tool.inputSchema, null, 2)}
                              </pre>
                            </div>
                            <div>
                              <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Annotations</div>
                              <pre className="px-2 py-1.5 text-[9px] leading-relaxed font-mono cut-corners bg-[var(--bg-hover)] text-[var(--text-secondary)] overflow-x-auto m-0">
                                {JSON.stringify(tool.annotations, null, 2)}
                              </pre>
                            </div>
                            <div>
                              <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-1">Last invocation</div>
                              {last ? (
                                <pre className="px-2 py-1.5 text-[9px] leading-relaxed font-mono cut-corners bg-[var(--bg-hover)] text-[var(--text-secondary)] overflow-x-auto max-h-40 m-0">
                                  {JSON.stringify({
                                    at: new Date(last.at).toISOString(),
                                    source: last.source,
                                    durationMs: last.durationMs,
                                    args: last.args,
                                    result: last.result,
                                  }, null, 2)}
                                </pre>
                              ) : (
                                <p className="text-[10px] text-[var(--text-secondary)] m-0">Not called yet in this session.</p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
