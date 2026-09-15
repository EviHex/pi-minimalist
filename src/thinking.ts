/**
 * FEATURE 2: thinking blocks.
 *
 * Collapsed — one NON-italic line replacing Pi's bare "Thinking..." label, on
 * Symbol.for("pi.thinkingPreview"):
 *
 *     • think The user wants me to…    ← while streaming (row highlighted)
 *     ✓ think The user wants me to…    ← once the message completes
 *
 * Expanded (Ctrl+T) — native italic Markdown, but with every token-specific
 * color replaced by thinkingText purple, on Symbol.for("pi.thinkingMarkdownTheme").
 */

import { CompactLine, realTimers, type Timers } from "./components.ts";
import { labeledRow, type ThemeLike } from "./row.ts";
import { QuietMode } from "./quiet-mode.ts";
import { Config, DEFAULTS } from "./config.ts";

/** Core calls this with the full hidden thinking text plus a streaming flag. */
export type ThinkingPreview = (
  text: string,
  theme: ThemeLike,
  pad: number,
  streaming?: boolean,
  owner?: object,
  runIndex?: number,
) => CompactLine;

export function createThinkingPreview(
  timers: Timers = realTimers,
  quiet?: QuietMode,
  config: Config = new Config(DEFAULTS),
): ThinkingPreview {
  // `pad` is part of the core bridge signature but unused: the gutter already
  // positions the row, so honoring pad too would double-indent it.
  return (text, theme, _pad, streaming, owner, runIndex) => {
    const line = new CompactLine(timers);
    // Takes no width: thinking has a single detail field, so CompactLine's
    // viewport-width truncation is the only budget it needs.
    const base = () => {
      const glyphs = config.glyphs();
      const tokens = config.tokens();
      // `thinkingAsToolCall` makes a collapsed thinking row indistinguishable
      // from a tool row: same green label and gutter, no highlight while
      // streaming. Off (default) it keeps the purple thinking hue, so collapsed
      // and expanded thinking share one visual language.
      const asTool = config.get("thinkingAsToolCall");
      const glyph = streaming ? glyphs.running : glyphs.done;
      // Thinking is a SINGLE field, so it needs no width budget: CompactLine
      // truncates at the real viewport width. Only the whitespace collapse
      // matters here, to keep the preview on one physical line.
      return labeledRow(theme, {
        glyph,
        label: "think",
        labelColor: asTool ? tokens.label : tokens.thinking,
        details: text.replace(/\s+/g, " ").trim(),
        highlight: asTool ? false : streaming,
      }, config);
    };

    if (quiet && owner && runIndex !== undefined) {
      const id = quiet.thinkingId(owner, runIndex);
      line.setRow(() => quiet.rowFor(id, theme, base));
    } else {
      line.setRow(base);
    }
    return line;
  };
}

type MarkdownTheme = Record<string, unknown>;

/** Keep Markdown structure/styles, but remove every token-specific color. */
export function allPurpleThinkingTheme(base: MarkdownTheme, theme: ThemeLike): MarkdownTheme {
  const purple = (text: string) => theme.fg("thinkingText", text);
  return {
    ...base,
    heading: purple,
    link: purple,
    linkUrl: purple,
    code: purple,
    codeBlock: purple,
    codeBlockBorder: purple,
    quote: purple,
    quoteBorder: purple,
    hr: purple,
    listBullet: purple,
    codeBlockIndent:
      typeof base.codeBlockIndent === "string"
        ? purple(base.codeBlockIndent.replace(/\x1b\[[0-9;]*m/g, ""))
        : base.codeBlockIndent,
    // cli-highlight injects its own token colors, so bypass it entirely.
    highlightCode: (code: string) => code.split("\n").map(purple),
  };
}
