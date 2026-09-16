/**
 * The row data model, and the ONLY place that turns a row into colored text.
 *
 * TWO RULES THIS FILE ENFORCES
 * ---------------------------
 * 1. Rows are described as DATA and painted exactly once. Nothing downstream may
 *    re-parse painted text. An earlier version built `"read src/a.ts"` and then
 *    split it on the first space to recolor the action word, which silently
 *    assumed no label ever contains a space; run summaries were joined into
 *    `"read ×2, edit ×1"` and split back apart the same way.
 *
 * 2. Theme and settings are bound ONCE, in a `Painter`. There used to be a
 *    module-level mutable config with `config = defaultConfig()` defaults on four
 *    functions, which made painting depend on load order and let one test leak
 *    settings into the next.
 *
 * Free of Pi extension-API runtime imports, so tests exercise real painting
 * without an extension runtime.
 */

// Type-only: erased at runtime, but makes a mistyped token ("succes") a compile
// error instead of a theme.fg() throw that core turns into a verbose card.
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import type { Config } from "./config.ts";

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

/** One painted row. `text` is already colored; truncation happens at render. */
export type Row = {
  /** Pre-colored left marker, or "" when the gutter is disabled. */
  gutter: string;
  /** Fully colored row content. */
  text: string;
  /** Full-width background, applied after truncation. */
  highlight?: (text: string) => string;
};

/**
 * Visible columns a gutter occupies: one space, the glyph, one space.
 *
 * DERIVED from the row's own gutter text, never configured. An earlier design
 * exported this as a constant, which could disagree with the real glyph width and
 * shift every row.
 */
export function gutterWidth(gutter: string): number {
  return gutter === "" ? 0 : 3;
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

/** One folded name and how many times it appeared in a run. */
export type Count = { name: string; count: number };

/**
 * What a folded run collapses to, grouped by outcome.
 *
 * `running` is a group of its own because a still-running row folds by default.
 * Without it, a folded running call was counted nowhere and simply vanished from
 * the transcript until it finished.
 *
 * An object rather than three positional arrays: they are the same type, so
 * transposing two of them would have been silent.
 */
export type RunSummary = {
  done: Count[];
  failed: Count[];
  running: Count[];
};

export const EMPTY_SUMMARY: RunSummary = { done: [], failed: [], running: [] };

/**
 * Paints rows for one theme and one settings object.
 *
 * Created per render pass, so `/theme` and every setting toggle are picked up
 * without any shared mutable state.
 */
export class Painter {
  private theme: ThemeLike;
  private config: Config;

  constructor(theme: ThemeLike, config: Config) {
    this.theme = theme;
    this.config = config;
  }

  /**
   * Vertical bar at the left of a compact row. Model prose stays flush left, so a
   * run of tool rows reads as one indented block instead of same-weight lines
   * mixed into text. Indented one column so the bar sits inside the text area.
   */
  gutter(token: ThemeColor = this.config.tokens().label): string {
    if (!this.config.get("gutter")) return "";
    return ` ${this.theme.fg(token, this.config.glyphs().gutter)} `;
  }

  /**
   * Gutter for expanded OUTPUT lines: same glyph and column as the call row but
   * dimmed, so the call row still reads as the block header.
   */
  outputGutter(): string {
    if (!this.config.get("gutter")) return "";
    const { outputGutter } = this.config.tokens();
    return ` ${this.theme.fg(outputGutter, this.config.glyphs().gutter)} `;
  }

  labeled(spec: Labeled): Row {
    const tokens = this.config.tokens();
    const labelColor = spec.labelColor ?? tokens.label;
    const parts: string[] = [];
    if (spec.glyph) parts.push(this.theme.fg(spec.glyphColor ?? tokens.label, spec.glyph));
    parts.push(this.theme.fg(labelColor, spec.label));
    if (spec.badge) parts.push(this.theme.fg(tokens.label, spec.badge));
    if (spec.details) parts.push(this.theme.fg(tokens.details, spec.details));
    return {
      // The gutter follows the label's hue, so thinking rows stay purple and tool
      // rows stay green without either caller naming a gutter color.
      gutter: this.gutter(labelColor),
      text: parts.join(" "),
      highlight: spec.highlight ? (text) => this.theme.bg(tokens.activeBg, text) : undefined,
    };
  }

  /**
   * The single line a folded run collapses to, e.g.
   * `✓ read ×2, edit ×1 · ✗ bash ×1 · • bash ×1`.
   *
   * Always label-colored, even when it replaces a purple thinking row: the
   * summary belongs to the run, not to one of its members.
   */
  summary(summary: RunSummary): Row {
    const { label, details, error } = this.config.tokens();
    const glyphs = this.config.glyphs();
    const groups = [
      { counts: summary.done, glyph: glyphs.done, token: label },
      { counts: summary.failed, glyph: glyphs.failed, token: error },
      { counts: summary.running, glyph: glyphs.running, token: label },
    ]
      .filter((group) => group.counts.length > 0)
      .map((group) => `${this.theme.fg(group.token, group.glyph)} ${this.counts(group.counts, group.token)}`);

    return { gutter: this.gutter(label), text: groups.join(this.theme.fg(details, " · ")) };
  }

  private counts(counts: Count[], color: ThemeColor): string {
    const tokens = this.config.tokens();
    const glyphs = this.config.glyphs();
    return counts
      .map(({ name, count }) => {
        // Thinking keeps its own hue inside a summary — unless it is configured to
        // behave exactly like a tool, in which case it should look like one too.
        const keepsThinkingHue =
          name === "think" && color === tokens.label && !this.config.get("thinkingAsToolCall");
        const token = keepsThinkingHue ? tokens.thinking : color;
        return `${this.theme.fg(token, name)} ${this.theme.fg(tokens.details, `${glyphs.count}${count}`)}`;
      })
      .join(this.theme.fg(tokens.details, ", "));
  }
}
