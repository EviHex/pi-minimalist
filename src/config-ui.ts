/** `/minimalist` (also `/minimalist config`) — Pi's SettingsList with live, conditional rows. */

import { truncateToWidth, type AutocompleteItem, type Component, type SettingItem, type SettingsList, type SettingsListTheme } from "@earendil-works/pi-tui";
import {
  BASIC_KEYS,
  type BasicKey,
  type BasicSettings,
  type Config,
  type Settings,
} from "./config.ts";

type Field = {
  key: BasicKey;
  label: string;
  description: string;
  /** Hidden until prose folding is on. */
  activityOption?: boolean;
};

/** Label and hover description for every basic setting, in display order. */
export const FIELDS: Field[] = [
  {
    key: "compactToolRows",
    label: "Compact tool rows",
    description: "Show each tool call as one line instead of Pi's full card. Off restores Pi's native rendering.",
  },
  {
    key: "groupToolRuns",
    label: "Combine consecutive tool calls",
    description: "Replace consecutive finished tool calls with a single count, e.g. 'read ×2, edit ×1'.",
  },
  {
    key: "foldIntermediateActivity",
    label: "Collapse earlier activity",
    description: "Keep the latest assistant reply visible; replace earlier text, thinking, and tool calls with one summary.",
  },
  {
    key: "foldActivityOnFinalAnswer",
    label: "  Collapse when final answer starts",
    description: "Keep work visible until OpenAI starts its final answer, then collapse the earlier activity.",
    activityOption: true,
  },
  {
    key: "activitySummary",
    label: "  Activity summary",
    description: "Show either elapsed work time or the tools used in place of folded activity.",
    activityOption: true,
  },
  {
    key: "gutter",
    label: "Left border",
    description: "Show a coloured bar to the left of each row, making tool calls easier to spot.",
  },
  {
    key: "timer",
    label: "Elapsed timer",
    description: "Show how long a running tool has taken, updated once per second.",
  },
  {
    key: "thinkingAsToolCall",
    label: "Compact thinking rows",
    description: "Show collapsed thinking in the same one-line style as tool calls, rather than a separate block.",
  },
  {
    key: "keepActiveToolsExpanded",
    label: "Keep running tools out of groups",
    description: "Never fold a tool that is still running, so you can watch its progress.",
  },
  {
    key: "keepActiveThinkingExpanded",
    label: "Show thinking while generating",
    description: "Show the full thinking block as it arrives, instead of a one-line preview.",
  },
  {
    key: "glyphStyle",
    label: "Symbols",
    description: "Use ordinary Unicode symbols, or switch to ASCII if some symbols are missing or misaligned. A Nerd Font is not required.",
  },
];

type InputComponent = Component & { handleInput(data: string): void };
type SettingsListConstructor = new (...args: ConstructorParameters<typeof SettingsList>) => SettingsList;
type BasicValue = BasicSettings[BasicKey];

/** Conditional rows plus their display values. */
export function items(settings: Settings): SettingItem[] {
  return FIELDS.filter((field) => !field.activityOption || settings.foldIntermediateActivity).map(
    ({ key, label, description }) => {
      const value = settings[key];
      return {
        id: key,
        label,
        description,
        currentValue: displayValue(value),
        values: key === "activitySummary" ? ["elapsed time", "tools used"] : key === "glyphStyle" ? ["Unicode", "ASCII"] : ["on", "off"],
      };
    },
  );
}

export type ConfigScreenDeps = {
  SettingsList: SettingsListConstructor;
  theme: SettingsListTheme;
  config: Config;
  onChange: (key: BasicKey, value: BasicValue) => void;
  onClose: () => void;
};

/** Build a live screen; toggling prose folding immediately adds/removes its two child rows. */
export function createConfigScreen(deps: ConfigScreenDeps): InputComponent {
  const { SettingsList, theme, config, onChange, onClose } = deps;
  let list: SettingsList;

  const build = () => {
    const rows = items(config.all());
    return new SettingsList(
      rows,
      rows.length,
      theme,
      (id, displayValue) => {
        if (!isBasicKey(id)) return;
        if (id === "activitySummary") {
          const value = displayValue === "tools used" ? "tools" : "elapsed";
          config.set(id, value);
          onChange(id, value);
        } else if (id === "glyphStyle") {
          const value = displayValue === "ASCII" ? "ascii" : "unicode";
          config.set(id, value);
          onChange(id, value);
        } else {
          const value = displayValue === "on";
          config.set(id, value);
          onChange(id, value);
        }
        if (id === "foldIntermediateActivity") {
          list = build();
          list.selectItem(id);
        }
      },
      onClose,
    );
  };

  list = build();
  return {
    render: (width) => [
      ...list.render(width),
      truncateToWidth(theme.hint("  Changes apply live · Ctrl+O reveals tool output"), width),
    ],
    handleInput: (data) => list.handleInput(data),
    handleMouse: (event) => list.handleMouse?.(event),
    invalidate: () => list.invalidate?.(),
  };
}

function isBasicKey(id: string): id is BasicKey {
  return (BASIC_KEYS as string[]).includes(id);
}

function displayValue(value: BasicValue): string {
  if (value === "elapsed") return "elapsed time";
  if (value === "tools") return "tools used";
  if (value === "unicode") return "Unicode";
  if (value === "ascii") return "ASCII";
  return value ? "on" : "off";
}

/** Argument completions for `/minimalist ...`. */
export function argumentCompletions(prefix: string): AutocompleteItem[] | null {
  const items: AutocompleteItem[] = [
    { value: "config", label: "config", description: "Open the settings editor" },
    { value: "status", label: "status", description: "Show current settings" },
  ];
  const filtered = items.filter((item) => item.value.startsWith(prefix));
  return filtered.length > 0 ? filtered : null;
}

/** One-line-per-visible-setting summary for `/minimalist status`. */
export function summary(settings: Settings): string {
  const visible = FIELDS.filter((field) => !field.activityOption || settings.foldIntermediateActivity);
  const width = Math.max(...visible.map((field) => field.label.length));
  return [
    ...visible.map(({ key, label }) => {
      return `  ${label.padEnd(width)}  ${displayValue(settings[key])}`;
    }),
    "",
    "  /minimalist          change these",
    "  settings.json        custom glyphs, colours, excluded tools",
  ].join("\n");
}
