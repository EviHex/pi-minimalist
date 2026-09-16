/**
 * FEATURE 1: the compact tool renderer.
 *
 * Installed on the process-global bridge `Symbol.for("pi.defaultToolRenderer")`
 * and consulted by the prototype wrappers in `core-patch.ts`.
 *
 * Core overrides RENDERING only. Native tool definitions keep their schema,
 * `execute()`, and builtin source ownership — that ownership is what lets
 * pi-subagents expose read/bash/write to child runtimes, so this renderer must
 * never register tools itself.
 *
 * This module owns everything derived from a render CONTEXT: the status glyph,
 * the elapsed badge, and the per-call cached components.
 */

import type { Component } from "@earendil-works/pi-tui";
import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import { CompactLine, EmptyComponent, GutteredComponent, realTimers, type Timers } from "./components.ts";
import { Painter, type ThemeLike } from "./row.ts";
import { describeTool, isBuiltIn, summaryName } from "./tools.ts";
import { RunGrouping, type Outcome } from "./run-grouping.ts";
import type { Config } from "./config.ts";

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
   * the only stable per-call cache there. Without it every repaint allocated a
   * fresh row and started another ticker while clearing none.
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

/**
 * `color` is a real ThemeColor so a mistyped token fails to COMPILE. At runtime
 * theme.fg() would throw and core would silently fall back to a verbose card.
 */
export type Status = {
  glyph: string;
  color: ThemeColor;
  /** The grouping view of the same state, so nothing re-derives it from glyph. */
  outcome: Outcome;
  /** Seconds since execution started, or undefined when not timing. */
  elapsed?: number;
};

/**
 * Pick the status glyph, color, and outcome for a render context:
 * - finished: done glyph in label color; failed: failed glyph in error color
 * - running:  running glyph, with elapsed seconds
 * - queued:   queued glyph
 *
 * GOTCHA: session replay (restart with history) never calls
 * markExecutionStarted(), so `executionStarted` stays false for reloaded tools.
 * "Finished" must therefore key off `!isPartial` (a final result exists), NOT off
 * `executionStarted`, or every historical tool call shows the queued caret after
 * a restart. `executionStarted` only separates queued from running while live.
 */
export function statusGlyph(context: CallContext, config: Config, now: () => number = Date.now): Status {
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
 * Elapsed badge, or "" when not running or under one second.
 *
 * Hiding the first second avoids a `[⏱ 0s]` flicker on commands that finish
 * instantly; the 1s ticker repaints the row once it becomes meaningful.
 */
export function timerBadge(elapsed: number | undefined, config: Config): string {
  if (elapsed === undefined || elapsed < 1) return "";
  const icon = config.glyphs().timer;
  // The ASCII preset has no clock glyph, so the badge degrades to `[3s]`.
  return icon ? `[${icon} ${elapsed}s]` : `[${elapsed}s]`;
}

/** Original result renderer for this tool, handed to us by the core bridge. */
export type NativeResultRenderer = (result: any, options: any, theme: any, context: any) => Component;

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
  /** Live settings; read at render time so toggles apply to existing history. */
  config: Config;
  /** Shared grouping state; injected so existing rows update without a patch. */
  grouping: RunGrouping;
  /** Clock for the elapsed timer; injectable so tests need no real sleeping. */
  now?: () => number;
  /** Repaint scheduler for the ticker; injectable for fake-timer tests. */
  timers?: Timers;
};

/**
 * Build the renderer.
 *
 * A factory, not a module-level singleton, so tests drive the exact production
 * code path with a deterministic clock and timers.
 */
