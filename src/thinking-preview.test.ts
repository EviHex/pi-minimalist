import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createThinkingPreview } from "./thinking-preview.ts";
import { fakeTheme, fakeTimers, plain, plainTheme } from "./test-support.ts";

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
      " <borderAccent>▌</borderAccent> <success>✓</success> <success>think</success> <toolTitle>why</toolTitle>",
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

  it("leaves no ticker registered", () => {
    const timers = fakeTimers();
    createThinkingPreview(timers)("x", widthTheme, 0, true).render(40);
    assert.equal(timers.pending(), 0);
  });
});
