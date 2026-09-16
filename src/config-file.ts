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
 * LAYERING
 *   defaults  <  global ~/.pi/agent/settings.json  <  <cwd>/.pi/settings.json
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
  SETTINGS_KEY,
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

export function projectSettingsPath(cwd: string): string {
  return join(cwd, ".pi", "settings.json");
}

/** Legacy state file written by the removed `/quiet` command. */
export function legacyQuietPath(env = process.env): string {
  return join(agentDir(env), "pi-minimalist.json");
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
  if (!isRecord(raw)) return into;
  const out = { ...into };

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
  if (typeof raw.maxDetailChars === "number" && raw.maxDetailChars > 0) {
    out.maxDetailChars = Math.floor(raw.maxDetailChars);
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

/** Read defaults < global < project. */
export function loadSettings(cwd = process.cwd(), env = process.env): Settings {
  const global = readSettingsFile(globalSettingsPath(env));
  const project = readSettingsFile(projectSettingsPath(cwd));
  return coerce(project[SETTINGS_KEY], coerce(global[SETTINGS_KEY], DEFAULTS));
}

/**
 * One-time migration of the old `/quiet` preference.
 *
 * Returns a value only when settings.json has no `groupToolRuns` yet, so an
 * explicit new setting always wins and a stale legacy file cannot resurrect a
 * preference the user has since changed.
 */
export function migratedQuiet(env = process.env): boolean | undefined {
  const existing = readSettingsFile(globalSettingsPath(env))[SETTINGS_KEY];
  if (isRecord(existing) && typeof existing.groupToolRuns === "boolean") return undefined;
  try {
    const legacy = JSON.parse(readFileSync(legacyQuietPath(env), "utf8"));
    return isRecord(legacy) && legacy.quiet === true ? true : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export type SaveResult =
  | { ok: true }
  | { ok: false; reason: "comments" | "unparsable" | "write"; detail?: string };

/**
 * Persist the basic settings into the GLOBAL settings.json.
 *
 * Only the `minimalist` key is touched, and only its basic keys, so a
 * hand-written `glyphs`/`tokens`/`excludeTools` block survives untouched.
 *
 * REFUSES to write a file containing comments. `JSON.stringify` would silently
 * delete them, and quietly destroying an annotated config is far worse than
 * asking the user to edit one line by hand.
 */
export function saveBasicSettings(settings: Settings, env = process.env): SaveResult {
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

  const existing = isRecord(root[SETTINGS_KEY]) ? (root[SETTINGS_KEY] as Json) : {};
  const merged: Json = { ...existing };
  for (const key of BASIC_KEYS) merged[key] = settings[key];

  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ ...root, [SETTINGS_KEY]: merged }, null, 2)}\n`);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: "write", detail: String(error) };
  }
}
