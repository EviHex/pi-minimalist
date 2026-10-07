/**
 * The boundary between this extension and Pi's core components.
 *
 * Nothing on disk is patched. `core-patch.ts` wraps Pi's real component
 * prototypes at load time and READS ONE process-global object, the `Bridge`
 * below, at CALL time. Every install replaces that object as a whole, so
 * `/reload` swaps behavior without re-wrapping anything, and an unloaded
 * extension (no object) degrades to Pi's native rendering.
 *
 * SINGLE SOURCE OF TRUTH for the global key names, shared by the wrappers, the
 * state that must survive `/reload`, and the tests.
 */

import { Config } from "./config.ts";
import { RunGrouping } from "./run-grouping.ts";
import { Painter, type Row, type ThemeLike } from "./row.ts";
import { createToolRenderer, type ToolRenderer } from "./tool-renderer.ts";
import { createThinkingPreview, singleHueThinkingTheme, type ThinkingPreview } from "./thinking.ts";
import type { Timers } from "./components.ts";

export const BRIDGE_SYMBOLS = {
  /** The `Bridge` object: everything the prototype wrappers call. */
  bridge: "pi.minimalist.bridge",
  /** Live settings, retained across a /reload. */
  config: "pi.minimalist.config",
  /** Run-grouping state, retained across a /reload. */
  grouping: "pi.minimalist.grouping",
} as const;

/**
 * What the prototype wrappers may call. Functions, not values: the wrappers read
 * the object on every call, so a settings toggle takes effect without
 * reinstalling anything.
 */
export type Bridge = {
  /** `{ renderShell, handles, renderCall, renderResult }` for every tool row. */
  toolRenderer: ToolRenderer;
  thinkingPreview: ThinkingPreview;
  /** Expanded thinking: the Markdown theme with every token in the thinking hue. */
  thinkingMarkdownTheme: (base: Record<string, unknown>, theme: ThemeLike) => Record<string, unknown>;
  /** `thinkingAsToolCall`: do collapsed/expanded thinking rows belong to us? */
  compactThinking: () => boolean;
  /** Keep a STREAMING thinking block expanded. */
  keepActiveThinkingExpanded: () => boolean;

  /** Chronology hooks that keep thinking and prose in transcript order. */
  observeThinking: (owner: object, runIndex: number, streaming: boolean, hidden: boolean, timestamp?: number) => string;
  observeProse: RunGrouping["observeProse"];
  /** A visible row we do not fold (user message, excluded tool); it cuts runs. */
  observeBarrier: (id: string) => void;
  /** `undefined` = native prose, `null` = hidden, Row = folded summary. */
  proseView: (id: string, theme: ThemeLike) => Row | null | undefined;
  /** Header of an opened run, drawn by a prose/native-thinking host. */
  proseHeader: (id: string, theme: ThemeLike) => Row | undefined;
  /** A click on a summary or header; true when handled. */
  click: (id: string, onHeader: boolean) => boolean;
  /** Omit core's separator before an activity summary. */
  activitySummaryRow: (id: string) => boolean;
  /** Normalize assistant host spacing. */
  activityMessageView: (owner: object) => "normal" | "hidden" | "summary";
  /**
   * Spacer suppression for a fully hidden assistant message.
   *
   * There is deliberately NO tool-row equivalent: a compact row uses
   * `renderShell: "self"`, and core's self-shell branch emits its separator
   * inline and returns ZERO lines when the row renders nothing — spacer
   * included.
   */
  messageSpacer: (owner: object) => boolean;
};

type Globals = Record<symbol, unknown>;

function slot(key: keyof typeof BRIDGE_SYMBOLS): symbol {
  return Symbol.for(BRIDGE_SYMBOLS[key]);
}

/** The installed bridge, or `undefined` when the extension is not loaded. */
export function readBridge(): Bridge | undefined {
  return (globalThis as Globals)[slot("bridge")] as Bridge | undefined;
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
 * Install the bridge.
 *
 * Each `/reload` overwrites the slots with fresh instances. Do NOT clear them
 * from `session_shutdown`: reload ordering can let an old shutdown hook erase the
 * newly installed bridge. Process exit clears globalThis naturally.
 */
export function installBridges({ config, grouping, timers }: InstallOptions): void {
  const globals = globalThis as Globals;
  const painter = (theme: ThemeLike) => new Painter(theme, config);

  const bridge: Bridge = {
    toolRenderer: createToolRenderer({ config, grouping, timers }),
    thinkingPreview: createThinkingPreview({ config, grouping, timers }),
    thinkingMarkdownTheme: (base, theme) => singleHueThinkingTheme(base, theme, config),
    compactThinking: () => config.get("thinkingAsToolCall") === true,
    keepActiveThinkingExpanded: () => config.get("keepActiveThinkingExpanded"),

    // Chronology: core walks message content in transcript order, and run
    // folding depends on that order.
    observeThinking: (owner, runIndex, streaming, hidden, timestamp) => {
      grouping.observeThinking(owner, runIndex, !streaming, !hidden, timestamp);
      return grouping.thinkingId(owner, runIndex);
    },
    observeProse: (owner, contentIndex, signal) => grouping.observeProse(owner, contentIndex, signal),
    observeBarrier: (id) => grouping.observeBarrier(id),
    proseView: (id, theme) => grouping.proseView(id, painter(theme)),
    proseHeader: (id, theme) => grouping.headerFor(id, painter(theme)),
    click: (id, onHeader) => grouping.click(id, onHeader),
    activitySummaryRow: (id) => grouping.isActivitySummary(id),
    activityMessageView: (owner) => grouping.activityMessageView(owner),
    messageSpacer: (owner) => grouping.showsMessageSpacer(owner),
  };

  globals[slot("config")] = config;
  globals[slot("grouping")] = grouping;
  globals[slot("bridge")] = bridge;
}
