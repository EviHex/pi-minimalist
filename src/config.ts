/**
 * The setting schema and the live settings object.
 *
 * This file has NO filesystem access: reading and writing settings.json lives in
 * `config-file.ts`. Keeping them apart means the schema can be unit-tested with
 * no temp directories, and the I/O rules (comment handling, refusal to clobber)
 * are readable on their own.
 */

import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";

// ThemeBg is not exported publicly, so recover it from Theme.bg's own signature
// rather than importing a deep dist path (which is not a package export).
type ThemeBg = Parameters<Theme["bg"]>[0];

/** Top-level key inside Pi's settings.json. */
export const SETTINGS_KEY = "minimalist";

// ---------------------------------------------------------------------------
// Glyphs
// ---------------------------------------------------------------------------

/**
 * Status and decoration characters.
 *
 * Configurable for fonts or terminals that lack one of the ordinary Unicode
 * characters below, or measure its width differently. A Nerd Font is not
 * required; the ASCII fallback keeps each glyph within one column.
 */
export type Glyphs = {
  done: string;
  failed: string;
  running: string;
  queued: string;
  gutter: string;
  /** Prefix inside the elapsed badge, e.g. `⏱` in `[⏱ 3s]`. May be empty. */
  timer: string;
  /** Multiplier in run summaries, e.g. `×` in `read ×2`. */
  count: string;
};

export type GlyphStyle = "unicode" | "ascii";

/** Marker on the header of an opened run. Not user-configurable. */
export const OPEN_MARKER: Record<GlyphStyle, string> = { unicode: "▾", ascii: "v" };

export const GLYPH_PRESETS: Record<GlyphStyle, Glyphs> = {
  unicode: { done: "✓", failed: "✗", running: "•", queued: "›", gutter: "▌", timer: "⏱", count: "×" },
  // Every ASCII glyph is exactly one column wide, so rows stay aligned in fonts
  // that render the Unicode set as double-width boxes.
  ascii: { done: "+", failed: "x", running: "*", queued: ">", gutter: "|", timer: "", count: "x" },
};

// ---------------------------------------------------------------------------
// Theme tokens
// ---------------------------------------------------------------------------

/**
 * Which Pi theme token paints each part of a row.
 *
 * Overridable, but the defaults are deliberate: the action word is a LABEL, not
 * a warning, so it uses `success` green even for mutating tools. An earlier
 * version used warning orange, which collided with orange meaning "highlighted
 * prose".
 */
export type Tokens = {
  label: ThemeColor;
  details: ThemeColor;
  thinking: ThemeColor;
  error: ThemeColor;
  outputGutter: ThemeColor;
  activeBg: ThemeBg;
};

export const DEFAULT_TOKENS: Tokens = {
  label: "success",
  details: "toolTitle",
  thinking: "thinkingText",
  error: "error",
  outputGutter: "borderMuted",
  activeBg: "toolPendingBg",
};

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Settings `/minimalist` can edit: visible effect, no vocabulary needed. */
export type ActivitySummary = "elapsed" | "tools";

export const PRESET_NAMES = ["off", "lite", "full", "max", "custom"] as const;
export type Preset = (typeof PRESET_NAMES)[number];

export function isPreset(value: unknown): value is Preset {
  return (PRESET_NAMES as readonly unknown[]).includes(value);
}

/** The only settings a preset names. Every other setting stays the user's own. */
export const LOOK_KEYS = ["compactToolRows", "groupToolRuns", "foldIntermediateActivity", "thinkingAsToolCall"] as const;
export type LookKey = (typeof LOOK_KEYS)[number];

/** Preset of a user who has never configured anything (no basic key in the `minimalist` block). */
export const FRESH_PRESET: Preset = "full";

/** True when the `minimalist` block holds no basic key, so the user never configured anything. */
export function isFresh(block: unknown): boolean {
  return typeof block !== "object" || block === null || !BASIC_KEYS.some((key) => key in block);
}

export type BasicSettings = {
  /** A named bundle of the four look settings below. `custom` uses the user's own values for all of them. */
  preset: Preset;
  /** Master switch. Off restores Pi's native tool cards entirely. */
  compactToolRows: boolean;
  /** Fold adjacent finished rows into one summary line. */
  groupToolRuns: boolean;
  /** Replace all but the latest assistant prose block with one summary row. */
  foldIntermediateActivity: boolean;
  /** What replaces the activity hidden before the latest prose block. */
  activitySummary: ActivitySummary;
  /** Draw the left gutter bar. */
  gutter: boolean;
  /** Show the elapsed badge while a tool runs. */
  timer: boolean;
  /** Render collapsed thinking like a tool row. Off restores Pi's native thinking. */
  thinkingAsToolCall: boolean;
  /** Keep a RUNNING tool out of a fold so its progress stays visible. */
  keepActiveToolsExpanded: boolean;
  /** Keep a STREAMING thinking block expanded instead of collapsed. */
  keepActiveThinkingExpanded: boolean;
  /** Choose ordinary Unicode symbols or a one-column ASCII fallback. */
  glyphStyle: GlyphStyle;
};

