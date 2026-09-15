/**
 * The core-bridge boundary: every process-global symbol this extension installs,
 * and the one function that installs them.
 *
 * Nothing on disk is patched. src/core-patch.ts wraps Pi's real component
 * prototypes at load time and READS these slots at call time, so `/reload`
 * swaps behavior without re-wrapping anything.
 *
 * SINGLE SOURCE OF TRUTH for the symbol names, shared by the wrappers and the
 * tests.
 */

import { createToolRenderer } from "./tool-renderer.ts";
import { createThinkingPreview, allPurpleThinkingTheme } from "./thinking.ts";
import { QuietMode } from "./quiet-mode.ts";
import { Config, DEFAULTS } from "./config.ts";

export const BRIDGE_SYMBOLS = {
  /** `{ renderShell, handles, renderCall, renderResult }` for every tool row. */
  toolRenderer: "pi.defaultToolRenderer",
  /** `(text, theme, pad, streaming, owner, runIndex) => Component`. */
  thinkingPreview: "pi.thinkingPreview",
  /** `(markdownTheme, theme) => markdownTheme` for expanded thinking. */
  thinkingMarkdownTheme: "pi.thinkingMarkdownTheme",
  /** Shared run-grouping state, deliberately readable across a /reload. */
  quietMode: "pi.minimalist.quietMode",
  /** Live settings object, also retained across a /reload. */
  config: "pi.minimalist.config",
  /** `() => boolean`: keep a STREAMING thinking block expanded. */
  keepActiveThinkingExpanded: "pi.minimalist.keepActiveThinkingExpanded",
  /** Chronology hooks that keep thinking and prose in transcript order. */
  quietThinking: "pi.minimalist.quietThinking",
  quietProse: "pi.minimalist.quietProse",
  /**
   * Spacer suppression for a fully hidden assistant message.
   *
   * There is deliberately NO tool-row equivalent: a compact tool row uses
   * `renderShell: "self"`, and core's self-shell branch emits its separator
   * inline and returns ZERO lines when the row renders nothing — spacer
   * included. The old `quietSpacer` bridge was compensating for a problem core
   * already handles (see test/core-patch.test.ts, "renders zero lines for a
   * quiet-hidden row, spacer included").
   */
  quietMessageSpacer: "pi.minimalist.quietMessageSpacer",
} as const;

type Globals = Record<symbol, unknown>;

function slot(key: keyof typeof BRIDGE_SYMBOLS): symbol {
  return Symbol.for(BRIDGE_SYMBOLS[key]);
}

/** The QuietMode instance surviving /reload, if a previous load installed one. */
export function sharedQuietMode(): QuietMode | undefined {
  const existing = (globalThis as Globals)[slot("quietMode")];
  return existing instanceof QuietMode ? existing : undefined;
}

/**
 * The Config instance surviving /reload.
 *
 * Reused for the same reason as QuietMode: existing transcript rows close over
 * it and resolve their appearance at render time, so replacing the instance
 * would strand every row on stale settings.
 */
export function sharedConfig(): Config | undefined {
  const existing = (globalThis as Globals)[slot("config")];
  return existing instanceof Config ? existing : undefined;
}

/**
 * Install every bridge. Each /reload overwrites these slots with fresh
 * instances; do NOT clear them from session_shutdown, because reload ordering
 * can let an old shutdown hook erase the newly installed bridges. Process exit
 * clears globalThis naturally.
 *
 * The prototype wrappers in core-patch.ts read these slots on every call, so an
 * unloaded extension degrades to Pi's own native rendering.
 */
export function installBridges(
  quiet: QuietMode,
  timers?: Parameters<typeof createThinkingPreview>[0],
  config: Config = new Config(DEFAULTS),
): void {
  const globals = globalThis as Globals;
  globals[slot("quietMode")] = quiet;
  globals[slot("config")] = config;
  globals[slot("toolRenderer")] = createToolRenderer({ quiet, config });
  globals[slot("thinkingPreview")] = createThinkingPreview(timers, quiet, config);
  globals[slot("thinkingMarkdownTheme")] = allPurpleThinkingTheme;
  // A function, not a value: the prototype wrapper reads it on every call, so a
  // toggle takes effect without reinstalling anything.
  globals[slot("keepActiveThinkingExpanded")] = () => config.get("keepActiveThinkingExpanded");

  globals[slot("quietThinking")] = (owner: object, runIndex: number, streaming: boolean, hidden: boolean) =>
    quiet.observeThinking(owner, runIndex, !streaming, !hidden);
  globals[slot("quietProse")] = (owner: object, contentIndex: number) => quiet.observeProse(owner, contentIndex);
  globals[slot("quietMessageSpacer")] = (owner: object) => quiet.showMessageSpacer(owner);
}
