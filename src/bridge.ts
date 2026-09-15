/**
 * The core-bridge boundary: every process-global symbol this extension installs,
 * and the one function that installs them.
 *
 * SINGLE SOURCE OF TRUTH for the symbol names. patch-pi.sh writes the matching
 * reads into Pi's bundle (a shell script cannot import this), and
 * test/integration.test.ts asserts the bundle contains every name listed here —
 * so a typo or a forgotten patch fails the test run instead of silently
 * disabling a feature.
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
  /** Spacer suppression for fully hidden rows. */
  quietSpacer: "pi.minimalist.quietSpacer",
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
  globals[slot("quietSpacer")] = (toolCallId: string) => quiet.view(toolCallId) !== "hide";
  globals[slot("quietMessageSpacer")] = (owner: object) => quiet.showMessageSpacer(owner);
}
