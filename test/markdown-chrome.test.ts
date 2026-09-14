import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { installMarkdownChrome } from "../src/markdown-chrome.ts";

function theme() {
  const calls: Array<[string, string]> = [];
  return {
    calls,
    value: {
      fg(token: string, text: string) {
        calls.push([token, text]);
        return `<${token}>${text}`;
      },
    },
  };
}

describe("installMarkdownChrome", () => {
  it("rewrites language and bare code fences", () => {
    const { value } = theme();
    installMarkdownChrome(value);

    assert.equal(value.fg("mdCodeBlockBorder", "```ts"), "<mdCodeBlockBorder>╭ ts");
    assert.equal(value.fg("mdCodeBlockBorder", "```"), "<mdCodeBlockBorder>╰");
    assert.equal(value.fg("mdCodeBlockBorder", "```"), "<mdCodeBlockBorder>╭ code");
    assert.equal(value.fg("mdCodeBlockBorder", "```"), "<mdCodeBlockBorder>╰");
  });

  it("rewrites only pi-tui's blockquote gutter", () => {
    const { value } = theme();
    installMarkdownChrome(value);

    assert.equal(value.fg("mdQuoteBorder", "│ "), "<mdQuoteBorder>▌ ");
    assert.equal(value.fg("mdQuoteBorder", "> "), "<mdQuoteBorder>> ");
    assert.equal(value.fg("mdCode", "```"), "<mdCode>```");
  });

  it("keeps original coloring and installs once", () => {
    const { value, calls } = theme();
    installMarkdownChrome(value);
    installMarkdownChrome(value);
    value.fg("mdQuoteBorder", "│ ");

    assert.deepEqual(calls, [["mdQuoteBorder", "▌ "]]);
  });
});
