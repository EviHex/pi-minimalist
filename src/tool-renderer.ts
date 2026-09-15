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
 *    the same methods and get a compact row labeled with the registered name.
 *
 * This module also owns everything derived from a render CONTEXT: the status
 * glyph, the elapsed badge, and the per-call cached components.
 */

import type { Component } from "@earendil-works/pi-tui";
import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import {
  CompactLine,
  EmptyComponent,
  GutteredComponent,
  realTimers,
  type Timers,
} from "./components.ts";
import { labeledRow, outputGutter, type ThemeLike } from "./row.ts";
import { describeTool, isBuiltIn, isCompactTool, quietToolName } from "./tools.ts";
import { QuietMode, type QuietOutcome } from "./quiet-mode.ts";
import { Config, DEFAULTS } from "./config.ts";

/**
 * State shared between renderCall and renderResult through `context.state`
 * (core's rendererState: one object per tool call, stable across renders).
 */
export type RenderState = {
  /**
   * Component produced by the ORIGINAL built-in renderResult, so consecutive
   * expanded re-renders reuse one instance (built-ins inspect lastComponent).
   */
  originalResult?: unknown;
  /**
   * Cached call row. Core's fallback path never passes lastComponent, so this is
   * the only stable per-call cache there. See AGENTS.md, "Core's fallback path
   * never passes lastComponent" — without it every repaint leaked a ticker.
   */
  callLine?: unknown;
  /** Wall-clock timestamp (ms) of the first render after execution started. */
  startedAt?: number;
};

/** The render context fields this module reads. Pi's real context has more. */
export type CallContext = {
  toolCallId?: string;
  state: RenderState;
  isPartial?: boolean;
  isError?: boolean;
  executionStarted?: boolean;
  expanded?: boolean;
};

// color is a real ThemeColor so a mistyped token fails to compile: at runtime
// theme.fg() would throw and core would silently fall back to a verbose card.
export type Status = {
  glyph: string;
  color: ThemeColor;
  /** Quiet mode's view of the same state, so nothing re-derives it from glyph. */
  outcome: QuietOutcome;
  elapsed?: number;
};

/**
 * Pick the status glyph, color, and outcome for a render context:
 * - finished: ✓ label color; failed: ✗ error color
 * - running:  • label color, with elapsed seconds
 * - queued:   › label color
 *
 * GOTCHA: session replay (restart with history) never calls
 * markExecutionStarted(), so executionStarted stays false for reloaded tools.
 * "Finished" must therefore key off !isPartial (a final result exists), NOT off
 * executionStarted, or every historical tool call shows the queued caret after
 * a restart. executionStarted only separates queued from running while live.
 */
export function statusGlyph(
  context: CallContext,
  now: () => number = Date.now,
  config: Config = new Config(DEFAULTS),
): Status {
  const glyphs = config.glyphs();
  const { label, error } = config.tokens();
  if (!context.isPartial) {
    // Final result present: covers both live completion and replayed history.
    return context.isError
      ? { glyph: glyphs.failed, color: error, outcome: "failure" }
      : { glyph: glyphs.done, color: label, outcome: "success" };
  }
  if (context.executionStarted) {
    const state = context.state;
    state.startedAt ??= now();
    return {
      glyph: glyphs.running,
      color: label,
      outcome: "pending",
      // Omitted entirely when the timer is off, so no ticker is ever started.
      elapsed: config.get("timer") ? Math.floor((now() - state.startedAt) / 1000) : undefined,
    };
  }
  return { glyph: glyphs.queued, color: label, outcome: "pending" };
}

/**
 * Elapsed-timer badge, or "" when not running or under one second. Hiding the
 * first second avoids a `[⏱ 0s]` flicker on commands that finish instantly; the
 * 1s ticker repaints the row once it becomes meaningful.
 */
export function timerBadge(elapsed: number | undefined, config: Config = new Config(DEFAULTS)): string {
  if (elapsed === undefined || elapsed < 1) return "";
  const icon = config.glyphs().timer;
  // The ASCII preset has no clock glyph, so the badge degrades to `[3s]`.
  return icon ? `[${icon} ${elapsed}s]` : `[${elapsed}s]`;
}

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
  /** Shared run-grouping state; injected so existing rows update without a patch. */
  quiet?: QuietMode;
  /** Live settings; read at render time so toggles apply to existing history. */
  config?: Config;
};

