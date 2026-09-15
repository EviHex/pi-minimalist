/**
 * pi-minimalist — WIRING ONLY. All behavior lives in src/.
 *
 * UI features:
 *   1. compact one-line tool calls with native expanded output;
 *   2. compact collapsed thinking previews.
 *
 * NOTHING ON DISK IS PATCHED. Pi's bundled CLI hands extensions its own live
 * module namespaces (jiti `virtualModules`), so the exported component classes
 * here are the exact objects the running TUI instantiates, and src/core-patch.ts
 * wraps their prototypes at load time. See that file for the full rationale.
 *
 * Markdown chrome (code-block corners + blockquote gutter) used to live here; it
 * is now the separate `pi-markdown-chrome` extension.
 *
 * This extension registers NO tools. Re-registering built-ins changes their
 * ownership and makes pi-subagents remove them from child tool allowlists.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as core from "@earendil-works/pi-coding-agent";
import { installBridges, sharedQuietMode } from "./src/bridge.ts";
import { patchCore } from "./src/core-patch.ts";
import { QuietMode } from "./src/quiet-mode.ts";
import { loadQuietEnabled, saveQuietEnabled } from "./src/quiet-state.ts";
import { refreshMcpTools } from "./src/tools.ts";

export default function (pi: ExtensionAPI) {
  // Keep the QuietMode instance across /reload: existing transcript rows close
  // over it, so replacing it would strand their fold state.
  const quiet = sharedQuietMode() ?? new QuietMode(loadQuietEnabled());
  installBridges(quiet);
  // Runtime replacement for the former patch-pi.sh bundle edits. Idempotent, so
  // /reload only refreshes the bridge slots the wrappers read.
  patchCore(core);

  // MCP direct tool names depend on adapter configuration. Discover them from
  // public source metadata instead of maintaining a server/tool whitelist.
  const refresh = () => refreshMcpTools(pi.getAllTools());
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
