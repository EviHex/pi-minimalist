/**
 * Reading and writing the `minimalist` key in Pi's settings.json.
 *
 * WHY settings.json AND NOT OUR OWN FILE
 * --------------------------------------
 * The old `pi-minimalist.json` was a second config file the user had to know
 * about, and it hardcoded `~/.pi/agent`, so anyone setting
 * `PI_CODING_AGENT_DIR` silently wrote their preference somewhere it would never
 * be read back. settings.json is where a Pi user already looks, it is what
 * `pi-env` reads, and Pi tolerates unknown top-level keys (the published
 * `pi-powerline-footer` extension does exactly this with its `powerline` key).
 *
 * SCOPE
 *   defaults  <  global agent settings.json (PI_CODING_AGENT_DIR if set).
 *   Project-local `minimalist` blocks are deliberately ignored.
 *
 * FAILURE POLICY
 * This file is hand-edited by a human, so a syntax error must never take the UI
 * down: every read failure falls back to defaults, and a malformed value is
 * ignored field by field so one bad line cannot disable the rest.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  BASIC_KEYS,
  DEFAULT_BASIC,
  DEFAULTS,
  DEFAULT_TOKENS,
  GLYPH_PRESETS,
  FRESH_PRESET,
  LOOK_KEYS,
  PRESETS,
  isFresh,
  isPreset,
  SETTINGS_KEY,
  type BasicSettings,
  type Glyphs,
  type Settings,
  type Tokens,
} from "./config.ts";

/**
 * Pi's config directory.
 *
 * Two lines copied from Pi's `getAgentDir()` on purpose: importing it pulls in
 * the package's whole module graph (~17MB), which would make `./run-tests.sh
 * --unit` depend on a full Pi install. `test/integration.test.ts` asserts this
 * copy agrees with Pi's real implementation, so it cannot drift unnoticed.
 */
export function agentDir(env = process.env): string {
  return env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

export function globalSettingsPath(env = process.env): string {
  return join(agentDir(env), "settings.json");
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// JSON comments
// ---------------------------------------------------------------------------

/**
 * Remove `//` and block comments that are outside string literals.
 *
 * Pi bundles `strip-json-comments` but does not re-export it to extensions, so
 * this is a small character scanner. The only real subtlety is that `//` inside a
 * JSON string (a URL, a Windows path) must NOT start a comment.
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

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Parse a settings file. Any failure yields `{}` — never throws. */
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
 * Take only well-typed fields from raw JSON.
 *
 * Field-by-field so one bad value cannot poison the rest, which matters because
 * this is hand-edited input.
 */
function coerce(raw: unknown, into: Settings): Settings {
  const out = { ...into };
  // A user with no basic key has never configured anything: they get the default preset.
  if (isFresh(raw)) out.preset = FRESH_PRESET;
  if (!isRecord(raw)) return out;

  for (const key of BASIC_KEYS) {
    if (typeof DEFAULT_BASIC[key] === "boolean" && typeof raw[key] === "boolean") {
      // BASIC_KEYS also contains the enum below; the runtime default narrows the
      // assignable values more honestly than a second maintained key list.
      (out as Record<string, unknown>)[key] = raw[key];
    }
  }
  if (raw.activitySummary === "elapsed" || raw.activitySummary === "tools") {
    out.activitySummary = raw.activitySummary;
  }
  if (Array.isArray(raw.excludeTools)) {
    out.excludeTools = raw.excludeTools.filter((name): name is string => typeof name === "string");
  }
  if (isPreset(raw.preset)) out.preset = raw.preset;
  if (raw.glyphStyle === "unicode" || raw.glyphStyle === "ascii") {
    out.glyphStyle = raw.glyphStyle;
  }
  if (isRecord(raw.glyphs)) {
    out.glyphs = pickStrings(raw.glyphs, Object.keys(GLYPH_PRESETS.unicode) as (keyof Glyphs)[]);
  }
  if (isRecord(raw.tokens)) {
    // A token NAME cannot be validated here: the set of valid names is Pi's theme
    // palette, which this file deliberately does not import. An unknown name
    // throws inside theme.fg/bg at paint time, and core then falls back to its
    // verbose card — visibly wrong, rather than silently mispainted. The cast is
    // therefore the honest boundary of what this function can check.
    out.tokens = pickStrings(raw.tokens, Object.keys(DEFAULT_TOKENS) as (keyof Tokens)[]) as Partial<Tokens>;
  }
  return out;
}

/** Copy only the string-valued keys we recognize. */
function pickStrings<K extends string>(raw: Json, keys: K[]): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  for (const key of keys) {
    if (typeof raw[key] === "string") out[key] = raw[key] as string;
  }
  return out;
}

/** Read only the global agent settings, never project-local preferences. */
export function loadSettings(env = process.env): Settings {
  const global = readSettingsFile(globalSettingsPath(env));
  return coerce(global[SETTINGS_KEY], DEFAULTS);
}

/**
 * Look keys to write when the user switches to `custom` for the first time: the
 * `lite` look, so "custom" starts from something known. Undefined when the file
 * already holds any of the user's own look keys (they are kept untouched).
 */
export function customSeed(env = process.env): Record<string, boolean> | undefined {
  const block = readSettingsFile(globalSettingsPath(env))[SETTINGS_KEY];
  const own = isRecord(block) && LOOK_KEYS.some((key) => key in block);
  return own ? undefined : PRESETS.lite;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export type SaveResult =
  | { ok: true }
  | { ok: false; reason: "comments" | "unparsable" | "write"; detail?: string };

/**
 * Persist only the supplied editor-managed settings into the global agent file.
 * A normal edit passes one key.
 * Hand-written `glyphs`/`tokens`/`excludeTools` values survive untouched.
 *
 * REFUSES to write a file containing comments. `JSON.stringify` would silently
 * delete them, and quietly destroying an annotated config is far worse than
 * asking the user to edit one line by hand.
 */
export function saveBasicSettings(settings: Partial<BasicSettings>, env = process.env): SaveResult {
  const path = globalSettingsPath(env);

  let raw = "";
  try {
    if (existsSync(path)) raw = readFileSync(path, "utf8");
  } catch (error) {
    return { ok: false, reason: "write", detail: String(error) };
  }
  if (raw && hasComments(raw)) return { ok: false, reason: "comments", detail: path };

  let root: unknown;
  try {
    root = raw.trim() ? JSON.parse(raw) : {};
  } catch (error) {
    return { ok: false, reason: "unparsable", detail: String(error) };
  }
  if (!isRecord(root)) return { ok: false, reason: "unparsable", detail: path };

  if (root[SETTINGS_KEY] !== undefined && !isRecord(root[SETTINGS_KEY])) {
    return { ok: false, reason: "unparsable", detail: path };
  }
  const existing = isRecord(root[SETTINGS_KEY]) ? root[SETTINGS_KEY] : {};
  const merged: Json = { ...existing };
  // The first write must pin the fresh-install preset, or the file would stop looking fresh and become `custom`.
  if (isFresh(existing)) merged.preset = FRESH_PRESET;
  for (const key of BASIC_KEYS) {
    if (settings[key] !== undefined) merged[key] = settings[key];
  }

  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ ...root, [SETTINGS_KEY]: merged }, null, 2)}\n`);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: "write", detail: String(error) };
  }
}
