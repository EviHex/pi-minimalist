import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GUTTER_WIDTH, gutter, labeledRow, outputGutter, summaryRow } from "../src/row.ts";
import { fakeTheme, plain } from "./test-support.ts";

const theme = fakeTheme();

describe("gutters", () => {
  it("uses success for call rows and borderMuted for output", () => {
    assert.equal(gutter(theme), " <success>▌</success> ");
    assert.equal(outputGutter(theme), " <borderMuted>▌</borderMuted> ");
    assert.equal(plain(gutter(theme)).length, GUTTER_WIDTH);
  });
});

describe("labeledRow", () => {
  it("colors the label green and the details with toolTitle", () => {
    const row = labeledRow(theme, { glyph: "✓", label: "read", details: "a.ts" });
    assert.equal(row.text, "<success>✓</success> <success>read</success> <toolTitle>a.ts</toolTitle>");
    assert.equal(row.gutter, " <success>▌</success> ", "gutter follows the label color");
    assert.equal(row.highlight, undefined);
  });

  it("places the badge between the label and the details", () => {
    const row = labeledRow(theme, { glyph: "•", label: "bash", badge: "[⏱ 3s]", details: "sleep 5" });
    assert.equal(plain(row.text), "• bash [⏱ 3s] sleep 5");
  });

  it("omits absent segments without leaving a stray space", () => {
    assert.equal(plain(labeledRow(theme, { label: "bash", details: "ls" }).text), "bash ls");
    assert.equal(plain(labeledRow(theme, { glyph: "✓", label: "ls" }).text), "✓ ls");
    assert.equal(plain(labeledRow(theme, { glyph: "✓", label: "bash", badge: "", details: "" }).text), "✓ bash");
  });

  it("colors the glyph independently of the label", () => {
    const row = labeledRow(theme, { glyph: "✗", glyphColor: "error", label: "bash", details: "false" });
    assert.ok(row.text.startsWith("<error>✗</error>"), row.text);
    assert.ok(row.text.includes("<success>bash</success>"));
  });

  it("takes its gutter from the label color, so thinking stays purple", () => {
    const row = labeledRow(theme, { glyph: "✓", label: "think", labelColor: "thinkingText", details: "why" });
    assert.equal(row.gutter, " <thinkingText>▌</thinkingText> ");
    assert.equal(
      row.text,
      "<success>✓</success> <thinkingText>think</thinkingText> <toolTitle>why</toolTitle>",
    );
  });

  it("supplies a background wrapper only when highlighted", () => {
    assert.equal(labeledRow(theme, { label: "think", highlight: false }).highlight, undefined);
    const row = labeledRow(theme, { label: "think", highlight: true });
    assert.equal(row.highlight?.("x"), "[toolPendingBg]x[/toolPendingBg]");
  });
});

describe("summaryRow", () => {
  it("keeps names in the action color and counts dim", () => {
    const row = summaryRow(theme, [{ name: "read", count: 2 }, { name: "edit", count: 1 }], []);
    assert.equal(
      row.text,
      "<success>✓</success> <success>read</success> <toolTitle>×2</toolTitle>" +
        "<toolTitle>, </toolTitle><success>edit</success> <toolTitle>×1</toolTitle>",
    );
  });

  it("keeps think purple inside a successful summary", () => {
    const row = summaryRow(theme, [{ name: "bash", count: 2 }, { name: "think", count: 2 }], []);
    assert.ok(row.text.includes("<thinkingText>think</thinkingText>"), row.text);
    assert.ok(row.text.includes("<success>bash</success>"), row.text);
  });

  it("renders failures in red after the successes", () => {
    const row = summaryRow(theme, [{ name: "read", count: 2 }], [{ name: "bash", count: 1 }]);
    assert.equal(plain(row.text), "✓ read ×2 · ✗ bash ×1");
    assert.ok(row.text.includes("<error>bash</error>"), row.text);
  });

  it("drops the empty group instead of leaving a separator", () => {
    assert.equal(plain(summaryRow(theme, [], [{ name: "bash", count: 2 }]).text), "✗ bash ×2");
    assert.equal(plain(summaryRow(theme, [{ name: "ls", count: 2 }], []).text), "✓ ls ×2");
  });

  it("is always green-guttered, even when it replaces a thinking row", () => {
    assert.equal(summaryRow(theme, [{ name: "think", count: 2 }], []).gutter, " <success>▌</success> ");
  });
});
