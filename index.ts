/**
 * pi-minimalist
 *
 * Two independent UI features, installed through the core bridges maintained by
 * patch-pi.sh:
 *   1. compact one-line tool calls with native expanded output;
 *   2. compact collapsed thinking previews.
 *
 * This extension registers NO tools. Re-registering built-ins changes their
 * ownership and makes pi-subagents remove them from child tool allowlists.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { GutteredComponent } from "./src/components.ts";
import { createThinkingPreview, type ThinkingPreview } from "./src/thinking-preview.ts";
import { QuietMode } from "./src/quiet-mode.ts";
import { loadQuietEnabled, saveQuietEnabled } from "./src/quiet-state.ts";
import { createToolRenderer, type ToolRenderer } from "./src/tool-renderer.ts";

const DEFAULT_RENDERER = Symbol.for("pi.defaultToolRenderer");
const THINKING_PREVIEW = Symbol.for("pi.thinkingPreview");
const CONTENT_WRAP = Symbol.for("pi.contentWrap");
const QUIET_MODE = Symbol.for("pi.minimalist.quietMode");
const QUIET_THINKING = Symbol.for("pi.minimalist.quietThinking");
const QUIET_PROSE = Symbol.for("pi.minimalist.quietProse");

type Bridges = {
  [DEFAULT_RENDERER]?: ToolRenderer;
  [THINKING_PREVIEW]?: ThinkingPreview;
  [CONTENT_WRAP]?: (component: Component, kind: "thinking", theme: unknown) => Component;
  [QUIET_MODE]?: QuietMode;
  [QUIET_THINKING]?: (owner: object, runIndex: number, streaming: boolean, hidden: boolean) => void;
  [QUIET_PROSE]?: (owner: object, contentIndex: number) => void;
};

export default function (pi: ExtensionAPI) {
  const globals = globalThis as typeof globalThis & Bridges;
  // Keep this instance across /reload: existing transcript rows close over it.
  const quiet = globals[QUIET_MODE] ?? new QuietMode(loadQuietEnabled());
  globals[QUIET_MODE] = quiet;

  // Reload overwrites these slots with fresh instances. Do not clear them from
  // session_shutdown: an old extension shutdown may run after the new load and
  // erase the new bridges. Process exit clears globalThis naturally.
  globals[DEFAULT_RENDERER] = createToolRenderer({ quiet });
  globals[THINKING_PREVIEW] = createThinkingPreview(undefined, quiet);
  globals[QUIET_THINKING] = (owner, runIndex, streaming, hidden) =>
    quiet.observeThinking(owner, runIndex, !streaming, !hidden);
  globals[QUIET_PROSE] = (owner, contentIndex) => quiet.observeProse(owner, contentIndex);

  pi.registerCommand("quiet", {
    description: "Toggle folding for completed read/edit/write/grep/find/ls/bash/toolcall runs",
    handler: async (_args, ctx) => {
      const enabled = quiet.toggle();
      try {
        saveQuietEnabled(enabled);
      } catch (error) {
        quiet.setEnabled(!enabled);
        ctx.ui.notify(`Quiet mode was not saved: ${error instanceof Error ? error.message : error}`, "error");
        return;
      }
      // notify triggers a TUI repaint, so existing CompactLine components read
      // the shared QuietMode state immediately; no core patch or rebuild needed.
      ctx.ui.notify(enabled ? "Quiet mode enabled" : "Quiet mode disabled", "info");
    },
  });

  // Expanded thinking blocks (Ctrl+T): core hands us the native Markdown
  // component and we wrap it so every line carries the purple thinking gutter,
  // matching the collapsed preview. theme is Pi's Theme at runtime.
  globals[CONTENT_WRAP] = (component, _kind, theme: any) =>
    new GutteredComponent(component, ` ${theme.fg("thinkingText", "▌")} `);
}
