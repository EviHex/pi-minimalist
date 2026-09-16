/**
 * `/minimalist config` — the interactive settings screen.
 *
 * WHY pi-tui's SettingsList RATHER THAN A HAND-ROLLED MENU
 * -------------------------------------------------------
 * It is the exact component Pi's own `/settings` uses, and both it and
 * `getSettingsListTheme()` are public exports. Reusing it means arrow-key
 * navigation, the hover description line, Enter/Space cycling, search and mouse
 * support are identical to `/settings` — nothing new to learn, and no
 * re-implementation to keep in sync with Pi's look.
 *
 * WHAT BELONGS HERE
 * -----------------
 * Only settings whose effect is visible immediately and needs no vocabulary.
 * Glyph maps, theme tokens, the exclusion list and the sanity cap stay JSON-only:
 * they need exact tool names or Pi palette knowledge, and putting them in a
 * chooser would imply they are casual choices.
 */

// Real pi-tui types, not structural stand-ins: a mismatched theme or item shape
// would otherwise only surface as a runtime throw inside the overlay.
import type { Component, SettingItem, SettingsList, SettingsListTheme } from "@earendil-works/pi-tui";
import { BASIC_KEYS, type BasicKey, type Config, type Settings } from "./config.ts";

/** Label and hover description for every setting the screen exposes, in order. */
export const FIELDS: { key: BasicKey; label: string; description: string }[] = [
  {
    key: "compactToolRows",
    label: "Compact tool rows",
    description: "Show each tool call as one line instead of Pi's full card. Off restores Pi's native rendering.",
  },
  {
    key: "groupToolRuns",
    label: "Group tool runs",
    description: "Fold a run of finished rows into one summary line, e.g. 'read ×2, edit ×1'.",
  },
  {
    key: "gutter",
    label: "Gutter",
    description: "Draw the coloured bar at the left of each row, so tool output reads as an indented block.",
  },
  {
    key: "timer",
    label: "Elapsed timer",
    description: "Show how long a running tool has taken, updated once per second.",
  },
  {
    key: "thinkingAsToolCall",
    label: "Thinking as tool call",
    description: "Render a collapsed thinking block exactly like a tool row, instead of in its own colour.",
  },
  {
    key: "keepActiveToolsExpanded",
    label: "Keep running tools out of groups",
    description: "Never fold a tool that is still running, so you can watch its progress.",
  },
  {
    key: "keepActiveThinkingExpanded",
    label: "Keep streaming thinking expanded",
    description: "Show a thinking block in full while it streams, instead of its one-line preview.",
  },
];

/** What `ctx.ui.custom()` needs back: a Component that also takes key input. */
type InputComponent = Component & { handleInput(data: string): void };

/** The class itself, injected so tests can drive the real component. */
type SettingsListConstructor = new (...args: ConstructorParameters<typeof SettingsList>) => SettingsList;

/** Rows for the list, with booleans worded as on/off — this is a UI, not JSON. */
export function items(settings: Settings): SettingItem[] {
  return FIELDS.map(({ key, label, description }) => ({
    id: key,
    label,
    description,
    currentValue: settings[key] ? "on" : "off",
    values: ["on", "off"],
  }));
}

export type ConfigScreenDeps = {
  SettingsList: SettingsListConstructor;
  theme: SettingsListTheme;
  /** Live settings, mutated as the user cycles values. */
  config: Config;
  /** Called after every change so the caller can persist and repaint. */
  onChange: (key: BasicKey, value: boolean) => void;
  /** Called when the user dismisses the screen. */
  onClose: () => void;
};

/**
 * Build the screen.
 *
 * Every change is applied to the live Config IMMEDIATELY, so the transcript
 * behind the overlay re-renders as the user moves through the list. Seeing the
 * effect while choosing is the whole reason this is a screen and not a set of
 * flags.
 */
export function createConfigScreen(deps: ConfigScreenDeps): InputComponent {
  const { SettingsList, theme, config, onChange, onClose } = deps;
  return new SettingsList(
    items(config.all()),
    // Show every row: the list is short, and scrolling would hide options.
    FIELDS.length,
    theme,
    (id, newValue) => {
      if (!isBasicKey(id)) return;
      const value = newValue === "on";
      config.set(id, value);
      onChange(id, value);
    },
    onClose,
  );
}

function isBasicKey(id: string): id is BasicKey {
  return (BASIC_KEYS as string[]).includes(id);
}

/** One-line-per-setting summary for `/minimalist` with no arguments. */
export function summary(settings: Settings): string {
  const width = Math.max(...FIELDS.map((field) => field.label.length));
  return [
    ...FIELDS.map(({ key, label }) => `  ${label.padEnd(width)}  ${settings[key] ? "on" : "off"}`),
    "",
    "  /minimalist config   change these",
    "  settings.json        glyphs, colours, excluded tools",
  ].join("\n");
}
