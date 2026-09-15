/**
 * pi-minimalist — WIRING ONLY. All behavior lives in src/.
 *
 * UI features installed through the core bridges maintained by patch-pi.sh:
 *   1. compact one-line tool calls with native expanded output;
 *   2. compact collapsed thinking previews.
 *
 * Markdown chrome (code-block corners + blockquote gutter) needs NO patch: it
 * goes through the public theme surface. See src/markdown-chrome.ts.
 *
 * This extension registers NO tools. Re-registering built-ins changes their
 * ownership and makes pi-subagents remove them from child tool allowlists.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installBridges, sharedQuietMode } from "./src/bridge.ts";
import { installLiveThemeChrome } from "./src/markdown-chrome.ts";
import { QuietMode } from "./src/quiet-mode.ts";
import { loadQuietEnabled, saveQuietEnabled } from "./src/quiet-state.ts";
import { refreshMcpTools } from "./src/tools.ts";

export default function (pi: ExtensionAPI) {
  // Keep the QuietMode instance across /reload: existing transcript rows close
  // over it, so replacing it would strand their fold state.
  const quiet = sharedQuietMode() ?? new QuietMode(loadQuietEnabled());
  installBridges(quiet);

  // MCP direct tool names depend on adapter configuration. Discover them from
  // public source metadata instead of maintaining a server/tool whitelist.
  const refresh = () => {
    installLiveThemeChrome();
    refreshMcpTools(pi.getAllTools());
  };
  installLiveThemeChrome();
  pi.on("session_start", refresh);
  pi.on("turn_start", refresh);

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
      // NOTE: notify() has no "success" level — only info | warning | error.
      ctx.ui.notify(enabled ? "Quiet mode enabled" : "Quiet mode disabled", "info");
    },
  });
}
