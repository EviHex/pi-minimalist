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
 * Markdown chrome (code-block corners + blockquote gutter) is now the separate
 * `pi-markdown-chrome` extension.
 *
 * This extension registers NO tools. Re-registering built-ins changes their
 * ownership and makes pi-subagents remove them from child tool allowlists.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as core from "@earendil-works/pi-coding-agent";
// SettingsList lives in pi-tui; its Pi-styled theme comes from pi-coding-agent.
// Using both means `/minimalist config` is the same component, with the same
// keybindings and colours, as Pi's own `/settings`.
import { SettingsList } from "@earendil-works/pi-tui";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { installBridges, sharedConfig, sharedQuietMode } from "./src/bridge.ts";
import { Config, loadSettings, migratedQuiet, saveCommandSettings } from "./src/config.ts";
import { createConfigScreen, summary } from "./src/config-ui.ts";
import { patchCore } from "./src/core-patch.ts";
import { QuietMode } from "./src/quiet-mode.ts";
import { useConfig } from "./src/row.ts";
import { refreshMcpTools } from "./src/tools.ts";

export default function (pi: ExtensionAPI) {
  // Keep the Config and QuietMode instances across /reload: existing transcript
  // rows close over them and resolve appearance at render time, so replacing
  // them would strand every row on stale state.
  const config = sharedConfig() ?? new Config(loadSettings());
  const quiet = sharedQuietMode() ?? new QuietMode(config);

  // One-time migration of the old `/quiet` preference from pi-minimalist.json.
  // Only applies when settings.json has no groupToolRuns yet, so an explicit
  // setting always wins.
  // A session override, so the per-turn re-read of settings.json cannot revert
  // it before the user has saved anything.
  const migrated = migratedQuiet();
  if (migrated !== undefined) config.setSessionOverride("groupToolRuns", migrated);

  useConfig(config);
  installBridges(quiet, undefined, config);
  // Runtime replacement for the former patch-pi.sh bundle edits. Idempotent, so
  // /reload only refreshes the bridge slots the wrappers read.
  patchCore(core);

  // MCP tool names depend on adapter configuration. Discovered from public
  // source metadata so `mcp` labelling needs no server/tool whitelist.
  const refresh = () => {
    refreshMcpTools(pi.getAllTools());
    // Re-read settings.json so an external edit (or pi-env) applies without a
    // restart. Never overwrite a value the user just changed in the UI: the
    // command writes to settings.json first, so the file is the source of truth.
    config.replace(loadSettings());
  };
  pi.on("session_start", refresh);
  pi.on("turn_start", refresh);

  pi.registerCommand("minimalist", {
    description: "Show pi-minimalist settings; `config` opens the editor",
    handler: async (args, ctx) => {
      const wantsConfig = args.trim().toLowerCase() === "config";
      if (!wantsConfig) {
        // Bare `/minimalist` prints current state instead of opening a chooser:
        // seeing what is on is the more common question, and it needs no
        // navigation.
        ctx.ui.notify(`pi-minimalist\n${summary(config.all())}`, "info");
        return;
      }
      if (!ctx.hasUI) {
        ctx.ui.notify("/minimalist config needs the interactive TUI", "warning");
        return;
      }

      await ctx.ui.custom<void>((_tui, _theme, _keybindings, done) =>
        createConfigScreen({
          SettingsList,
          theme: getSettingsListTheme(),
          config,
          onChange: (key, value) => {
            const result = saveCommandSettings(config.all());
            if (result.ok) {
              // settings.json now agrees, so the in-memory override is no longer
              // needed and the file becomes the source of truth again.
              config.clearSessionOverride(key);
              return;
            }
            // Persisting failed, but the live value already changed. Keep it as a
            // session override so the per-turn re-read cannot revert it, and say
            // so plainly instead of letting the UI and the file disagree.
            config.setSessionOverride(key, value);
            ctx.ui.notify(
              result.reason === "comments"
                ? `Applied for this session only. settings.json has comments, which JSON.stringify would delete — set "minimalist": { "${key}": ${value} } by hand to persist.`
                : `Applied for this session only; settings.json could not be written (${result.reason}).`,
              "warning",
            );
          },
          onClose: () => done(),
        }),
      );
    },
  });
}
