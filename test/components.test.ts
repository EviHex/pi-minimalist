import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import {
  CompactLine,
  EmptyComponent,
  GUTTER_WIDTH,
  GutteredComponent,
  gutter,
  outputGutter,
} from "../src/components.ts";
import { fakeTheme, fakeTimers, plain, plainTheme } from "../test/test-support.ts";

const theme = fakeTheme();
// Width/truncation assertions need a theme whose markup costs zero columns.
const widthTheme = plainTheme();

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
    line.setGutter(gutter(theme));
    line.set("✓ read a.ts");

    const rendered = line.render(80);
    assert.equal(rendered.length, 1);
    assert.equal(plain(rendered[0]), " ▌ ✓ read a.ts");
  });

  it("uses the borderAccent token for the call gutter and borderMuted for output", () => {
    assert.equal(gutter(theme), " <borderAccent>▌</borderAccent> ");
    assert.equal(outputGutter(theme), " <borderMuted>▌</borderMuted> ");
  });

  it("truncates to the render width, gutter included, at any terminal size", () => {
    const line = new CompactLine(fakeTimers());
    line.setGutter(gutter(widthTheme));
    line.set("bash " + "x".repeat(400));

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
    line.setGutter(gutter(widthTheme));
    line.set("read some/very/long/path/name.ts");
    // 12 columns − 3 gutter columns = 9 content columns, ellipsis included.
    assert.equal(plain(line.render(12)[0]), " ▌ read som…");
  });

  it("allows a quiet summary to override its originating gutter", () => {
    const line = new CompactLine(fakeTimers());
    line.setGutter(` ${theme.fg("thinkingText", "▌")} `);
    line.set("✓ think preview");
    line.setQuietText(() => ({ text: "✓ read ×1, think ×1", gutter: gutter(theme) }));

    assert.equal(
      line.render(80)[0],
      " <borderAccent>▌</borderAccent> ✓ read ×1, think ×1",
    );
  });

  it("applies the background wrapper only when one is provided", () => {
    const line = new CompactLine(fakeTimers());
    line.set("row");
    assert.equal(line.render(20)[0], "row");

    line.set("row", (text) => theme.bg("toolPendingBg", text));
    assert.equal(line.render(20)[0], "[toolPendingBg]row[/toolPendingBg]");
  });

  it("starts at most one ticker and stops it on completion", () => {
    const timers = fakeTimers();
    const line = new CompactLine(timers);
    let repaints = 0;

    line.startTicker(() => repaints++);
    line.startTicker(() => repaints++); // must not register a second interval
    assert.equal(timers.pending(), 1);
    assert.equal(line.isTicking(), true);

    timers.fire();
    assert.equal(repaints, 1);

    line.stopTicker();
    assert.equal(timers.pending(), 0, "a finished row must leave no interval behind");
    assert.equal(line.isTicking(), false);

    timers.fire();
    assert.equal(repaints, 1, "stopped ticker must not repaint again");
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
      outputGutter(theme),
    );

    const rendered = wrapper.render(60);
    assert.equal(innerWidth, 60 - GUTTER_WIDTH);
    assert.deepEqual(rendered.map(plain), [" ▌ one", " ▌ two", " ▌ three"]);
  });

  it("keeps the wrapper stable while the inner component is swapped", () => {
    const wrapper = new GutteredComponent(fixedLines(["old"]), outputGutter(theme));
    wrapper.setInner(fixedLines(["new"]));
    assert.deepEqual(wrapper.render(40).map(plain), [" ▌ new"]);
  });

  it("never asks the inner component for a non-positive width", () => {
    let innerWidth = -1;
    const wrapper = new GutteredComponent(
      fixedLines([""], (width) => (innerWidth = width)),
      outputGutter(theme),
    );
    wrapper.render(1);
    assert.ok(innerWidth >= 1, `inner width was ${innerWidth}`);
  });

  it("forwards invalidate to the inner component", () => {
    let invalidated = 0;
    const wrapper = new GutteredComponent(
      { render: () => [], invalidate: () => void invalidated++ },
      outputGutter(theme),
    );
    wrapper.invalidate();
    assert.equal(invalidated, 1);
  });
});
