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
import { type BasicKey, type BasicSettings, type Config } from "./src/config.ts";
import { customSeed, loadSettings, saveBasicSettings } from "./src/config-file.ts";
import { argumentCompletions, createConfigScreen, summary } from "./src/config-ui.ts";
import { patchCore } from "./src/core-patch.ts";
import { refreshMcpTools } from "./src/tools.ts";

export default function (pi: ExtensionAPI) {
  // Adopted from the previous load when reloading: existing transcript rows close
  // over these and resolve appearance at render time, so replacing them would
  // strand every row on stale state.
  const { config, grouping } = sharedState(loadSettings());

  installBridges({ config, grouping });
  // Idempotent, so a /reload only refreshes the Bridge the wrappers read.
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
          onClose: () => done(),
        }),
      );
    },
  });
}

type NotifyContext = { ui: { notify(message: string, type?: "info" | "warning" | "error"): void } };

function persist(
  ctx: NotifyContext,
  config: Config,
  key: BasicKey,
  value: BasicSettings[BasicKey],
): void {
  // The first switch to `custom` starts from the `lite` look (see customSeed).
  const seed = key === "preset" && value === "custom" ? customSeed() : undefined;
  const changes: Partial<Record<BasicKey, unknown>> = { ...seed, [key]: value };
  const result = saveBasicSettings(changes as Partial<BasicSettings>);
  for (const [k, v] of Object.entries(changes) as [BasicKey, never][]) {
    config.set(k, v);
    // On success the file agrees, so it becomes the source of truth again.
    if (result.ok) config.clearSessionOverride(k);
    else config.setSessionOverride(k, v);
  }
  if (result.ok) return;
  ctx.ui.notify(
    result.reason === "comments"
      ? `Applied for this session only. settings.json has comments, which JSON.stringify would delete — set "minimalist": { "${key}": ${JSON.stringify(value)} } by hand to persist.`
      : `Applied for this session only; settings.json could not be written (${result.reason}).`,
    "warning",
  );
}
