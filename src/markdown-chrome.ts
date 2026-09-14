/**
 * Code-block and blockquote chrome via the public theme surface — no core patch.
 *
 * `MarkdownTheme.codeBlockBorder` / `.quoteBorder` are `(text) => string`, and
 * pi-tui passes the *literal* border text through them:
 *
 *   codeBlockBorder("```python")   // opening fence
 *   codeBlockBorder("```")         // closing fence
 *   quoteBorder("│ ")              // per quoted line
 *
 * Both are built by `getMarkdownTheme()` as `theme.fg(token, text)`, so
 * intercepting `Theme.fg` lets us *rewrite* the glyphs rather than only recolor
 * them. The vertical code edge rides on `codeBlockIndent`, a public
 * `MarkdownTheme` field fed by settings `markdown.codeBlockIndent` (set to
 * "│ ").
 *
 * Known cosmetic gap vs the old core patch: pi-tui prepends `codeBlockIndent`
 * verbatim and core builds it straight from settings, so the edge cannot be
 * themed from here — it renders in the default foreground while the corners use
 * `mdCodeBlockBorder`. Hardcoding an SGR escape in settings would colour it but
 * would not follow a theme switch, so the edge is left plain on purpose.
 *
 * Ambiguity: pi-tui emits `"```"` for BOTH a closing fence and an opening fence
 * that has no language. They are indistinguishable from inside `fg()`, so we
 * track fence parity. pi-tui walks tokens in order, synchronously, inside a
 * single `render()`, so parity is reliable there. It is NOT reliable across
 * components (each has its own token stream, and renders are cached), hence
 * `reset()` before each block — see `renderWithChrome`.
 */

/** Token that carries the code-fence text. */
const CODE_BORDER = "mdCodeBlockBorder";
/** Token that carries the blockquote gutter text. */
const QUOTE_BORDER = "mdQuoteBorder";

/** pi-tui's hardcoded blockquote gutter (pi-tui markdown.js: `quoteBorder("│ ")`). */
const PI_QUOTE_GUTTER = "│ ";
/** pi-tui's fence marker. */
const FENCE = "```";

export interface ChromeGlyphs {
	/** Opening fence, receives the language (may be empty). */
	open: (lang: string) => string;
	/** Closing fence. */
	close: string;
	/** Blockquote gutter. */
	quote: string;
}

export const DEFAULT_GLYPHS: ChromeGlyphs = {
	open: (lang) => `╭ ${lang || "code"}`,
	close: "╰",
	quote: "▌ ",
};

/**
 * Rewrites markdown border glyphs. Stateful only across a fence pair, and only
 * for the ambiguous bare-fence case.
 */
export class MarkdownChrome {
	private insideFence = false;
	private readonly glyphs: ChromeGlyphs;

	constructor(glyphs: ChromeGlyphs = DEFAULT_GLYPHS) {
		this.glyphs = glyphs;
	}

	/**
	 * Map a themed border string to its replacement.
	 * Returns the input unchanged when the token is not a markdown border.
	 */
	rewrite(token: string, text: string): string {
		if (token === QUOTE_BORDER) {
			return text === PI_QUOTE_GUTTER ? this.glyphs.quote : text;
		}
		if (token !== CODE_BORDER || !text.startsWith(FENCE)) return text;

		const lang = text.slice(FENCE.length).trim();
		// A fence carrying a language is unambiguously an opening fence.
		if (lang) {
			this.insideFence = true;
			return this.glyphs.open(lang);
		}
		// Bare "```": opening only when we are not already inside a fence.
		if (this.insideFence) {
			this.insideFence = false;
			return this.glyphs.close;
		}
		this.insideFence = true;
		return this.glyphs.open("");
	}

	/**
	 * Reset fence parity. Called before each independent markdown block so a
	 * throw mid-block, a cached render, or a truncated streaming fence cannot
	 * desync the next one.
	 */
	reset(): void {
		this.insideFence = false;
	}

	/** Test seam: current parity. */
	get open(): boolean {
		return this.insideFence;
	}
}

/** Minimal shape of the pieces of `Theme` we rely on. */
interface ThemeLike {
	fg(color: string, text: string): string;
}



/**
 * Wrap the live theme object in place so `getMarkdownTheme()`'s closures pick up
 * the new `fg` without replacing the instance. Replacing it (via
 * `ui.setTheme(instance)`) would set the theme name to `<in-memory>` and break
 * `/theme` plus custom-theme file watching.
 *
 * Idempotent: re-wrapping an already-wrapped theme is a no-op, so `/reload` and
 * theme switches cannot stack interceptors.
 */
const WRAPPED = Symbol.for("pi.minimalist.markdownChrome");

export function installMarkdownChrome(
	live: ThemeLike,
	glyphs: ChromeGlyphs = DEFAULT_GLYPHS,
): MarkdownChrome | undefined {
	const holder = live as ThemeLike & { [WRAPPED]?: MarkdownChrome };
	if (holder[WRAPPED]) return holder[WRAPPED];

	const chrome = new MarkdownChrome(glyphs);
	const base = live.fg.bind(live);
	Object.defineProperty(live, "fg", {
		value: (color: string, text: string): string =>
			base(color, chrome.rewrite(color, text)),
		configurable: true,
		writable: true,
	});
	Object.defineProperty(live, WRAPPED, {
		value: chrome,
		configurable: true,
	});
	return chrome;
}
