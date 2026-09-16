/**
 * pi-minimalist — WIRING ONLY. All behavior lives in src/.
 *
 *   1. compact one-line tool rows, with Pi's own expanded output on Ctrl+O;
 *   2. compact collapsed thinking previews;
 *   3. optional folding of adjacent rows into one summary line.
 *
 * NOTHING ON DISK IS PATCHED. Pi's bundled CLI hands extensions its own live
 * module namespaces (jiti `virtualModules`), so the component classes imported
 * here are the exact objects the running TUI instantiates, and `core-patch.ts`
 * wraps their prototypes at load time. See that file for the full rationale.
 *
 * This extension registers NO tools. Re-registering built-ins would change their
 * source ownership and make pi-subagents drop them from child tool allowlists.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as core from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
// SettingsList lives in pi-tui; its Pi-styled theme comes from pi-coding-agent.
// Using both means `/minimalist config` is the same component, with the same
// keybindings and colours, as Pi's own `/settings`.
import { SettingsList } from "@earendil-works/pi-tui";
import { installBridges, sharedState } from "./src/bridge.ts";
import type { BasicKey, Config } from "./src/config.ts";
import { loadSettings, migratedQuiet, saveBasicSettings } from "./src/config-file.ts";
import { createConfigScreen, summary } from "./src/config-ui.ts";
import { patchCore } from "./src/core-patch.ts";
import { refreshMcpTools } from "./src/tools.ts";

export default function (pi: ExtensionAPI) {
  // Adopted from the previous load when reloading: existing transcript rows close
  // over these and resolve appearance at render time, so replacing them would
  // strand every row on stale state.
  const { config, grouping } = sharedState(loadSettings());

  // One-time migration of the preference written by the removed `/quiet`
  // command. A session override, so the per-turn re-read below cannot revert it
  // before the user has saved anything.
  const migrated = migratedQuiet();
  if (migrated !== undefined) config.setSessionOverride("groupToolRuns", migrated);

  installBridges({ config, grouping });
  // Runtime replacement for editing Pi's compiled bundle. Idempotent, so a
  // /reload only refreshes the bridge slots the wrappers read.
  patchCore(core);

  const refresh = () => {
    // MCP tool names depend on adapter configuration, so they are discovered from
    // public source metadata rather than a maintained whitelist.
    refreshMcpTools(pi.getAllTools());
    // Re-read settings.json so an external edit (or pi-env) applies without a
    // restart. Session overrides are re-applied by Config.replace().
    config.replace(loadSettings());
  };
  pi.on("session_start", refresh);
  pi.on("turn_start", refresh);

  pi.registerCommand("minimalist", {
    description: "Show pi-minimalist settings; `config` opens the editor",
    handler: async (args, ctx) => {
      if (args.trim().toLowerCase() !== "config") {
        // Bare `/minimalist` prints current state instead of opening a chooser:
        // "what is on right now" is the more common question and needs no
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
          onChange: (key, value) => persist(ctx, config, key, value),
          onClose: () => done(),
        }),
      );
    },
  });
}

type NotifyContext = { ui: { notify(message: string, type?: "info" | "warning" | "error"): void } };

/**
 * Write the change to settings.json, and be honest when that is impossible.
 *
 * The live value has already changed, so a silent failure would leave the UI and
 * the file disagreeing. Keeping it as a session override means the per-turn
 * re-read cannot revert what the message says was applied.
 */
function persist(ctx: NotifyContext, config: Config, key: BasicKey, value: boolean): void {
  const result = saveBasicSettings(config.all());
  if (result.ok) {
    // The file now agrees, so it becomes the source of truth again.
    config.clearSessionOverride(key);
    return;
  }
  config.setSessionOverride(key, value);
  ctx.ui.notify(
    result.reason === "comments"
      ? `Applied for this session only. settings.json has comments, which JSON.stringify would delete — set "minimalist": { "${key}": ${value} } by hand to persist.`
      : `Applied for this session only; settings.json could not be written (${result.reason}).`,
    "warning",
  );
}