/**
 * Build the renderer. A factory (not a module-level singleton) so tests drive
 * the exact production code path with a deterministic clock and timers.
 */
export function createToolRenderer(deps: RendererDeps = {}): ToolRenderer {
  const now = deps.now ?? Date.now;
  const timers = deps.timers ?? realTimers;
  const config = deps.config ?? new Config(DEFAULTS);
  const quiet = deps.quiet ?? new QuietMode(config);

  return {
    // One custom line instead of Pi's padded Box shell.
    renderShell: "self",
    // Blacklist: every tool compacts unless excluded, and the master switch
    // turns the whole feature off without unloading the extension.
    handles: (name) => config.get("compactToolRows") && isCompactTool(name, config),

    renderCall(name, args, theme: ThemeLike, context: CallContext & { lastComponent?: unknown; invalidate(): void }) {
      const status = statusGlyph(context, now, config);
      const state = context.state;

      // Reuse the previous component so the TUI updates it in place. Two caches
      // on purpose: core's named-override path passes lastComponent, but its
      // fallback path always passes undefined (see AGENTS.md). Allocating a
      // fresh row per repaint used to start a new ticker each second while
      // clearing none — an interval leak that froze the UI.
      const cached = context.lastComponent instanceof CompactLine
        ? context.lastComponent
        : state.callLine instanceof CompactLine
          ? state.callLine
          : undefined;
      const component = cached ?? new CompactLine(timers);
      state.callLine = component;

      // Tick while running; stop at a terminal state. invalidate() re-runs
      // updateDisplay (recomputing elapsed) then renders — a plain
      // requestRender would only repaint stale text. Async ticker fires are
      // safe; never invalidate SYNCHRONOUSLY from a renderer (see AGENTS.md).
      if (status.elapsed !== undefined) component.startTicker(() => context.invalidate());
      else component.stopTicker();

      const expanded = context.expanded === true;
      // No background while executing — the animated timer already signals
      // activity, and a highlight flashing on each repaint was distracting.
      //
      // `width` arrives from render(), so the detail budget follows the real
      // viewport instead of a fixed character count.
      const base = (width: number) => {
        const badge = timerBadge(status.elapsed, config);
        // Columns the fixed parts consume: gutter, glyph, label, badge, spaces.
        const overhead = 3 + status.glyph.length + 1 + name.length + 1 + (badge ? badge.length + 1 : 0);
        const { label, details } = describeTool(name, args, {
          expanded,
          budget: Math.max(1, width - overhead),
          config,
        });
        return labeledRow(theme, {
          glyph: status.glyph,
          glyphColor: status.color,
          label,
          badge,
          details,
        }, config);
      };

      // All tool calls are recorded so a bash/MCP call cuts an otherwise quiet
      // run. Only successful, collapsed, whitelisted entries fold. Core always
      // supplies toolCallId; skip non-core/test callers rather than letting
      // several missing IDs collapse into one accidental group.
      const id = context.toolCallId;
      if (!id) {
        component.setRow(base);
        return component;
      }
      quiet.observe(id, quietToolName(name, args), status.outcome, expanded);
      component.setRow((width) => quiet.rowFor(id, theme, () => base(width)));
      return component;
    },

    renderResult(name, result, options, theme: ThemeLike, context, nativeRenderer) {
      // The call row carries collapsed status; results add no height.
      if (!options.expanded) return new EmptyComponent();

      // Rendererless third-party tools have no native renderer to preserve.
      // undefined tells core's fallback path to show its full text output.
      if (!nativeRenderer) return isBuiltIn(name) ? new EmptyComponent() : undefined;

      // Expanded built-ins and MCP tools delegate to their ORIGINAL renderer,
      // preserving diffs, syntax highlighting, and MCP result formatting.
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
        : new GutteredComponent(component, outputGutter(theme, config));
      wrapper.setInner(component);
      return wrapper;
    },
  };
}
