import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	DEFAULT_GLYPHS,
	installMarkdownChrome,
	MarkdownChrome,
} from "../src/markdown-chrome.ts";

/** pi-tui calls these exact strings (pi-tui markdown.js lines 384/398/450). */
const codeOpen = (lang: string) => `\`\`\`${lang}`;
const CODE_CLOSE = "```";
const QUOTE = "│ ";

describe("markdown-chrome glyph rewriting", () => {
	it("rewrites a fence carrying a language", () => {
		const c = new MarkdownChrome();
		assert.equal(c.rewrite("mdCodeBlockBorder", codeOpen("python")), "╭ python");
		assert.equal(c.rewrite("mdCodeBlockBorder", CODE_CLOSE), "╰");
	});

	it("rewrites a BARE opening fence as open, not close", () => {
		// This is the case that a naive length check gets wrong.
		const c = new MarkdownChrome();
		assert.equal(c.rewrite("mdCodeBlockBorder", codeOpen("")), "╭ code");
		assert.equal(c.rewrite("mdCodeBlockBorder", CODE_CLOSE), "╰");
	});

	it("alternates correctly across consecutive bare blocks", () => {
		const c = new MarkdownChrome();
		const seen = [
			c.rewrite("mdCodeBlockBorder", codeOpen("")),
			c.rewrite("mdCodeBlockBorder", CODE_CLOSE),
			c.rewrite("mdCodeBlockBorder", codeOpen("")),
			c.rewrite("mdCodeBlockBorder", CODE_CLOSE),
		];
		assert.deepEqual(seen, ["╭ code", "╰", "╭ code", "╰"]);
	});

	it("a language fence resets parity even if a close was missed (streaming)", () => {
		const c = new MarkdownChrome();
		c.rewrite("mdCodeBlockBorder", codeOpen("js")); // opened, never closed
		// Next block starts with a language -> unambiguously an opener.
		assert.equal(c.rewrite("mdCodeBlockBorder", codeOpen("go")), "╭ go");
		assert.equal(c.open, true);
	});

	it("reset() clears parity so a truncated block cannot desync the next", () => {
		const c = new MarkdownChrome();
		c.rewrite("mdCodeBlockBorder", codeOpen("")); // truncated: no close
		c.reset();
		assert.equal(c.rewrite("mdCodeBlockBorder", codeOpen("")), "╭ code");
	});

	it("rewrites the blockquote gutter", () => {
		const c = new MarkdownChrome();
		assert.equal(c.rewrite("mdQuoteBorder", QUOTE), "▌ ");
	});

	it("leaves unrelated tokens and unrelated text untouched", () => {
		const c = new MarkdownChrome();
		assert.equal(c.rewrite("mdHeading", "# hi"), "# hi");
		assert.equal(c.rewrite("mdCodeBlockBorder", "not a fence"), "not a fence");
		// A quote token whose text is not pi-tui's gutter is passed through.
		assert.equal(c.rewrite("mdQuoteBorder", "> "), "> ");
	});

	it("does not treat inline code token as a fence", () => {
		const c = new MarkdownChrome();
		assert.equal(c.rewrite("mdCode", "```"), "```");
		assert.equal(c.open, false);
	});
});

describe("installMarkdownChrome", () => {
	const makeTheme = () => {
		const calls: Array<[string, string]> = [];
		const theme = {
			fg(color: string, text: string) {
				calls.push([color, text]);
				return text;
			},
		};
		return { theme, calls };
	};

	it("wraps fg so the theme receives rewritten glyphs", () => {
		const { theme, calls } = makeTheme();
		installMarkdownChrome(theme);
		theme.fg("mdCodeBlockBorder", codeOpen("rust"));
		theme.fg("mdQuoteBorder", QUOTE);
		assert.deepEqual(calls, [
			["mdCodeBlockBorder", "╭ rust"],
			["mdQuoteBorder", "▌ "],
		]);
	});

	it("preserves the original coloring behaviour", () => {
		const theme = { fg: (color: string, text: string) => `<${color}>${text}` };
		installMarkdownChrome(theme);
		// Open then close: the close is only identifiable once a fence is open.
		assert.equal(theme.fg("mdCodeBlockBorder", codeOpen("go")), "<mdCodeBlockBorder>╭ go");
		assert.equal(theme.fg("mdCodeBlockBorder", CODE_CLOSE), "<mdCodeBlockBorder>╰");
	});

	it("is idempotent — re-install does not stack interceptors", () => {
		const { theme, calls } = makeTheme();
		const first = installMarkdownChrome(theme);
		const second = installMarkdownChrome(theme);
		assert.equal(first, second);
		theme.fg("mdQuoteBorder", QUOTE);
		assert.deepEqual(calls, [["mdQuoteBorder", "▌ "]]);
	});

	it("honours custom glyphs", () => {
		const { theme, calls } = makeTheme();
		installMarkdownChrome(theme, {
			...DEFAULT_GLYPHS,
			quote: "| ",
			close: "+",
		});
		theme.fg("mdQuoteBorder", QUOTE);
		theme.fg("mdCodeBlockBorder", codeOpen("c")); // open
		theme.fg("mdCodeBlockBorder", CODE_CLOSE); // close
		assert.deepEqual(calls, [
			["mdQuoteBorder", "| "],
			["mdCodeBlockBorder", "╭ c"],
			["mdCodeBlockBorder", "+"],
		]);
	});
});
