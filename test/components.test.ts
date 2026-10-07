import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import { CompactLine, EmptyComponent, FoldableProse, GutteredComponent } from "../src/components.ts";
import { gutterWidth } from "../src/row.ts";
import { fakeTheme, fakeTimers, plain, plainTheme, testPainter } from "../test/test-support.ts";

const theme = fakeTheme();

const painter = testPainter();
// Width/truncation assertions need a theme whose markup costs zero columns.
const widthPainter = testPainter({}, plainTheme());

/** Minimal stub inner component for the gutter wrapper tests. */
function fixedLines(lines: string[], onRender?: (width: number) => void): Component {
  return {
    render(width: number) {
      onRender?.(width);
      return lines;
    },
    invalidate() {},
  };
}

describe("CompactLine", () => {
  it("renders exactly one line with the gutter prefix", () => {
    const line = new CompactLine(fakeTimers());
    line.setRow(() => painter.labeled({ glyph: "✓", label: "read", details: "a.ts" }));

    const rendered = line.render(80);
    assert.equal(rendered.length, 1);
    assert.equal(plain(rendered[0]), " ▌ ✓ read a.ts");
  });

  it("renders nothing at all when the resolver hides the row", () => {
    const line = new CompactLine(fakeTimers());
    line.setRow(() => null);
    assert.deepEqual(line.render(80), [], "a hidden row must add zero lines, not a blank one");
  });

  it("re-resolves the row on every render, so /quiet repaints existing rows", () => {
    const line = new CompactLine(fakeTimers());
    let hidden = false;
    line.setRow(() => (hidden ? null : widthPainter.labeled({ label: "read", details: "a.ts" })));

    assert.equal(line.render(80).length, 1);
    hidden = true;
    assert.deepEqual(line.render(80), []);
  });

  it("truncates to the render width, gutter included, at any terminal size", () => {
    const line = new CompactLine(fakeTimers());
    line.setRow(() => widthPainter.labeled({ label: "bash", details: "x".repeat(400) }));

    for (const width of [10, 24, 40, 80, 200]) {
      const rendered = line.render(width);
      assert.equal(rendered.length, 1, `width ${width} must stay one line`);
      assert.ok(
        visibleWidth(rendered[0]) <= width,
        `width ${width}: got ${visibleWidth(rendered[0])} visible columns`,
      );
    }
  });

  it("keeps a narrow render legible instead of dropping the whole row", () => {
    const line = new CompactLine(fakeTimers());
    line.setRow(() => widthPainter.labeled({ label: "read", details: "some/very/long/path/name.ts" }));
    // 12 columns − 3 gutter columns = 9 content columns, ellipsis included.
    assert.equal(plain(line.render(12)[0]), " ▌ read som…");
  });

  it("takes the gutter from the resolved row, so a summary can replace a purple one", () => {
    const line = new CompactLine(fakeTimers());
    line.setRow(() =>
      widthPainter.summary({ done: [{ name: "read", count: 1 }, { name: "think", count: 1 }], failed: [], running: [] }),
    );

    assert.equal(plain(line.render(80)[0]), " ▌ ✓ read ×1, think ×1");
  });

  it("starts at most one ticker and stops it on completion", () => {
    const timers = fakeTimers();
    const line = new CompactLine(timers);
    let repaints = 0;

    line.startTicker(() => repaints++);
    line.startTicker(() => repaints++); // must not register a second interval
    assert.equal(timers.pending(), 1);

    timers.fire();
    assert.equal(repaints, 1);

    line.stopTicker();
    assert.equal(timers.pending(), 0, "a finished row must leave no interval behind");

    timers.fire();
    assert.equal(repaints, 1, "stopped ticker must not repaint again");
  });
});

