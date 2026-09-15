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

/** Visible columns consumed by every gutter variant (space + block + space). */
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
export function gutter(theme: ThemeLike, token: ThemeColor = "success"): string {
  return ` ${theme.fg(token, "▌")} `;
}

/**
 * Gutter for expanded OUTPUT lines: same glyph and column as the call row but
 * dimmed, so the call row still reads as the block header.
 */
export function outputGutter(theme: ThemeLike): string {
  return ` ${theme.fg("borderMuted", "▌")} `;
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

export function labeledRow(theme: ThemeLike, spec: Labeled): Row {
  const labelColor = spec.labelColor ?? "success";
  const parts: string[] = [];
  if (spec.glyph) parts.push(theme.fg(spec.glyphColor ?? "success", spec.glyph));
  parts.push(theme.fg(labelColor, spec.label));
  if (spec.badge) parts.push(theme.fg("success", spec.badge));
  if (spec.details) parts.push(theme.fg("toolTitle", spec.details));
  return {
    // The gutter follows the label's hue, so thinking rows stay purple and tool
    // rows stay green without either caller naming a gutter color.
    gutter: gutter(theme, labelColor),
    text: parts.join(" "),
    highlight: spec.highlight ? (text) => theme.bg("toolPendingBg", text) : undefined,
  };
}

/** One folded tool/thinking name and how many times it ran in a quiet run. */
export type Count = { name: string; count: number };

/**
 * The single line a folded quiet run collapses to, e.g.
 * `✓ read ×2, edit ×1 · ✗ bash ×1`. Always green-guttered, even when it
 * replaces a purple thinking row: the summary belongs to the run, not to one
 * of its members.
 */
export function summaryRow(theme: ThemeLike, done: Count[], failed: Count[]): Row {
  const groups: string[] = [];
  if (done.length) groups.push(`${theme.fg("success", "✓")} ${countsText(theme, done, "success")}`);
  if (failed.length) groups.push(`${theme.fg("error", "✗")} ${countsText(theme, failed, "error")}`);
  return { gutter: gutter(theme), text: groups.join(theme.fg("toolTitle", " · ")) };
}

function countsText(theme: ThemeLike, counts: Count[], color: ThemeColor): string {
  return counts
    .map(({ name, count }) => {
      // Thinking keeps its purple language even inside a green quiet summary.
      const token = name === "think" && color === "success" ? "thinkingText" : color;
      return `${theme.fg(token, name)} ${theme.fg("toolTitle", `×${count}`)}`;
    })
    .join(theme.fg("toolTitle", ", "));
}
