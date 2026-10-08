/**
 * FEATURE 2: thinking blocks.
 *
 * Collapsed — one line replacing Pi's bare "Thinking..." label, installed as
 * `Bridge.thinkingPreview`:
 *
 *     • think The user wants me to…    ← while streaming
 *     ✓ think The user wants me to…    ← once the message completes
 *
 * Expanded (Ctrl+T) — Pi's native italic Markdown, but with every token-specific
 * color replaced by the thinking hue, as `Bridge.thinkingMarkdownTheme`.
 */

import { CompactLine, realTimers, type Timers } from "./components.ts";
import { Painter, type ThemeLike } from "./row.ts";
import type { RunGrouping } from "./run-grouping.ts";
import type { Config } from "./config.ts";

/** Core calls this with the full hidden thinking text plus a streaming flag. */
export type ThinkingPreview = (
  text: string,
  theme: ThemeLike,
  streaming?: boolean,
  owner?: object,
  runIndex?: number,
) => CompactLine;

export type ThinkingDeps = {
  config: Config;
  grouping: RunGrouping;
  timers?: Timers;
};

export function createThinkingPreview(deps: ThinkingDeps): ThinkingPreview {
  const { config, grouping } = deps;
  const timers = deps.timers ?? realTimers;

  return (text, theme, streaming, owner, runIndex) => {
    const line = new CompactLine(timers);

    // Takes no width: thinking has a single detail field, so CompactLine's
    // viewport-width truncation is the only budget it needs. Only the whitespace
    // collapse matters here, to keep the preview on one physical line.
    const paint = () => {
      const glyphs = config.glyphs();
      const tokens = config.tokens();
      // Core only installs this preview when thinkingAsToolCall is enabled.
      // Match tool-row styling; off keeps Pi's original thinking component.
      return new Painter(theme, config).labeled({
        glyph: streaming ? glyphs.running : glyphs.done,
        label: "think",
        labelColor: tokens.thinking,
        glyphColor: tokens.thinking,
        details: text.replace(/\s+/g, " ").trim(),
      });
    };

    if (owner && runIndex !== undefined) {
      const id = grouping.thinkingId(owner, runIndex);
      line.setRow(() => grouping.rowFor(id, new Painter(theme, config), paint), (onHeader) => grouping.click(id, onHeader));
    } else {
      line.setRow(paint);
    }
    return line;
  };
}

type MarkdownTheme = Record<string, unknown>;

/**
 * Keep Markdown structure and styles, but replace every token-specific color
 * with the thinking hue, so expanded thinking reads as one block of reasoning
 * rather than syntax-highlighted code.
 */
export function singleHueThinkingTheme(base: MarkdownTheme, theme: ThemeLike, config: Config): MarkdownTheme {
  const hue = (text: string) => theme.fg(config.tokens().thinking, text);
  return {
    ...base,
    heading: hue,
    link: hue,
    linkUrl: hue,
    code: hue,
    codeBlock: hue,
    codeBlockBorder: hue,
    quote: hue,
    quoteBorder: hue,
    hr: hue,
    listBullet: hue,
    codeBlockIndent:
      typeof base.codeBlockIndent === "string"
        ? // Strip existing color first: the indent arrives already themed, and
          // nesting color codes leaves the outer one active for the whole line.
          hue(base.codeBlockIndent.replace(/\x1b\[[0-9;]*m/g, ""))
        : base.codeBlockIndent,
    // cli-highlight injects its own token colors, so bypass it entirely.
    highlightCode: (code: string) => code.split("\n").map(hue),
  };
}
