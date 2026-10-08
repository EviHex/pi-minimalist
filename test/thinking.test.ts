import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createThinkingPreview, singleHueThinkingTheme } from "../src/thinking.ts";
import { fakeTheme, fakeTimers, plain, plainTheme, testConfig, testState } from "../test/test-support.ts";

// Token assertions use the naming theme; layout/width assertions use the
// zero-width one, because fake markup would consume real columns.
const theme = fakeTheme();
const widthTheme = plainTheme();
const preview = createThinkingPreview({ ...testState({ thinkingAsToolCall: true }), timers: fakeTimers() });

describe("thinking preview", () => {
  it("shows a running dot while streaming and a check when complete", () => {
    assert.deepEqual(preview("The user wants X", widthTheme, true).render(80).map(plain), [
      " ▌ • think The user wants X",
    ]);
    assert.deepEqual(preview("The user wants X", widthTheme, false).render(80).map(plain), [
      " ▌ ✓ think The user wants X",
    ]);
  });

  it("uses the thinking colour for the glyph and label, toolTitle for the preview text", () => {
    assert.equal(
      preview("why", theme, false).render(500)[0],
      " <thinkingText>▌</thinkingText> <thinkingText>✓</thinkingText> <thinkingText>think</thinkingText> <toolTitle>why</toolTitle>",
    );
  });

  it("collapses multiline thinking into one line inside the width", () => {
    const text = "First thought.\n\nSecond thought.\n  Third.";
    const rendered = preview(text, widthTheme, false).render(80);

    assert.equal(rendered.length, 1);
    assert.equal(plain(rendered[0]), " ▌ ✓ think First thought. Second thought. Third.");

    for (const width of [12, 40, 100]) {
      const line = preview("z".repeat(500), widthTheme, false).render(width);
      assert.equal(line.length, 1, `width ${width}`);
      assert.ok(visibleWidth(line[0]) <= width, `width ${width}`);
    }
  });

  it("opens a run summary it hosts on a left click", () => {
    const state = testState({ thinkingAsToolCall: true, groupToolRuns: true });
    const owner = {};
    state.grouping.observe("r1", "read", "success", false);
    state.grouping.observeThinking(owner, 0, true, false);
    const line = createThinkingPreview({ ...state, timers: fakeTimers() })("why", widthTheme, false, owner, 0);
    const click = { type: "click", button: "left" } as Parameters<typeof line.handleMouse>[0];

    assert.equal(plain(line.render(80)[0]), " ▌ ✓ read ×1, think ×1");
    assert.deepEqual(line.handleMouse(click), { handled: true });
    assert.equal(plain(line.render(80)[0]), " ▌ ✓ think why");
    assert.equal(line.handleMouse(click), undefined, "an opened row leaves the click to Pi");
  });

  it("registers no ticker (defensive: the preview has no elapsed timer)", () => {
    // The preview is repainted by streaming text, so it must never start the
    // 1s interval. This is a guard for a future change, not current logic.
    const timers = fakeTimers();
    const line = createThinkingPreview({ ...testState({ thinkingAsToolCall: true }), timers })("x", widthTheme, true);
    line.render(40);
    assert.equal(timers.pending(), 0);
  });
});

describe("singleHueThinkingTheme", () => {
  it("overrides every color-bearing Markdown token and syntax highlighting", () => {
    const themed = singleHueThinkingTheme(
      { bold: (text: string) => `*${text}*`, codeBlockIndent: "\x1b[38;2;128;128;128m│ \x1b[39m" },
      fakeTheme(),
      testConfig(),
    ) as Record<string, any>;

    for (const key of ["heading", "link", "linkUrl", "code", "codeBlock", "codeBlockBorder", "quote", "quoteBorder", "hr", "listBullet"]) {
      assert.equal(themed[key](key), `<thinkingText>${key}</thinkingText>`, key);
    }
    assert.equal(themed.codeBlockIndent, "<thinkingText>│ </thinkingText>");
    assert.deepEqual(themed.highlightCode("const x = 1;\nreturn x", "ts"), [
      "<thinkingText>const x = 1;</thinkingText>",
      "<thinkingText>return x</thinkingText>",
    ]);
    assert.equal(themed.bold("bold"), "*bold*", "non-color style stays native");
  });
});
