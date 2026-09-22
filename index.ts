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
// Using both means `/minimalist` is the same component, with the same
// keybindings and colours, as Pi's own `/settings`.
import { SettingsList } from "@earendil-works/pi-tui";
import { installBridges, sharedState } from "./src/bridge.ts";
import { BASIC_KEYS, DEFAULT_BASIC, type BasicKey, type BasicSettings, type Config } from "./src/config.ts";
import { loadSettings, migratedQuiet, saveBasicSettings } from "./src/config-file.ts";
import { argumentCompletions, createConfigScreen, summary } from "./src/config-ui.ts";
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
  pi.on("agent_start", () => grouping.agentStarted());
  pi.on("agent_settled", () => grouping.agentSettled());

  pi.registerCommand("minimalist", {
    description: "Open pi-minimalist settings; `status` shows current state",
    getArgumentCompletions: argumentCompletions,
    handler: async (args, ctx) => {
      const command = args.trim().toLowerCase();
      if (command && command !== "config" && command !== "status") {
        ctx.ui.notify("Usage: /minimalist [config|status]", "warning");
        return;
      }
      if (command === "status") {
        ctx.ui.notify(`pi-minimalist\n${summary(config.all())}`, "info");
        return;
      }
      if (!ctx.hasUI || ctx.mode !== "tui") {
        ctx.ui.notify("/minimalist needs the interactive TUI; use /minimalist status for current settings", "warning");
        return;
      }

      await ctx.ui.custom<void>((_tui, _theme, _keybindings, done) =>
        createConfigScreen({
          SettingsList,
          theme: getSettingsListTheme(),
          config,
          onChange: (key, value) => persist(ctx, config, key, value),
          onReset: () => persistDefaults(ctx, config),
          onClose: () => done(),
        }),
      );
    },
  });
}

type NotifyContext = { ui: { notify(message: string, type?: "info" | "warning" | "error"): void } };

/**
 * Write only the changed key to the global agent settings, and be honest when that is impossible.
 *
 * The live value has already changed, so a silent failure would leave the UI and
 * the file disagreeing. Keeping it as a session override means the per-turn
 * re-read cannot revert what the message says was applied.
 */
function persistDefaults(ctx: NotifyContext, config: Config): void {
  const result = saveBasicSettings(DEFAULT_BASIC);
  for (const key of BASIC_KEYS) {
    if (result.ok) config.clearSessionOverride(key);
    else config.setSessionOverride(key, config.get(key));
  }
  if (!result.ok) {
    ctx.ui.notify(`Defaults applied for this session only; settings.json could not be written (${result.reason}).`, "warning");
  }
}

function persist(
  ctx: NotifyContext,
  config: Config,
  key: BasicKey,
  value: BasicSettings[BasicKey],
): void {
  const result = saveBasicSettings({ [key]: value });
  if (result.ok) {
    // The file now agrees, so it becomes the source of truth again.
    config.clearSessionOverride(key);
    return;
  }
  config.setSessionOverride(key, value);
  ctx.ui.notify(
    result.reason === "comments"
      ? `Applied for this session only. settings.json has comments, which JSON.stringify would delete — set "minimalist": { "${key}": ${JSON.stringify(value)} } by hand to persist.`
      : `Applied for this session only; settings.json could not be written (${result.reason}).`,
    "warning",
  );
}
