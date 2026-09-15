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

export const BRIDGE_SYMBOLS = {
  /** `{ renderShell, handles, renderCall, renderResult }` for every tool row. */
  toolRenderer: "pi.defaultToolRenderer",
  /** `(text, theme, pad, streaming, owner, runIndex) => Component`. */
  thinkingPreview: "pi.thinkingPreview",
  /** `(markdownTheme, theme) => markdownTheme` for expanded thinking. */
  thinkingMarkdownTheme: "pi.thinkingMarkdownTheme",
  /** Shared `/quiet` state, deliberately readable across a /reload. */
  quietMode: "pi.minimalist.quietMode",
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
 * Install every bridge. Each /reload overwrites these slots with fresh
 * instances; do NOT clear them from session_shutdown, because reload ordering
 * can let an old shutdown hook erase the newly installed bridges. Process exit
 * clears globalThis naturally.
 *
 * The prototype wrappers in core-patch.ts read these slots on every call, so an
 * unloaded extension degrades to Pi's own native rendering.
 */
export function installBridges(quiet: QuietMode, timers?: Parameters<typeof createThinkingPreview>[0]): void {
  const globals = globalThis as Globals;
  globals[slot("quietMode")] = quiet;
  globals[slot("toolRenderer")] = createToolRenderer({ quiet });
  globals[slot("thinkingPreview")] = createThinkingPreview(timers, quiet);
  globals[slot("thinkingMarkdownTheme")] = allPurpleThinkingTheme;

  globals[slot("quietThinking")] = (owner: object, runIndex: number, streaming: boolean, hidden: boolean) =>
    quiet.observeThinking(owner, runIndex, !streaming, !hidden);
  globals[slot("quietProse")] = (owner: object, contentIndex: number) => quiet.observeProse(owner, contentIndex);
  globals[slot("quietMessageSpacer")] = (owner: object) => quiet.showMessageSpacer(owner);
}
