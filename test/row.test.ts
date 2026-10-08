import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gutterWidth, type RunSummary } from "../src/row.ts";
import { fakeTheme, plain, testPainter } from "./test-support.ts";

const painter = testPainter();

/** Only the groups a test cares about; the rest stay empty. */
function runSummary(summary: Partial<RunSummary>): RunSummary {
  return { done: [], failed: [], running: [], ...summary };
}

describe("gutters", () => {
  it("uses the label token for call rows and a dim one for output", () => {
    assert.equal(painter.gutter(), " <success>▌</success> ");
    assert.equal(painter.outputGutter(), " <borderMuted>▌</borderMuted> ");
  });

  it("reports its own visible width, so a disabled gutter reclaims the columns", () => {
    assert.equal(gutterWidth(plain(painter.gutter())), 3);
    assert.equal(gutterWidth(""), 0);
  });

  it("disappears entirely when the gutter is off", () => {
    const bare = testPainter({ gutter: false });
    assert.equal(bare.gutter(), "");
    assert.equal(bare.outputGutter(), "");
    assert.equal(bare.labeled({ glyph: "✓", label: "read" }).gutter, "");
  });

  it("follows the configured glyph", () => {
    assert.equal(plain(testPainter({ glyphStyle: "ascii" }).gutter()), " | ");
  });
});

describe("labeled rows", () => {
  it("colors the label with the label token and details with the details token", () => {
    const row = painter.labeled({ glyph: "✓", label: "read", details: "a.ts" });
    assert.equal(row.text, "<success>✓</success> <success>read</success> <toolTitle>a.ts</toolTitle>");
    assert.equal(row.gutter, " <success>▌</success> ", "gutter follows the label color");
  });

  it("places the badge between the label and the details", () => {
    const row = painter.labeled({ glyph: "•", label: "bash", badge: "[⏱ 3s]", details: "sleep 5" });
    assert.equal(plain(row.text), "• bash [⏱ 3s] sleep 5");
  });

  it("omits absent segments without leaving a stray space", () => {
    assert.equal(plain(painter.labeled({ label: "bash", details: "ls" }).text), "bash ls");
    assert.equal(plain(painter.labeled({ glyph: "✓", label: "ls" }).text), "✓ ls");
    assert.equal(plain(painter.labeled({ glyph: "✓", label: "bash", badge: "", details: "" }).text), "✓ bash");
  });

  it("colors the glyph independently of the label", () => {
    const row = painter.labeled({ glyph: "✗", glyphColor: "error", label: "bash", details: "false" });
    assert.ok(row.text.startsWith("<error>✗</error>"), row.text);
    assert.ok(row.text.includes("<success>bash</success>"));
  });

  it("takes its gutter from the label color, so thinking stays in its own hue", () => {
    const row = painter.labeled({ glyph: "✓", label: "think", labelColor: "thinkingText", details: "why" });
    assert.equal(row.gutter, " <thinkingText>▌</thinkingText> ");
    assert.equal(row.text, "<success>✓</success> <thinkingText>think</thinkingText> <toolTitle>why</toolTitle>");
  });

  it("honours overridden theme tokens", () => {
    const row = testPainter({ tokens: { label: "warning", details: "muted" } }).labeled({
      glyph: "✓",
      label: "read",
      details: "a.ts",
    });
    assert.equal(row.text, "<warning>✓</warning> <warning>read</warning> <muted>a.ts</muted>");
  });
});

describe("run summaries", () => {
  it("keeps names in the outcome color and counts dim", () => {
    const row = painter.summary(runSummary({ done: [{ name: "read", count: 2 }, { name: "edit", count: 1 }] }));
    assert.equal(
      row.text,
      "<success>✓</success> <success>read</success> <toolTitle>×2</toolTitle>" +
        "<toolTitle>, </toolTitle><success>edit</success> <toolTitle>×1</toolTitle>",
    );
  });

  it("keeps think in its own hue inside a successful summary", () => {
    const row = painter.summary(runSummary({ done: [{ name: "bash", count: 2 }, { name: "think", count: 2 }] }));
    assert.ok(row.text.includes("<thinkingText>think</thinkingText>"), row.text);
    assert.ok(row.text.includes("<success>bash</success>"), row.text);
  });

  it("orders the groups done, failed, running", () => {
    const row = painter.summary({
      done: [{ name: "read", count: 2 }],
      failed: [{ name: "bash", count: 1 }],
      running: [{ name: "grep", count: 1 }],
    });
    assert.equal(plain(row.text), "✓ read ×2 · ✗ bash ×1 · • grep ×1");
    assert.ok(row.text.includes("<error>bash</error>"), row.text);
  });

  it("counts a still-running row instead of dropping it", () => {
    // A running row folds by default, so without its own group it was counted
    // nowhere and vanished from the transcript until it finished.
    const row = painter.summary(runSummary({ running: [{ name: "bash", count: 1 }] }));
    assert.equal(plain(row.text), "• bash ×1");
  });

  it("drops an empty group instead of leaving a separator", () => {
    assert.equal(plain(painter.summary(runSummary({ failed: [{ name: "bash", count: 2 }] })).text), "✗ bash ×2");
    assert.equal(plain(painter.summary(runSummary({ done: [{ name: "ls", count: 2 }] })).text), "✓ ls ×2");
  });

  it("always uses the label-colored gutter, even when it replaces a thinking row", () => {
    const row = painter.summary(runSummary({ done: [{ name: "think", count: 2 }] }));
    assert.equal(row.gutter, " <success>▌</success> ");
  });

  it("uses the configured count glyph", () => {
    const ascii = testPainter({ glyphStyle: "ascii" }, fakeTheme());
    assert.equal(plain(ascii.summary(runSummary({ done: [{ name: "ls", count: 2 }] })).text), "+ ls x2");
  });
});