export function createToolRenderer(deps: RendererDeps): ToolRenderer {
  const { config, grouping } = deps;
  const now = deps.now ?? Date.now;
  const timers = deps.timers ?? realTimers;

  return {
    // One custom line instead of Pi's padded Box shell.
    renderShell: "self",
    // Blacklist plus the master switch: every tool compacts unless excluded.
    handles: (name) => config.compacts(name),

    renderCall(name, args, theme: ThemeLike, context: CallContext & { lastComponent?: unknown; invalidate(): void }) {
      const status = statusGlyph(context, config, now);
      const component = reuseRow(context, timers);

      // Tick while running; stop at a terminal state. invalidate() re-runs
      // updateDisplay (recomputing elapsed) then renders — a plain
      // requestRender would only repaint stale text. Async ticker fires are
      // safe; never invalidate SYNCHRONOUSLY from a renderer.
      if (status.elapsed !== undefined) component.startTicker(() => context.invalidate());
      else component.stopTicker();

      // Painted at render time, because the detail budget depends on the real
      // viewport width and TUI only reveals it during render().
      const paint = (width: number) => {
        const painter = new Painter(theme, config);
        const badge = timerBadge(status.elapsed, config);
        const { label, details } = describeTool(name, args, {
          expanded: context.expanded === true,
          budget: detailBudget(width, status.glyph, name, badge),
          config,
        });
        // No background while executing — the animated timer already signals
        // activity, and a highlight flashing on each repaint was distracting.
        return painter.labeled({ glyph: status.glyph, glyphColor: status.color, label, badge, details });
      };

      // EVERY call is observed, so a non-foldable one still cuts a run. Core
      // always supplies toolCallId; without one, skip grouping rather than let
      // several id-less rows collapse into one accidental group.
      const id = context.toolCallId;
      if (!id) {
        component.setRow(paint);
        return component;
      }
      grouping.observe(id, summaryName(name, args), status.outcome, context.expanded === true);
      component.setRow((width) => grouping.rowFor(id, new Painter(theme, config), () => paint(width)));
      return component;
    },

    renderResult(name, result, options, theme: ThemeLike, context, nativeRenderer) {
      // The call row already carries status, so a collapsed result adds no height.
      if (!options.expanded) return new EmptyComponent();

      // A rendererless third-party tool has no native output to preserve;
      // `undefined` tells core's fallback path to show its own text output.
      if (!nativeRenderer) return isBuiltIn(name) ? new EmptyComponent() : undefined;

      // Expanded rows delegate to the tool's ORIGINAL renderer, preserving diffs,
      // syntax highlighting and MCP result formatting.
      const state = context.state as RenderState;
      const component = nativeRenderer(result, options, theme, {
        // Replace only lastComponent: the native renderer must see ITS component,
        // not our gutter wrapper.
        ...context,
        lastComponent: state.originalResult,
      });
      state.originalResult = component;

      const wrapper =
        context.lastComponent instanceof GutteredComponent
          ? context.lastComponent
          : new GutteredComponent(component, new Painter(theme, config).outputGutter());
      wrapper.setInner(component);
      return wrapper;
    },
  };
}

/**
 * Columns left for the detail text after the fixed parts of the row.
 *
 * Approximate on purpose: `CompactLine` performs the exact, ANSI-aware
 * truncation. This only decides which field yields first in a composed detail.
 */
function detailBudget(width: number, glyph: string, label: string, badge: string): number {
  const gutter = 3;
  const fixed = gutter + glyph.length + 1 + label.length + 1 + (badge ? badge.length + 1 : 0);
  return Math.max(1, width - fixed);
}

/**
 * Reuse the row component across repaints so the TUI updates it in place.
 *
 * Two caches on purpose: core's renderer path passes `lastComponent`, but its
 * FALLBACK path always passes undefined, so `context.state` is the only stable
 * per-call cache there. Allocating a fresh row per repaint used to start another
 * 1s ticker while clearing none — an interval leak that froze the UI.
 */
function reuseRow(context: CallContext & { lastComponent?: unknown }, timers: Timers): CompactLine {
  const cached =
    context.lastComponent instanceof CompactLine
      ? context.lastComponent
      : context.state.callLine instanceof CompactLine
        ? context.state.callLine
        : undefined;
  const component = cached ?? new CompactLine(timers);
  context.state.callLine = component;
  return component;
}
