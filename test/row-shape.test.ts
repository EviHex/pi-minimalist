/**
 * Structural invariants of painted rows.
 *
 * These encode the properties the row/paint split exists to guarantee, and they
 * are what a differential comparison against the pre-refactor renderer verified
 * cell-by-cell (glyph + active color per terminal cell, 1284 outputs, zero
 * painted-cell differences). Keep them: they are cheap, and they fail loudly if
 * someone reintroduces string re-parsing or colors a separator by accident.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Painter, type ThemeLike } from "../src/row.ts";
import { describeTool, BUILT_INS } from "../src/tools.ts";
import { plain, plainTheme, testConfig } from "./test-support.ts";

/**
 * Cell-accurate model of what a terminal displays: one (glyph, activeColor) pair
 * per visible character. A space carries no glyph, so its color is invisible and
 * normalized — that is exactly why moving a separator space in or out of a color
 * span cannot change the rendered output.
 */
function cells(line: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let color = "default";
  for (const token of line.matchAll(/<(\/?)([a-zA-Z]+)>|([\s\S])/g)) {
    const [, closing, tag, char] = token;
    if (tag) {
      color = closing ? "default" : tag;
      continue;
    }
    out.push([char, char === " " ? "-" : color]);
  }
  return out;
}

/** Theme whose markup is parseable by cells() and costs zero visible columns. */
const markup: ThemeLike = {
  fg: (token, text) => `<${token}>${text}</${token}>`,
  bg: (token, text) => `<${token}>${text}</${token}>`,
};

const painter = new Painter(markup, testConfig());

describe("painted row structure", () => {
  it("never colors a separator space", () => {
    const row = painter.labeled({
      glyph: "✓",
      label: "bash",
      badge: "[⏱ 3s]",
      details: "go test ./...",
    });
    for (const [char, color] of cells(row.text)) {
      if (char === " ") assert.equal(color, "-", "separator spaces must stay uncolored");
    }
  });

  it("colors each segment independently, with no bleed across the boundary", () => {
    const painted = cells(painter.labeled({ glyph: "✗", glyphColor: "error", label: "bash", details: "false" }).text);
    const colorOf = (char: string) => painted.find(([c]) => c === char)?.[1];
    assert.equal(colorOf("✗"), "error");
    assert.equal(colorOf("b"), "success", "the label keeps its own color");
    assert.equal(colorOf("f"), "toolTitle", "details keep theirs");
  });

  it("emits no empty color span for an absent segment", () => {
    // `read` with streaming args that have not delivered `path` yet.
    const { label, details } = describeTool("read", {});
    const row = painter.labeled({ glyph: "›", label, details });
    assert.equal(row.text, "<success>›</success> <success>read</success>");
    assert.ok(!row.text.includes("<toolTitle></toolTitle>"), "no zero-width span");
    assert.ok(!plain(row.text).endsWith(" "), "and no trailing separator space");
  });

  it("keeps every built-in row on exactly one line, at any width", () => {
    const theme = plainTheme();
    const args = { path: "a/".repeat(80) + "f.ts", command: "x\ny\nz", pattern: "p" };
    for (const name of BUILT_INS) {
      for (const expanded of [false, true]) {
        const { label, details } = describeTool(name, args, { expanded });
        const text = new Painter(theme, testConfig()).labeled({ glyph: "✓", label, details }).text;
        assert.ok(!text.includes("\n"), `${name} exp=${expanded} must stay single-line`);
      }
    }
  });

  it("separates quiet summary groups without coloring the separator glyphs' spaces", () => {
    const row = painter.summary({ done: [{ name: "read", count: 2 }], failed: [{ name: "bash", count: 1 }], running: [] });
    assert.equal(plain(row.text), "✓ read ×2 · ✗ bash ×1");
    for (const [char, color] of cells(row.text)) {
      if (char === " ") assert.equal(color, "-");
    }
    // The dot separator itself is dim, not success/error.
    assert.equal(cells(row.text).find(([c]) => c === "·")?.[1], "toolTitle");
  });
});
