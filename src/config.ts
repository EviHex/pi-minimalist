/**
 * Configuration: the `minimalist` key in Pi's settings.json.
 *
 * WHY settings.json AND NOT OUR OWN FILE
 * --------------------------------------
 * The old `pi-minimalist.json` was a second config file the user had to know
 * about, and it hardcoded `~/.pi/agent`, so anyone setting
 * `PI_CODING_AGENT_DIR` silently wrote their `/quiet` preference somewhere it
 * would never be read back. settings.json is where a Pi user already looks, it
 * is what `pi-env` reads, and Pi tolerates unknown top-level keys (the published
 * `pi-powerline-footer` extension does exactly this with its `powerline` key).
 *
 * LAYERING
 * --------
 * defaults  <  global ~/.pi/agent/settings.json  <  <cwd>/.pi/settings.json
 *
 * Project settings win, matching how Pi itself and pi-powerline-footer merge.
 *
 * FAILURE POLICY
 * --------------
 * This file is hand-edited by a human. A syntax error must never take the UI
 * down: every read failure falls back to defaults. A malformed `minimalist`
 * value is ignored field by field, so one bad line cannot disable the rest.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";

// ThemeBg is not exported publicly; recover it from Theme.bg's own signature.
type ThemeBg = Parameters<Theme["bg"]>[0];

/** Status/decoration characters. Configurable because they are the one setting
 *  that decides whether this extension is USABLE, not merely pretty: outside a
 *  Nerd Font (plain Windows Terminal, some SSH/tmux combinations) they render as
 *  boxes, and since rows truncate by VISIBLE COLUMN a mis-measured glyph shifts
 *  the whole line. */
export type Glyphs = {
  done: string;
  failed: string;
  running: string;
  queued: string;
  gutter: string;
  /** Prefix inside the elapsed badge, e.g. `⏱` in `[⏱ 3s]`. May be empty. */
  timer: string;
  /** Multiplier in quiet summaries, e.g. `×` in `read ×2`. */
  count: string;
};

const GLYPH_PRESETS: Record<"unicode" | "ascii", Glyphs> = {
  unicode: { done: "✓", failed: "✗", running: "•", queued: "›", gutter: "▌", timer: "⏱", count: "×" },
  // Every ASCII glyph is exactly one column wide, so rows stay aligned in fonts
  // that render the Unicode set as double-width boxes.
  ascii: { done: "+", failed: "x", running: "*", queued: ">", gutter: "|", timer: "", count: "x" },
};

/** Theme tokens each row segment uses. Overridable, but the defaults are
 *  deliberate: the action word is a LABEL, not a warning, so it uses `success`
 *  green even for mutating tools (an earlier version used warning orange, which
 *  collided with orange meaning "highlighted prose"). */
export type Tokens = {
  label: ThemeColor;
  details: ThemeColor;
  thinking: ThemeColor;
  error: ThemeColor;
  outputGutter: ThemeColor;
  activeBg: ThemeBg;
};

const DEFAULT_TOKENS: Tokens = {
  label: "success",
  details: "toolTitle",
  thinking: "thinkingText",
  error: "error",
  outputGutter: "borderMuted",
  activeBg: "toolPendingBg",
};

/** Everything `/minimalist config` exposes, plus the JSON-only advanced fields. */
export type Settings = {
  // --- shown in /minimalist config -----------------------------------------
  /** Master switch. Off restores Pi's native tool cards entirely. */
  compactToolRows: boolean;
  /** Fold adjacent finished rows into one summary (the former `/quiet`). */
  groupToolRuns: boolean;
  /** Draw the left `▌` gutter. */
  gutter: boolean;
  /** Show the `[⏱ Ns]` elapsed badge while a tool runs. */
  timer: boolean;
  /** Render collapsed thinking exactly like a tool row (green, folds with them). */
  thinkingAsToolCall: boolean;
  /** Keep a RUNNING tool out of a fold so its progress stays visible. */
  keepActiveToolsExpanded: boolean;
  /** Keep a STREAMING thinking block expanded instead of collapsed to a preview. */
  keepActiveThinkingExpanded: boolean;

  // --- JSON only (advanced) -------------------------------------------------
  /** Tool names left to their own renderer. Blacklist: everything else compacts. */
  excludeTools: string[];
  glyphStyle: "unicode" | "ascii";
  glyphs: Partial<Glyphs>;
  tokens: Partial<Tokens>;
  /** Sanity cap on detail text length. Not a display limit — rows truncate at
   *  the real viewport width. This only stops a multi-megabyte heredoc from
   *  being whitespace-collapsed, colored and measured on every repaint. */
  maxDetailChars: number;
};

