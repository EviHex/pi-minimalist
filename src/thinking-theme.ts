/** Markdown overrides used only for expanded thinking blocks. */
import type { ThemeLike } from "./components.ts";

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
    // cli-highlight injects its own token colors, so bypass it entirely.
    highlightCode: (code: string) => code.split("\n").map(purple),
  };
}