describe("CompactLine header", () => {
  const click = (y: number) =>
    ({ type: "click", button: "left", x: 3, y, screenX: 3, screenY: y, width: 80, height: 2, shift: false, alt: false, ctrl: false }) as const;

  it("draws the header above the row and routes only a y=0 click to close", () => {
    const calls: boolean[] = [];
    const line = new CompactLine(fakeTimers());
    line.setRow(
      () => ({ ...widthPainter.labeled({ glyph: "✓", label: "read", details: "a.ts" }), header: widthPainter.header() }),
      (onHeader) => (calls.push(onHeader), onHeader),
    );
    assert.deepEqual(line.render(80), ["   ▾ Expanded · click to fold", "", " ▌ ✓ read a.ts"]);
    assert.equal(line.handleMouse(click(0))?.handled, true);
    assert.equal(line.handleMouse(click(1)), undefined, "the blank line falls through to Pi");
    assert.equal(line.handleMouse(click(2)), undefined, "a member row falls through to Pi");
    assert.deepEqual(calls, [true, false, false]);
  });

  it("works without a gutter and with an expanded (wrapped) row below", () => {
    const bare = testPainter({ gutter: false }, plainTheme());
    const line = new CompactLine(fakeTimers());
    line.setRow(() => ({
      ...bare.labeled({ glyph: "✓", label: "bash", details: "x ".repeat(30), wrap: true }),
      header: bare.header(),
    }));
    const lines = line.render(30);
    assert.equal(lines[0], "▾ Expanded · click to fold");
    assert.equal(lines[1], "", "one blank line between header and row");
    assert.ok(lines.length > 3, "header, blank, then several wrapped lines");
    assert.ok(lines.every((l) => visibleWidth(l) <= 30));
  });

  it("draws the ASCII header, in the muted colour, with one blank line below", () => {
    const ascii = testPainter({ glyphStyle: "ascii" }, plainTheme());
    const line = new CompactLine(fakeTimers());
    line.setRow(() => ({ ...ascii.labeled({ glyph: "+", label: "read", details: "a.ts" }), header: ascii.header() }));
    assert.deepEqual(line.render(80), ["   v Expanded - click to fold", "", " | + read a.ts"]);
    const themed = testPainter({}, fakeTheme()).header();
    assert.match(themed.text, /^<muted>▾ Expanded · click to fold<\/muted>$/);
    assert.equal(themed.gutter, "   ", "blank padding of the gutter width, no bar");
    assert.equal(testPainter({ gutter: false }, fakeTheme()).header().gutter, "", "no padding without a gutter");
  });

  it("does not treat y=0 as the header when the last render drew none", () => {
    const line = new CompactLine(fakeTimers());
    line.setRow(() => widthPainter.labeled({ label: "read" }), (onHeader) => onHeader);
    line.render(80);
    assert.equal(line.handleMouse(click(0)), undefined);
  });
});

describe("EmptyComponent", () => {
  it("renders zero lines so collapsed results add no height", () => {
    assert.deepEqual(new EmptyComponent().render(), []);
  });
});

describe("GutteredComponent", () => {
  it("prefixes every inner line and shrinks the inner width by the gutter", () => {
    let innerWidth = 0;
    const wrapper = new GutteredComponent(
      fixedLines(["one", "two", "three"], (width) => (innerWidth = width)),
      painter.outputGutter(),
    );

    const rendered = wrapper.render(60);
    assert.equal(innerWidth, 60 - gutterWidth(plain(painter.outputGutter())));
    assert.deepEqual(rendered.map(plain), [" ▌ one", " ▌ two", " ▌ three"]);
  });

  it("keeps the wrapper stable while the inner component is swapped", () => {
    const wrapper = new GutteredComponent(fixedLines(["old"]), painter.outputGutter());
    wrapper.setInner(fixedLines(["new"]));
    assert.deepEqual(wrapper.render(40).map(plain), [" ▌ new"]);
  });

  it("never asks the inner component for a non-positive width", () => {
    let innerWidth = -1;
    const wrapper = new GutteredComponent(
      fixedLines([""], (width) => (innerWidth = width)),
      painter.outputGutter(),
    );
    wrapper.render(1);
    assert.ok(innerWidth >= 1, `inner width was ${innerWidth}`);
  });

  it("forwards invalidate to the inner component", () => {
    let invalidated = 0;
    const wrapper = new GutteredComponent(
      { render: () => [], invalidate: () => void invalidated++ },
      painter.outputGutter(),
    );
    wrapper.invalidate();
    assert.equal(invalidated, 1);
  });
});

describe("FoldableProse header", () => {
  const click = (y: number) =>
    ({ type: "click", button: "left", x: 3, y, screenX: 3, screenY: y, width: 80, height: 3, shift: false, alt: false, ctrl: false }) as const;

  it("draws header, one blank line, then the native output; only y=0 folds (gutter off)", () => {
    const bare = testPainter({ gutter: false }, plainTheme());
    const calls: boolean[] = [];
    const inner: Component = { render: () => ["native text"], invalidate() {} };
    const prose = new FoldableProse(inner, () => undefined, () => bare.header(), (onHeader) => (calls.push(onHeader), onHeader));
    assert.deepEqual(prose.render(80), ["▾ Expanded · click to fold", "", "native text"]);
    assert.equal(prose.handleMouse(click(0))?.handled, true);
    assert.equal(prose.handleMouse(click(1)), undefined, "the blank line is not ours");
    assert.equal(prose.handleMouse(click(2)), undefined, "the native output is not ours");
    assert.deepEqual(calls, [true]);
  });
});
