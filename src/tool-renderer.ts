/**
 * FEATURE 1: the compact tool renderer installed on the process-global bridge
 * `Symbol.for("pi.defaultToolRenderer")` (see patch-pi.sh).
 *
 * Two modes, one renderer:
 * 1. handles(name) === true  → native built-ins. Core overrides RENDERING only;
 *    the native tool definition keeps its schema, execute(), and builtin source
 *    ownership. That ownership is what lets pi-subagents expose read/bash/write
 *    to child runtimes, so this renderer must never register tools itself.
 * 2. rendererless tools (MCP/third-party) → core's call/result fallbacks reach
 *    the same methods and get the generic "toolcall <name>" row.
 */

import type { Component } from "@earendil-works/pi-tui";
import {
  CompactLine,
  EmptyComponent,
  GutteredComponent,
  gutter,
  outputGutter,
  realTimers,
  type ThemeLike,
  type Timers,
} from "./components.ts";
import { colorQuietSummary, isBuiltIn, rowText, statusGlyph, type RenderState } from "./tool-rows.ts";
import { QuietMode } from "./quiet-mode.ts";

/** Original built-in result renderer, handed to us by the core bridge. */
export type NativeResultRenderer = (
  result: any,
  options: any,
  theme: any,
  context: any,
) => Component;

/** The object stored on the process-global renderer symbol. */
export type ToolRenderer = {
  renderShell: "self";
  handles: (name: string) => boolean;
  renderCall: (name: string, args: unknown, theme: any, context: any) => CompactLine;
  renderResult: (
    name: string,
    result: any,
    options: any,
    theme: any,
    context: any,
    nativeRenderer?: NativeResultRenderer,
  ) => Component | undefined;
};

export type RendererDeps = {
  /** Clock for the elapsed timer; injectable so tests need no real sleeping. */
  now?: () => number;
  /** Repaint scheduler for the ticker; injectable for fake-timer tests. */
  timers?: Timers;
  /** Shared /quiet state; injected so existing rows update without a core patch. */
  quiet?: QuietMode;
};

/**
 * Build the renderer. A factory (not a module-level singleton) so tests drive
 * the exact production code path with a deterministic clock and timers.
 */
export function createToolRenderer(deps: RendererDeps = {}): ToolRenderer {
  const now = deps.now ?? Date.now;
  const timers = deps.timers ?? realTimers;
  const quiet = deps.quiet ?? new QuietMode();

  return {
    // One custom line instead of Pi's padded Box shell.
    renderShell: "self",
    handles: isBuiltIn,

    renderCall(name, args, theme: ThemeLike, context) {
      const status = statusGlyph(context, now);
      const state = context.state as RenderState;

      // Reuse the previous component so the TUI updates it in place. Two caches
      // on purpose: core's named-override path passes lastComponent, but its
      // FALLBACK path (rendererless MCP/third-party tools) always passes
      // undefined, so state.callLine is the only stable cache there. Allocating
      // a fresh row on every repaint used to start a NEW ticker each second
      // while leaving the old ones running — an exponential interval leak that
      // froze the UI on long-running MCP calls.
      const cached = context.lastComponent instanceof CompactLine
        ? context.lastComponent
        : state.callLine instanceof CompactLine
          ? state.callLine
          : undefined;
      const component = cached ?? new CompactLine(timers);
      state.callLine = component;

      // Tick while running; stop at a terminal state. context.invalidate()
      // re-runs updateDisplay (recomputing elapsed) then renders — a plain
      // requestRender would only repaint the cached, stale text. Async ticker
      // fires are safe; the documented recursion bug was a SYNCHRONOUS
      // invalidate during render.
      if (status.elapsed !== undefined) component.startTicker(() => context.invalidate());
      else component.stopTicker();

      component.setGutter(gutter(theme));
      // No background while executing — the animated timer already signals
      // activity, and a highlight flashing on each repaint was distracting.
      component.set(rowText(name, args, theme, status, context.expanded === true));

      // All tool calls are recorded so a bash/MCP call cuts an otherwise quiet
      // run. Only successful, collapsed entries in QuietMode's whitelist fold.
      // Core always supplies toolCallId. Skip non-core/test-like callers rather
      // than letting several missing IDs collapse into one accidental group.
      if (context.toolCallId) {
        const id = context.toolCallId;
        // Rendererless third-party names are intentionally one quiet category:
        // their normal label is already "toolcall <name>".
        quiet.observe(id, isBuiltIn(name) ? name : "toolcall", status.glyph === "✓", context.expanded === true);
        component.setQuietText(() => {
          const view = quiet.view(id);
          if (view === "show") return undefined;
          if (view === "hide") return null;
          return `${theme.fg("success", "✓")} ${colorQuietSummary(view.summary, theme)}`;
        });
      }
      return component;
    },

    renderResult(name, result, options, theme: ThemeLike, context, nativeRenderer) {
      // Rendererless third-party tools: undefined tells core to use its own
      // full-text output when expanded.
      if (!isBuiltIn(name)) return options.expanded ? undefined : new EmptyComponent();

      // Native built-ins: collapsed output is hidden (the call row carries the
      // status); expanded output delegates to the ORIGINAL renderer so diffs and
      // syntax highlighting survive, then gets the dim continuation gutter.
      if (!options.expanded || !nativeRenderer) return new EmptyComponent();

      // Built-ins always reach here through the named-override path, which does
      // pass lastComponent, so no state cache is needed for the wrapper itself.
      const state = context.state as RenderState;
      const component = nativeRenderer(result, options, theme, {
        // Replace only lastComponent: the built-in must see ITS component, not
        // our gutter wrapper.
        ...context,
        lastComponent: state.originalResult,
      });
      state.originalResult = component;

      const wrapper = context.lastComponent instanceof GutteredComponent
        ? context.lastComponent
        : new GutteredComponent(component, outputGutter(theme));
      wrapper.setInner(component);
      return wrapper;
    },
  };
}
