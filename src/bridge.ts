/**
 * The boundary between this extension and Pi's core components.
 *
 * Nothing on disk is patched. `core-patch.ts` wraps Pi's real component
 * prototypes at load time and READS the process-global slots below at CALL time,
 * so `/reload` swaps behavior without re-wrapping anything, and an unloaded
 * extension degrades to Pi's native rendering.
 *
 * SINGLE SOURCE OF TRUTH for the symbol names, shared by the wrappers, the state
 * that must survive `/reload`, and the tests.
 */

import { Config } from "./config.ts";
import { RunGrouping } from "./run-grouping.ts";
import { Painter, type ThemeLike } from "./row.ts";
import { createToolRenderer } from "./tool-renderer.ts";
import { createThinkingPreview, singleHueThinkingTheme } from "./thinking.ts";
import type { Timers } from "./components.ts";

export const BRIDGE_SYMBOLS = {
  /** `{ renderShell, handles, renderCall, renderResult }` for every tool row. */
  toolRenderer: "pi.defaultToolRenderer",
  /** `(text, theme, pad, streaming, owner, runIndex) => Component`. */
  thinkingPreview: "pi.thinkingPreview",
  /** `(markdownTheme, theme) => markdownTheme` for expanded thinking. */
  thinkingMarkdownTheme: "pi.thinkingMarkdownTheme",

  /** Live settings, retained across a /reload. */
  config: "pi.minimalist.config",
  /** Run-grouping state, retained across a /reload. */
  grouping: "pi.minimalist.grouping",

  /** Chronology hooks that keep thinking and prose in transcript order. */
  observeThinking: "pi.minimalist.observeThinking",
  observeProse: "pi.minimalist.observeProse",
  /** `undefined` = native prose, `null` = hidden, Row = folded summary. */
  proseView: "pi.minimalist.proseView",
  /** `(toolCallId) => boolean`: omit core's separator before an activity summary. */
  activitySummaryRow: "pi.minimalist.activitySummaryRow",
  /** `(owner) => normal|hidden|summary`: normalize assistant host spacing. */
  activityMessageView: "pi.minimalist.activityMessageView",
  /**
   * Spacer suppression for a fully hidden assistant message.
   *
   * There is deliberately NO tool-row equivalent: a compact row uses
   * `renderShell: "self"`, and core's self-shell branch emits its separator
   * inline and returns ZERO lines when the row renders nothing — spacer
   * included. An earlier `quietSpacer` bridge was compensating for a problem core
   * already handles.
   */
  messageSpacer: "pi.minimalist.messageSpacer",
  /** `() => boolean`: keep a STREAMING thinking block expanded. */
  keepActiveThinkingExpanded: "pi.minimalist.keepActiveThinkingExpanded",
} as const;

type Globals = Record<symbol, unknown>;

function slot(key: keyof typeof BRIDGE_SYMBOLS): symbol {
  return Symbol.for(BRIDGE_SYMBOLS[key]);
}

/**
 * State that must survive `/reload`.
 *
 * Existing transcript rows close over these objects and resolve their appearance
 * at render time, so replacing an instance would strand every row on stale state.
 */
export type SharedState = { config: Config; grouping: RunGrouping };

/** Adopt the previous load's state, or start fresh. */
export function sharedState(settings?: ConstructorParameters<typeof Config>[0]): SharedState {
  const globals = globalThis as Globals;
  const existingConfig = globals[slot("config")];
  const existingGrouping = globals[slot("grouping")];
  if (existingConfig instanceof Config && existingGrouping instanceof RunGrouping) {
    return { config: existingConfig, grouping: existingGrouping };
  }
  const config = new Config(settings);
  return { config, grouping: new RunGrouping(config) };
}

export type InstallOptions = SharedState & {
  /** Injectable repaint scheduler; production uses Node's timers. */
  timers?: Timers;
};

/**
 * Install every bridge.
 *
 * Each `/reload` overwrites these slots with fresh instances. Do NOT clear them
 * from `session_shutdown`: reload ordering can let an old shutdown hook erase the
 * newly installed bridges. Process exit clears globalThis naturally.
 */
export function installBridges({ config, grouping, timers }: InstallOptions): void {
  const globals = globalThis as Globals;

  globals[slot("config")] = config;
  globals[slot("grouping")] = grouping;
  globals[slot("toolRenderer")] = createToolRenderer({ config, grouping, timers });
  globals[slot("thinkingPreview")] = createThinkingPreview({ config, grouping, timers });
  globals[slot("thinkingMarkdownTheme")] = (base: Record<string, unknown>, theme: never) =>
    singleHueThinkingTheme(base, theme, config);

  // Chronology: core walks message content in transcript order, and run folding
  // depends on that order.
  globals[slot("observeThinking")] = (owner: object, runIndex: number, streaming: boolean, hidden: boolean) => {
    grouping.observeThinking(owner, runIndex, !streaming, !hidden);
    return grouping.thinkingId(owner, runIndex);
  };
  globals[slot("observeProse")] = (
    owner: object,
    contentIndex: number,
    signal: Parameters<RunGrouping["observeProse"]>[2],
  ) => grouping.observeProse(owner, contentIndex, signal);
  globals[slot("proseView")] = (id: string, theme: ThemeLike) =>
    grouping.proseView(id, new Painter(theme, config));
  globals[slot("activitySummaryRow")] = (id: string) => grouping.isActivitySummary(id);
  globals[slot("activityMessageView")] = (owner: object) => grouping.activityMessageView(owner);
  globals[slot("messageSpacer")] = (owner: object) => grouping.showsMessageSpacer(owner);

  // A function, not a value: the prototype wrapper reads it on every call, so a
  // toggle takes effect without reinstalling anything.
  globals[slot("keepActiveThinkingExpanded")] = () => config.get("keepActiveThinkingExpanded");
}