export const DEFAULTS: Settings = {
  compactToolRows: true,
  groupToolRuns: false,
  gutter: true,
  timer: true,
  thinkingAsToolCall: false,
  keepActiveToolsExpanded: false,
  keepActiveThinkingExpanded: false,
  // `subagent` ships a renderer showing run id, state and a ctrl+o hint that a
  // one-line row cannot carry. It is excluded by default rather than by the old
  // "does this tool have its own renderer?" rule, which silently exempted every
  // third-party tool and made the behavior impossible to discover.
  excludeTools: ["subagent"],
  glyphStyle: "unicode",
  glyphs: {},
  tokens: {},
  maxDetailChars: 4000,
};

/** Keys `/minimalist config` may write. Advanced keys stay JSON-only, so the
 *  command can never clobber a hand-written glyph or token map. */
export const COMMAND_KEYS = [
  "compactToolRows",
  "groupToolRuns",
  "gutter",
  "timer",
  "thinkingAsToolCall",
  "keepActiveToolsExpanded",
  "keepActiveThinkingExpanded",
] as const satisfies readonly (keyof Settings)[];

export type CommandKey = (typeof COMMAND_KEYS)[number];

export const SETTINGS_KEY = "minimalist";

/**
 * Pi's config directory.
 *
 * Two lines copied from Pi's `getAgentDir()` on purpose: importing it pulls in
 * the package's whole module graph (~17MB), which would make `./run-tests.sh
 * --unit` depend on a full Pi install. `test/integration.test.ts` asserts this
 * agrees with Pi's real implementation, so the copy cannot drift unnoticed.
 */
