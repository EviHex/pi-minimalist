/**
 * The row data model, and the ONLY place that turns a row into colored text.
 *
 * Rows are described as DATA and painted exactly once. Nothing downstream may
 * re-parse painted text: an earlier version built `"read src/a.ts"`, then split
 * it on the first space to recolor the action word, which silently depended on
 * every label being space-free. Same for quiet summaries, which were joined
 * into `"read ×2, edit ×1"` and split back apart to color the names.
 *
 * Free of Pi extension-API runtime imports, so tests exercise real painting
 * without an extension runtime.
 */

// Type-only: erased at runtime, but makes a mistyped token ("succes") a compile
// error instead of a theme.fg() throw that core turns into a verbose card.
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { Config, DEFAULTS, type Glyphs, type Tokens } from "./config.ts";

// ThemeBg is not exported publicly, so recover it from Theme.bg's own signature
// rather than importing a deep dist path (which is not a package export).
type ThemeBg = Parameters<Theme["bg"]>[0];

/**
 * Minimal theme surface. Pi's real Theme satisfies it; tests pass a fake that
 * renders `<token>text</token>` so assertions name the token instead of
 * depending on the machine's palette.
 *
 * Method shorthand (not property-with-function-type) on purpose: methods are
 * bivariant, so Pi's Theme stays assignable under strictFunctionTypes.
 */
export type ThemeLike = {
  fg(token: ThemeColor, text: string): string;
  bg(token: ThemeBg, text: string): string;
};

/**
 * Visible columns a gutter consumes: one space, the glyph, one space.
 *
 * DERIVED, never configured. An earlier design exposed this as a number, which
 * let it disagree with the glyph's real width and shifted every row. Callers
 * pass the row's own gutter text so width and content cannot drift apart.
 */
export function gutterWidth(gutter: string): number {
  return gutter.length === 0 ? 0 : 3;
}

/** Back-compat constant for the default single-column gutter glyph. */
export const GUTTER_WIDTH = 3;

/** One painted row. `text` is already colored; truncation happens at render. */
export type Row = {
  /** Pre-colored left marker, GUTTER_WIDTH columns wide. */
  gutter: string;
  /** Fully colored row content. */
  text: string;
  /** Full-width background, applied after truncation. */
  highlight?: (text: string) => string;
};

/**
 * Dim vertical bar at the left of every compact row. Model prose stays flush
 * left, so a run of tool rows reads as one indented block instead of
 * same-weight lines mixed into text.
 *
 * Indented one column so the bar sits inside the text area. Tokens must be
 * native Pi theme colors — a custom key makes theme.fg() throw.
 */
export function gutter(theme: ThemeLike, token: ThemeColor = "success", config = defaultConfig()): string {
  if (!config.get("gutter")) return "";
  return ` ${theme.fg(token, config.glyphs().gutter)} `;
}

/**
 * Gutter for expanded OUTPUT lines: same glyph and column as the call row but
 * dimmed, so the call row still reads as the block header.
 */
export function outputGutter(theme: ThemeLike, config = defaultConfig()): string {
  if (!config.get("gutter")) return "";
  return ` ${theme.fg(config.tokens().outputGutter, config.glyphs().gutter)} `;
}

/**
 * Config used when a caller passes none.
 *
 * Rows are painted from many places; threading a Config through every one of
 * them would be noise. Tests and the extension pass an explicit instance, so
 * this fallback only matters for direct/legacy calls.
 */
let fallbackConfig: Config | undefined;
function defaultConfig(): Config {
  return (fallbackConfig ??= new Config(DEFAULTS));
}

/** Point row painting at the live config (called once at extension load). */
export function useConfig(config: Config): void {
  fallbackConfig = config;
}

/**
 * A `glyph label [badge] details` row — the shared grammar of tool calls
 * (`✓ read src/a.ts`) and thinking previews (`• think The user wants…`).
 * Segments are colored independently and joined with single spaces; an absent
 * segment leaves no stray space behind.
 */
export type Labeled = {
  /** Status glyph: `›` queued, `•` running, `✓` done, `✗` failed. */
  glyph?: string;
  glyphColor?: ThemeColor;
  /** Action word: a tool name, or "think". Also picks the gutter color. */
  label: string;
  labelColor?: ThemeColor;
  /** Elapsed-timer badge, between label and details. */
  badge?: string;
  /** Path, command, or preview text. */
  details?: string;
  /** Highlight the row background (streaming thinking only). */
  highlight?: boolean;
};

export function labeledRow(theme: ThemeLike, spec: Labeled, config = defaultConfig()): Row {
  const tokens = config.tokens();
  const labelColor = spec.labelColor ?? tokens.label;
  const parts: string[] = [];
  if (spec.glyph) parts.push(theme.fg(spec.glyphColor ?? tokens.label, spec.glyph));
  parts.push(theme.fg(labelColor, spec.label));
  if (spec.badge) parts.push(theme.fg(tokens.label, spec.badge));
  if (spec.details) parts.push(theme.fg(tokens.details, spec.details));
  return {
    // The gutter follows the label's hue, so thinking rows stay purple and tool
    // rows stay green without either caller naming a gutter color.
    gutter: gutter(theme, labelColor, config),
    text: parts.join(" "),
    highlight: spec.highlight ? (text) => theme.bg(tokens.activeBg, text) : undefined,
  };
}

/** One folded tool/thinking name and how many times it ran in a quiet run. */
export type Count = { name: string; count: number };

/**
 * The single line a folded quiet run collapses to, e.g.
 * `✓ read ×2, edit ×1 · ✗ bash ×1 · • bash ×1`. Always green-guttered, even
 * when it replaces a purple thinking row: the summary belongs to the run, not to
 * one of its members.
 *
 * `running` exists because a still-running row folds by default. Without its own
 * group a folded running call was counted nowhere and simply vanished from the
 * transcript until it finished.
 */
export function summaryRow(
  theme: ThemeLike,
  done: Count[],
  failed: Count[],
  running: Count[] = [],
  config = defaultConfig(),
): Row {
  const { label, details, error } = config.tokens();
  const glyphs = config.glyphs();
  const groups: string[] = [];
  if (done.length) groups.push(`${theme.fg(label, glyphs.done)} ${countsText(theme, done, label, config)}`);
  if (failed.length) groups.push(`${theme.fg(error, glyphs.failed)} ${countsText(theme, failed, error, config)}`);
  if (running.length) groups.push(`${theme.fg(label, glyphs.running)} ${countsText(theme, running, label, config)}`);
  return { gutter: gutter(theme, label, config), text: groups.join(theme.fg(details, " · ")) };
}

function countsText(theme: ThemeLike, counts: Count[], color: ThemeColor, config: Config): Row["text"] {
  const tokens = config.tokens();
  const glyphs = config.glyphs();
  return counts
    .map(({ name, count }) => {
      // Thinking keeps its purple language inside a green quiet summary — unless
      // it is configured to behave exactly like a tool, in which case it should
      // look like one too.
      const isThinking = name === "think" && color === tokens.label && !config.get("thinkingAsToolCall");
      const token = isThinking ? tokens.thinking : color;
      return `${theme.fg(token, name)} ${theme.fg(tokens.details, `${glyphs.count}${count}`)}`;
    })
    .join(theme.fg(tokens.details, ", "));
}
