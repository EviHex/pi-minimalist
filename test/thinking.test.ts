import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { allPurpleThinkingTheme, createThinkingPreview } from "../src/thinking.ts";
import { fakeTheme, fakeTimers, plain, plainTheme } from "../test/test-support.ts";

// Token assertions use the naming theme; layout/width assertions use the
// zero-width one, because fake markup would consume real columns.
const theme = fakeTheme();
const widthTheme = plainTheme();
const preview = createThinkingPreview(fakeTimers());

describe("thinking preview", () => {
  it("shows a running dot while streaming and a check when complete", () => {
    assert.deepEqual(preview("The user wants X", widthTheme, 0, true).render(80).map(plain), [
      " ▌ • think The user wants X",
    ]);
    assert.deepEqual(preview("The user wants X", widthTheme, 0, false).render(80).map(plain), [
      " ▌ ✓ think The user wants X",
    ]);
  });

  it("uses success for the glyph and label, toolTitle for the preview text", () => {
    assert.equal(
      preview("why", theme, 0, false).render(500)[0],
      " <thinkingText>▌</thinkingText> <success>✓</success> <thinkingText>think</thinkingText> <toolTitle>why</toolTitle>",
    );
  });

  it("highlights the row only while streaming", () => {
    assert.match(preview("x", theme, 0, true).render(500)[0], /\[toolPendingBg\]/);
    assert.doesNotMatch(preview("x", theme, 0, false).render(500)[0], /\[toolPendingBg\]/);
  });

  it("collapses multiline thinking into one line inside the width", () => {
    const text = "First thought.\n\nSecond thought.\n  Third.";
    const rendered = preview(text, widthTheme, 0, false).render(80);

    assert.equal(rendered.length, 1);
    assert.equal(plain(rendered[0]), " ▌ ✓ think First thought. Second thought. Third.");

    for (const width of [12, 40, 100]) {
      const line = preview("z".repeat(500), widthTheme, 0, false).render(width);
      assert.equal(line.length, 1, `width ${width}`);
      assert.ok(visibleWidth(line[0]) <= width, `width ${width}`);
    }
  });

  it("ignores the core pad argument (the gutter already positions the row)", () => {
    assert.deepEqual(preview("x", widthTheme, 0, false).render(40), preview("x", widthTheme, 8, false).render(40));
  });

  it("registers no ticker (defensive: the preview has no elapsed timer)", () => {
    // The preview is repainted by streaming text, so it must never start the
    // 1s interval. This is a guard for a future change, not current logic.
    const timers = fakeTimers();
    const line = createThinkingPreview(timers)("x", widthTheme, 0, true);
    line.render(40);
    assert.equal(line.isTicking(), false);
    assert.equal(timers.pending(), 0);
  });
});

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