/** Settings only reachable by editing settings.json by hand. */
export type AdvancedSettings = {
  /** Tool names left to their own renderer. Everything else is compacted. */
  excludeTools: string[];
  glyphs: Partial<Glyphs>;
  tokens: Partial<Tokens>;
};

export type Settings = BasicSettings & AdvancedSettings;

export const DEFAULT_BASIC: BasicSettings = {
  preset: "custom",
  compactToolRows: true,
  groupToolRuns: true,
  foldIntermediateActivity: false,
  activitySummary: "elapsed",
  gutter: true,
  timer: true,
  thinkingAsToolCall: false,
  keepActiveToolsExpanded: false,
  keepActiveThinkingExpanded: false,
  glyphStyle: "unicode",
};

/**
 * The four look settings each non-custom preset forces. A preset is a LAYER
 * applied on read (see `Config`); it never writes the user's own keys.
 */
export const PRESETS: Record<Exclude<Preset, "custom">, Record<LookKey, boolean>> = {
  off: { compactToolRows: false, groupToolRuns: false, foldIntermediateActivity: false, thinkingAsToolCall: false },
  lite: { compactToolRows: true, groupToolRuns: false, foldIntermediateActivity: false, thinkingAsToolCall: false },
  full: { compactToolRows: true, groupToolRuns: true, foldIntermediateActivity: false, thinkingAsToolCall: true },
  max: { compactToolRows: true, groupToolRuns: true, foldIntermediateActivity: true, thinkingAsToolCall: true },
};

export const DEFAULT_ADVANCED: AdvancedSettings = {
  // `subagent` ships a renderer showing run id, state and a ctrl+o hint that one
  // line cannot carry. Excluded by NAME rather than by the old "does this tool
  // have its own renderer?" rule, which silently exempted every third-party tool
  // and made the behavior impossible to discover from the UI.
  excludeTools: ["subagent"],
  glyphs: {},
  tokens: {},
};

export const DEFAULTS: Settings = { ...DEFAULT_BASIC, ...DEFAULT_ADVANCED };

/**
 * Keys `/minimalist` may write.
 *
 * Derived from DEFAULT_BASIC, so adding a basic setting cannot forget to expose
 * it, and the command can never clobber a hand-written advanced key.
 */
export const BASIC_KEYS = Object.keys(DEFAULT_BASIC) as (keyof BasicSettings)[];

export type BasicKey = keyof BasicSettings;

// ---------------------------------------------------------------------------
// Live configuration
// ---------------------------------------------------------------------------

/** defaults < the user's own keys < the preset's four look keys (none for `custom`). */
function layer(user: Settings): Settings {
  return user.preset === "custom" ? user : { ...user, ...PRESETS[user.preset] };
}

/**
 * The live settings object.
 *
 * Shared and mutable on purpose: transcript rows resolve their appearance at
 * RENDER time, so flipping a value re-renders existing history with no rebuild
 * and no restart.
 */
export class Config {
  /** The user's own values (what settings.json says), before any preset. */
  private settings: Settings;
  /** What the rest of the extension sees: `settings` with the preset layered on. */
  private get view(): Settings {
    return layer(this.settings);
  }

  /**
   * Values changed in this session that are NOT in settings.json.
   *
   * Settings are re-read every turn so an external edit applies without a
   * restart. Without this, a change that could not be persisted (a commented
   * settings.json, a read-only file) or the legacy migration would be silently
   * reverted on the next turn — while the UI still claimed it was applied.
   */
  private overrides = new Map<keyof Settings, Settings[keyof Settings]>();

  constructor(settings: Partial<Settings> = {}) {
    this.settings = { ...DEFAULTS, ...settings };
  }

  get<K extends keyof Settings>(key: K): Settings[K] {
    return this.view[key];
  }

  /** Writes the user's own value; a non-custom preset keeps shadowing it until `preset` is custom. */
  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.settings = { ...this.settings, [key]: value };
  }

  /** Set a value that must survive a re-read of settings.json. */
  setSessionOverride<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.overrides.set(key, value);
    this.set(key, value);
  }

  /** Drop an override once the file agrees with it (i.e. a later save worked). */
  clearSessionOverride(key: keyof Settings): void {
    this.overrides.delete(key);
  }

  all(): Settings {
    return this.view;
  }

  /** Adopt freshly read settings, re-applying anything held only in memory. */
  replace(settings: Settings): void {
    this.settings = { ...settings, ...Object.fromEntries(this.overrides) } as Settings;
  }

  /** Preset chosen by `glyphStyle`, then per-glyph overrides. */
  glyphs(): Glyphs {
    return { ...GLYPH_PRESETS[this.view.glyphStyle], ...this.view.glyphs };
  }

  /** Default token map plus overrides. */
  tokens(): Tokens {
    return { ...DEFAULT_TOKENS, ...this.view.tokens };
  }

  /**
   * Should this tool keep Pi's own rendering?
   *
   * The exclusion list is the ONLY exemption, so the master switch is checked
   * alongside it wherever claiming happens.
   */
  isExcluded(toolName: string): boolean {
    return this.view.excludeTools.includes(toolName);
  }

  /** True when this tool should be drawn as a compact row. */
  compacts(toolName: string): boolean {
    return this.view.compactToolRows && !this.isExcluded(toolName);
  }
}
