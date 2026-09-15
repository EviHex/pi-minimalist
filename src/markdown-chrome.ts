/** Markdown frame glyphs via Theme.fg; pi-tui itself stays unpatched. */

const INSTALLED = Symbol.for("pi.minimalist.markdownChrome");
const LIVE_THEME = Symbol.for("@earendil-works/pi-coding-agent:theme");
const CODE_BORDER = "mdCodeBlockBorder";
const QUOTE_BORDER = "mdQuoteBorder";
const FENCE = "```";

type Theme = {
  fg(color: string, text: string): string;
  [INSTALLED]?: boolean;
};

/**
 * pi-tui passes literal frame text through Theme.fg. Rewrite it before the
 * original fg method colors it. Bare opening and closing fences are both
 * "```", so parity distinguishes them; pi-tui renders every code token as one
 * synchronous open/close pair.
 */
export function installMarkdownChrome(theme: Theme): void {
  if (theme[INSTALLED]) return;

  let insideFence = false;
  const color = theme.fg.bind(theme);
  theme.fg = (token, text) => {
    if (token === QUOTE_BORDER && text === "│ ") text = "▌ ";
    if (token === CODE_BORDER && text.startsWith(FENCE)) {
      const language = text.slice(FENCE.length).trim();
      if (language) {
        insideFence = true;
        text = `╭ ${language}`;
      } else {
        text = insideFence ? "╰" : "╭ code";
        insideFence = !insideFence;
      }
    }
    return color(token, text);
  };
  theme[INSTALLED] = true;
}

/**
 * Wrap Pi's LIVE theme object in place.
 *
 * Passing a new instance to ui.setTheme() would set the theme name to
 * "<in-memory>", disabling /theme and custom-theme file watching. Safe and cheap
 * to call repeatedly (idempotent per object), which is required because /theme
 * installs a fresh Theme that must be re-wrapped.
 */
export function installLiveThemeChrome(): void {
  const live = (globalThis as Record<symbol, unknown>)[LIVE_THEME] as Theme | undefined;
  if (live) installMarkdownChrome(live);
}
