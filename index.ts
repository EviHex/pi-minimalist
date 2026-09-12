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
import { createThinkingPreview, type ThinkingPreview } from "./src/thinking-preview.ts";
import { createToolRenderer, type ToolRenderer } from "./src/tool-renderer.ts";

const DEFAULT_RENDERER = Symbol.for("pi.defaultToolRenderer");
const THINKING_PREVIEW = Symbol.for("pi.thinkingPreview");

type Bridges = {
  [DEFAULT_RENDERER]?: ToolRenderer;
  [THINKING_PREVIEW]?: ThinkingPreview;
};

export default function (_pi: ExtensionAPI) {
  const globals = globalThis as typeof globalThis & Bridges;

  // Reload overwrites these slots with fresh instances. Do not clear them from
  // session_shutdown: an old extension shutdown may run after the new load and
  // erase the new bridges. Process exit clears globalThis naturally.
  globals[DEFAULT_RENDERER] = createToolRenderer();
  globals[THINKING_PREVIEW] = createThinkingPreview();
}
