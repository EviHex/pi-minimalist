import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allPurpleThinkingTheme } from "../src/thinking-theme.ts";
import { fakeTheme } from "./test-support.ts";

describe("allPurpleThinkingTheme", () => {
  it("overrides every color-bearing Markdown token and syntax highlighting", () => {
    const themed = allPurpleThinkingTheme({ bold: (text: string) => `*${text}*` }, fakeTheme()) as Record<string, any>;

    for (const key of ["heading", "link", "linkUrl", "code", "codeBlock", "codeBlockBorder", "quote", "quoteBorder", "hr", "listBullet"]) {
      assert.equal(themed[key](key), `<thinkingText>${key}</thinkingText>`, key);
    }
    assert.deepEqual(themed.highlightCode("const x = 1;\nreturn x", "ts"), [
      "<thinkingText>const x = 1;</thinkingText>",
      "<thinkingText>return x</thinkingText>",
    ]);
    assert.equal(themed.bold("bold"), "*bold*", "non-color style stays native");
  });
});