export function agentDir(env = process.env): string {
  return env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

export function globalSettingsPath(env = process.env): string {
  return join(agentDir(env), "settings.json");
}

export function projectSettingsPath(cwd: string): string {
  return join(cwd, ".pi", "settings.json");
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse a settings file. Any failure yields `{}` — never throws, never logs to
 *  the transcript (a warning per turn would be worse than the missing setting). */
function readSettingsFile(path: string): Json {
  try {
    if (!existsSync(path)) return {};
    // Pi supports comments in settings.json, so tolerate them when READING.
    const parsed = JSON.parse(stripJsonComments(readFileSync(path, "utf8")));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Remove `//` and `/* *\/` comments outside string literals.
 *
 * Pi bundles the `strip-json-comments` package, but it is not re-exported to
 * extensions, so this is a small string-state scanner: the only subtlety is that
 * a `//` inside a JSON string (a URL, a path) must NOT start a comment.
 */
export function stripJsonComments(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  let comment: "line" | "block" | undefined;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (comment === "line") {
      if (char === "\n") {
        comment = undefined;
        out += char;
      }
      continue;
    }
    if (comment === "block") {
      if (char === "*" && next === "/") {
        comment = undefined;
        i++;
      }
      continue;
    }
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === "/" && next === "/") {
      comment = "line";
      i++;
      continue;
    }
    if (char === "/" && next === "*") {
      comment = "block";
      i++;
      continue;
    }
    out += char;
  }
  return out;
}

/** True when a file carries comments, so writing it back would destroy them. */
export function hasComments(text: string): boolean {
  return stripJsonComments(text).length !== text.length;
}

/** Take only well-typed fields from raw JSON. One bad value cannot poison the
 *  rest, which matters because this is hand-edited input. */
function coerce(raw: unknown, into: Settings): Settings {
  if (!isRecord(raw)) return into;
  const out = { ...into };
  const bool = (key: keyof Settings) => {
    if (typeof raw[key] === "boolean") (out[key] as boolean) = raw[key] as boolean;
  };
  for (const key of COMMAND_KEYS) bool(key);

  if (Array.isArray(raw.excludeTools)) {
    out.excludeTools = raw.excludeTools.filter((name): name is string => typeof name === "string");
  }
  if (raw.glyphStyle === "unicode" || raw.glyphStyle === "ascii") out.glyphStyle = raw.glyphStyle;
  if (isRecord(raw.glyphs)) {
    const glyphs: Partial<Glyphs> = {};
    for (const key of Object.keys(GLYPH_PRESETS.unicode) as (keyof Glyphs)[]) {
      if (typeof raw.glyphs[key] === "string") glyphs[key] = raw.glyphs[key] as string;
    }
    out.glyphs = glyphs;
  }
  if (isRecord(raw.tokens)) {
    const tokens: Partial<Tokens> = {};
    for (const key of Object.keys(DEFAULT_TOKENS) as (keyof Tokens)[]) {
      // Tokens are validated at USE time by theme.fg/bg; an unknown name would
      // throw there, so only the shape is checked here.
      if (typeof raw.tokens[key] === "string") (tokens[key] as string) = raw.tokens[key] as string;
    }
    out.tokens = tokens;
  }
  if (typeof raw.maxDetailChars === "number" && raw.maxDetailChars > 0) {
    out.maxDetailChars = Math.floor(raw.maxDetailChars);
  }
  return out;
}

/**
 * Live configuration.
 *
 * A shared mutable object, like QuietMode: transcript rows resolve their
 * appearance at RENDER time, so flipping a value in `/minimalist config`
 * re-renders existing history with no rebuild and no restart. It also survives
 * `/reload` through a process-global slot for the same reason QuietMode does.
 */
export class Config {
  private settings: Settings;
  /**
   * Values changed in this session that are NOT in settings.json.
   *
   * Needed because settings are re-read every turn so an external edit applies
   * without a restart. Without this, a change that could not be persisted (a
   * commented settings.json, a read-only file) or the legacy `/quiet` migration
   * would be silently reverted on the next turn — while the UI still claimed it
   * had been applied.
   */
  private overrides = new Map<keyof Settings, Settings[keyof Settings]>();

  constructor(settings: Settings = DEFAULTS) {
    this.settings = settings;
  }

  get<K extends keyof Settings>(key: K): Settings[K] {
    return this.settings[key];
  }

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
    return this.settings;
  }

  /** Adopt freshly read settings, re-applying anything held only in memory. */
  replace(settings: Settings): void {
    this.settings = { ...settings, ...Object.fromEntries(this.overrides) } as Settings;
  }

  /** Full glyph set: preset chosen by `glyphStyle`, then per-glyph overrides. */
  glyphs(): Glyphs {
    return { ...GLYPH_PRESETS[this.settings.glyphStyle], ...this.settings.glyphs };
  }

  /** Full token map: defaults plus overrides. */
  tokens(): Tokens {
    return { ...DEFAULT_TOKENS, ...(this.settings.tokens as Partial<Tokens>) };
  }

  /** Blacklist test. Default-on rendering means this is the ONLY exemption. */
  isExcluded(toolName: string): boolean {
    return this.settings.excludeTools.includes(toolName);
  }
}

/** Read defaults < global < project. */
export function loadSettings(cwd = process.cwd(), env = process.env): Settings {
  const global = readSettingsFile(globalSettingsPath(env));
  const project = readSettingsFile(projectSettingsPath(cwd));
  return coerce(project[SETTINGS_KEY], coerce(global[SETTINGS_KEY], DEFAULTS));
}

/** Legacy `pi-minimalist.json` written by the old `/quiet` command. */
export function legacyQuietPath(env = process.env): string {
  return join(agentDir(env), "pi-minimalist.json");
}

/**
 * One-time migration of the old `/quiet` preference.
 *
 * Returns the value only when settings.json has no `groupToolRuns` yet, so an
 * explicit new setting always wins and the migration cannot resurrect a stale
 * preference after the user changes their mind.
 */
export function migratedQuiet(env = process.env): boolean | undefined {
  const global = readSettingsFile(globalSettingsPath(env));
  const existing = global[SETTINGS_KEY];
  if (isRecord(existing) && typeof existing.groupToolRuns === "boolean") return undefined;
  try {
    const legacy = JSON.parse(readFileSync(legacyQuietPath(env), "utf8"));
    return isRecord(legacy) && legacy.quiet === true ? true : undefined;
  } catch {
    return undefined;
  }
}

export type SaveResult = { ok: true } | { ok: false; reason: "comments" | "unparsable" | "write"; detail?: string };

/**
 * Persist the command-editable keys into the GLOBAL settings.json.
 *
 * Only the `minimalist` key is touched, and only its command keys: a
 * hand-written `glyphs`/`tokens`/`excludeTools` block is preserved untouched.
 *
 * REFUSES to write a file containing comments. `JSON.stringify` would silently
 * delete them, and quietly destroying a user's annotated config is far worse
 * than asking them to edit one line by hand.
 */
export function saveCommandSettings(settings: Settings, env = process.env): SaveResult {
  const path = globalSettingsPath(env);
  let raw = "";
  try {
    if (existsSync(path)) raw = readFileSync(path, "utf8");
  } catch (error) {
    return { ok: false, reason: "write", detail: String(error) };
  }
  if (raw && hasComments(raw)) return { ok: false, reason: "comments", detail: path };

  let root: Json;
  try {
    root = raw.trim() ? JSON.parse(raw) : {};
  } catch (error) {
    return { ok: false, reason: "unparsable", detail: String(error) };
  }
  if (!isRecord(root)) return { ok: false, reason: "unparsable", detail: path };

  const existing = isRecord(root[SETTINGS_KEY]) ? (root[SETTINGS_KEY] as Json) : {};
  const next: Json = { ...existing };
  for (const key of COMMAND_KEYS) next[key] = settings[key];

  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ ...root, [SETTINGS_KEY]: next }, null, 2)}\n`);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: "write", detail: String(error) };
  }
}
