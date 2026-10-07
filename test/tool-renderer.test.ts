import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { CompactLine, EmptyComponent, GutteredComponent } from "../src/components.ts";
import { BUILT_INS } from "../src/tools.ts";
import type { Config } from "../src/config.ts";
import type { RunGrouping } from "../src/run-grouping.ts";
import { createToolRenderer, statusGlyph, timerBadge } from "../src/tool-renderer.ts";
import {
  fakeClock,
  fakeTheme,
  fakeTimers,
  makeContext,
  plain,
  plainTheme,
  testConfig,
  testState,
} from "../test/test-support.ts";

/** Defaults for the statusGlyph/timerBadge unit tests. */
const config = testConfig();

const theme = fakeTheme();
// Width/truncation assertions need a theme whose markup costs zero columns.
const widthTheme = plainTheme();

/** The renderer as production builds it, but with a deterministic clock/timers. */
function renderer(
  options: {
    clock?: ReturnType<typeof fakeClock>;
    timers?: ReturnType<typeof fakeTimers>;
    config?: Config;
    grouping?: RunGrouping;
  } = {},
) {
  const clock = options.clock ?? fakeClock();
  const timers = options.timers ?? fakeTimers();
  const state = options.config && options.grouping
    ? { config: options.config, grouping: options.grouping }
    : testState();
  return {
    renderer: createToolRenderer({ ...state, now: clock.now, timers }),
    clock,
    timers,
    ...state,
  };
}

/** Native renderResult stand-in: multiline output, reuse-aware like the real ones. */
function nativeRenderer(lines: string[]) {
  const seenLastComponents: unknown[] = [];
  const render = (_result: any, _options: any, _theme: any, context: any) => {
    seenLastComponents.push(context.lastComponent);
    return { render: () => lines, invalidate() {} };
  };
  return { render, seenLastComponents };
}

describe("tool renderer bridge contract", () => {
  it("declares self shell and handles built-ins plus MCP adapter tools", () => {
    const { renderer: r } = renderer();
    assert.equal(r.renderShell, "self");
    for (const name of ["read", "bash", "write", "mcp", "mcpScript", "mcp__atlassian"]) {
      assert.equal(r.handles(name), true, name);
    }
    assert.equal(r.handles("subagent"), false);
  });
});

describe("renderCall", () => {
  it("renders one guttered line per state", () => {
    const { renderer: r } = renderer();

    const queued = r.renderCall("read", { path: "a.ts" }, theme, makeContext("queued"));
    assert.deepEqual(queued.render(80).map(plain), [" ▌ › read a.ts"]);

    const done = r.renderCall("read", { path: "a.ts" }, theme, makeContext("completed"));
    assert.deepEqual(done.render(80).map(plain), [" ▌ ✓ read a.ts"]);

    const failed = r.renderCall("bash", { command: "false" }, theme, makeContext("failed"));
    assert.deepEqual(failed.render(80).map(plain), [" ▌ ✗ bash false"]);
  });

  it("shows the live timer while running and advances it with the clock", () => {
    const { renderer: r, clock, timers } = renderer();
    const context = makeContext("running");

    const line = r.renderCall("bash", { command: "sleep 30" }, widthTheme, context);
    assert.deepEqual(line.render(80).map(plain), [" ▌ • bash sleep 30"]);
    assert.equal(timers.pending(), 1, "a running row must tick");

    // The ticker asks core to invalidate, which re-runs renderCall.
    clock.advance(3_000);
    timers.fire();
    assert.equal(context.invalidateCount(), 1);

    const again = r.renderCall("bash", { command: "sleep 30" }, widthTheme, {
      ...context,
      lastComponent: line,
    });
    assert.equal(again, line, "the component must be reused, not reallocated");
    assert.deepEqual(again.render(80).map(plain), [" ▌ • bash [⏱ 3s] sleep 30"]);
  });

  it("reuses one row and one ticker when core passes no lastComponent", () => {
    // Core's createCallFallback() (every rendererless MCP/third-party tool)
    // always calls getRenderContext(undefined), so lastComponent is never set.
    // Reallocating per render used to register a new 1s ticker each time and
    // clear none of them: an exponential interval leak that froze the UI.
    const { renderer: r, timers } = renderer();
    const running = makeContext("running");

    const first = r.renderCall("goland__execute_tool", {}, widthTheme, running);
    const second = r.renderCall("goland__execute_tool", {}, widthTheme, running);
    const third = r.renderCall("goland__execute_tool", {}, widthTheme, running);

    assert.equal(second, first, "the fallback path must not reallocate the row");
    assert.equal(third, first);
    assert.equal(timers.pending(), 1, "each repaint must not leak a ticker");

    // Completion must reach the SAME component and stop the surviving ticker.
    r.renderCall("goland__execute_tool", {}, widthTheme, {
      ...makeContext("completed"),
      state: running.state,
    });
    assert.equal(timers.pending(), 0, "completion must stop the ticker");
    assert.equal(first.isTicking(), false);
  });

  it("stops the ticker when the row reaches a final state", () => {
    const { renderer: r, timers } = renderer();
    const running = makeContext("running");

    const line = r.renderCall("bash", { command: "sleep 1" }, theme, running);
    assert.equal(timers.pending(), 1);

    r.renderCall("bash", { command: "sleep 1" }, theme, {
      ...makeContext("completed"),
      state: running.state,
      lastComponent: line,
    });
    assert.equal(timers.pending(), 0, "no interval may survive completion");
    assert.equal(line.isTicking(), false);
  });

  it("keeps an expanded command's lines under the hanging indent; a collapsed one stays one clipped row", () => {
    const { renderer: r } = renderer();
    const command = "python3 - <<'EOF'\nprint(1)\nprint(2)\nEOF";
    const expandedRow = () => r.renderCall("bash", { command }, widthTheme, makeContext("completed", { expanded: true }));

    // Wide enough for everything: still one row per SOURCE line.
    assert.deepEqual(expandedRow().render(60).map(plain), [
      " ▌ ✓ bash python3 - <<'EOF'",
      " ▌        print(1)",
      " ▌        print(2)",
      " ▌        EOF",
    ]);

    // Narrow: the long first source line wraps, and later lines still indent.
    assert.deepEqual(expandedRow().render(22).map(plain), [
      " ▌ ✓ bash python3 -",
      " ▌        <<'EOF'",
      " ▌        print(1)",
      " ▌        print(2)",
      " ▌        EOF",
    ]);
  });

  it("wraps a long source line inside a heredoc and keeps indenting the lines after it", () => {
    const { renderer: r } = renderer();
    const command = "cat <<'EOF'\n" + "word ".repeat(12).trim() + "\ntail\nEOF";
    const lines = r
      .renderCall("bash", { command }, widthTheme, makeContext("completed", { expanded: true }))
      .render(30)
      .map(plain);
    assert.deepEqual(lines, [
      " ▌ ✓ bash cat <<'EOF'",
      " ▌        word word word word",
      " ▌        word word word word",
      " ▌        word word word word",
      " ▌        tail",
      " ▌        EOF",
    ]);
  });

  it("keeps each line's own indentation, turns tabs into two spaces, and drops outer blank lines", () => {
    const { renderer: r } = renderer();
    const command = "\n\nif x; then\r\n\techo hi   \r\n    echo there\r\nfi\n\n";
    const lines = r
      .renderCall("bash", { command }, widthTheme, makeContext("completed", { expanded: true }))
      .render(40)
      .map(plain);
    assert.deepEqual(lines, [
      " ▌ ✓ bash if x; then",
      " ▌          echo hi",
      " ▌            echo there",
      " ▌        fi",
    ]);
  });

  it("keeps blank lines inside a command and shows an enormous one without a cap", () => {
    const { renderer: r } = renderer();
    const inner = r
      .renderCall("bash", { command: "a\n\nb" }, widthTheme, makeContext("completed", { expanded: true }))
      .render(40)
      .map(plain);
    assert.deepEqual(inner.map((line) => line.trimEnd()), [" ▌ ✓ bash a", " ▌", " ▌        b"]);

    const word = "abcdefghi ";
    const huge = word.repeat(1500).trim(); // ~15000 chars
    const text = r
      .renderCall("bash", { command: huge }, widthTheme, makeContext("completed", { expanded: true }))
      .render(80)
      .map((line) => plain(line).slice(" ▌ ✓ bash ".length).trim())
      .join(" ");
    assert.equal(text, huge, "nothing truncated, no ellipsis");
  });

  it("collapses a multi-line command to ONE clipped line with spaces", () => {
    const { renderer: r } = renderer();
    const command = "python3 - <<'EOF'\nprint(1)\nprint(2)\nEOF";
    const wide = r.renderCall("bash", { command }, widthTheme, makeContext("completed")).render(60);
    assert.deepEqual(wide.map(plain), [" ▌ ✓ bash python3 - <<'EOF' print(1) print(2) EOF"]);

    const one = r.renderCall("bash", { command }, widthTheme, makeContext("completed")).render(30);
    assert.equal(one.length, 1);
    assert.ok(visibleWidth(one[0]) <= 30);
    assert.ok(!plain(one[0]).includes("print(2)"), "a collapsed row clips");
  });

  it("never exceeds the width for a multi-line expanded command, including the narrow fallback", () => {
    const { renderer: r, config } = renderer();
    const command = "python3 - <<'EOF'\n" + "x".repeat(60) + "\n  indented " + "y ".repeat(30) + "\n\nEOF";
    for (const gutter of [true, false]) {
      for (const glyphStyle of ["unicode", "ascii"] as const) {
        config.set("gutter", gutter);
        config.set("glyphStyle", glyphStyle);
        for (const width of [8, 12, 20, 21, 24, 33, 80, 200]) {
          const lines = r
            .renderCall("bash", { command }, widthTheme, makeContext("completed", { expanded: true }))
            .render(width);
          assert.ok(lines.length >= 1);
          for (const line of lines) assert.ok(visibleWidth(line) <= width, `width ${width}: ${JSON.stringify(plain(line))}`);
        }
      }
    }
  });

  it("falls back to ONE clipped, whitespace-collapsed line when too narrow to wrap a multi-line command", () => {
    const { renderer: r } = renderer();
    const lines = r
      .renderCall("bash", { command: "echo a\necho b" }, widthTheme, makeContext("completed", { expanded: true }))
      .render(16);
    assert.deepEqual(lines.map(plain), [" ▌ ✓ bash echo …"]);
  });

  it("colors every line of an expanded command on its own, so no escape bleeds across a newline", () => {
    const { renderer: r } = renderer();
    // Real SGR codes, like the live theme.
    const ansi = { fg: (_t: string, text: string) => `\x1b[32m${text}\x1b[39m`, bg: (_t: string, text: string) => text };
    const lines = r
      .renderCall("bash", { command: "echo one\necho " + "two ".repeat(20) }, ansi as never, makeContext("completed", { expanded: true }))
      .render(40);
    assert.ok(lines.length >= 3);
    for (const line of lines) assert.ok(visibleWidth(line) <= 40);
    // Source line 1 is closed on its own line; source line 2 opens a fresh color
    // (the pad after the gutter is uncolored), so nothing bleeds across "\n".
    assert.ok(lines[0].endsWith("\x1b[39m"), JSON.stringify(lines[0]));
    assert.ok(lines[1].includes("        \x1b[32mecho two"), JSON.stringify(lines[1]));
  });

  it("keeps the hanging indent of a running expanded row when the timer badge grows", () => {
    const command = "python3 - <<'EOF'\nprint(1)\nprint(2)\nEOF";
    const indents = [9, 10].map((seconds) => {
      const { renderer: r, clock } = renderer();
      const context = makeContext("running", { expanded: true });
      r.renderCall("bash", { command }, widthTheme, context).render(30); // starts the clock
      clock.advance(seconds * 1000);
      const lines = r.renderCall("bash", { command }, widthTheme, context).render(30).map(plain);
      for (const line of lines) assert.ok(visibleWidth(line) <= 30);
      assert.ok(lines.length > 1 && lines[0].includes(`${seconds}s]`), lines.join("|"));
      return lines.slice(1).map((line) => line.length - line.trimStart().length);
    });
    assert.deepEqual(indents[0], indents[1]);
  });

  it("never exceeds the requested width for long arguments at any size", () => {
    const { renderer: r } = renderer();
    const args = { path: "/very/deep/" + "segment/".repeat(40) + "file.ts" };

    for (const width of [8, 16, 30, 72, 120]) {
      const rendered = r.renderCall("edit", args, widthTheme, makeContext("completed")).render(width);
      assert.equal(rendered.length, 1, `width ${width}`);
      assert.ok(visibleWidth(rendered[0]) <= width, `width ${width}: ${visibleWidth(rendered[0])}`);
    }
  });

  it("folds completed runs only while groupToolRuns is enabled", () => {
    const { renderer: r, config } = renderer();
    config.set("groupToolRuns", false);
    const first = r.renderCall("read", { path: "a.ts" }, widthTheme, makeContext("completed", { toolCallId: "1" }));
    const second = r.renderCall("edit", { path: "a.ts" }, widthTheme, makeContext("completed", { toolCallId: "2" }));
    const third = r.renderCall("read", { path: "b.ts" }, widthTheme, makeContext("completed", { toolCallId: "3" }));

    assert.deepEqual(first.render(80).map(plain), [" ▌ ✓ read a.ts"], "grouping starts disabled");
    config.set("groupToolRuns", true);
    assert.deepEqual(first.render(80), []);
    assert.deepEqual(second.render(80), []);
    assert.deepEqual(third.render(80).map(plain), [" ▌ ✓ read ×2, edit ×1"]);
  });

  it("folds terminal failures into a trailing error summary", () => {
    const { renderer: r, config } = renderer();
    const read = r.renderCall("read", { path: "a.ts" }, widthTheme, makeContext("completed", { toolCallId: "1" }));
    const failed = r.renderCall("bash", { command: "false" }, widthTheme, makeContext("failed", { toolCallId: "2" }));
    const edit = r.renderCall("edit", { path: "a.ts" }, widthTheme, makeContext("completed", { toolCallId: "3" }));
    config.set("groupToolRuns", true);

    assert.deepEqual(read.render(80), []);
    assert.deepEqual(failed.render(80), []);
    assert.deepEqual(edit.render(80).map(plain), [" ▌ ✓ read ×1, edit ×1 · ✗ bash ×1"]);
  });

  it("folds tools under their actual names, but not across an expanded entry", () => {
    const { renderer: r, config } = renderer();
    const read = r.renderCall("read", { path: "a.ts" }, widthTheme, makeContext("completed", { toolCallId: "1" }));
    const bash = r.renderCall("bash", { command: "echo ok" }, widthTheme, makeContext("completed", { toolCallId: "2" }));
    const mcp = r.renderCall("mcp__atlassian", { tool: "atlassian_search" }, widthTheme, makeContext("completed", { toolCallId: "3" }));
    const mcpScript = r.renderCall("mcpScript", { code: "emit(1)" }, widthTheme, makeContext("completed", { toolCallId: "4" }));
    const edit = r.renderCall("edit", { path: "a.ts" }, widthTheme, makeContext("completed", { toolCallId: "5", expanded: true }));
    const ls = r.renderCall("ls", {}, widthTheme, makeContext("completed", { toolCallId: "6" }));
    config.set("groupToolRuns", true);

    for (const component of [read, bash, mcp]) assert.deepEqual(component.render(80), []);
    assert.deepEqual(mcpScript.render(80).map(plain), [
      " ▌ ✓ read ×1, bash ×1, atlassian_search @ atlassian ×1, mcpScript ×1",
    ]);
    for (const component of [edit, ls]) assert.equal(component.render(80).length, 1, "cut runs keep individual rows");
  });

  it("renders MCP calls with their target operation", () => {
    const { renderer: r } = renderer();
    const call = r.renderCall(
      "mcp__atlassian",
      { tool: "atlassian_getConfluencePage" },
      widthTheme,
      makeContext("completed"),
    );
    const script = r.renderCall(
      "mcpScript",
      { code: "await tools.search({ query: 'logs' })" },
      widthTheme,
      makeContext("completed"),
    );

    assert.deepEqual(call.render(80).map(plain), [" ▌ ✓ mcp atlassian_getConfluencePage @ atlassian"]);
    assert.deepEqual(script.render(80).map(plain), [" ▌ ✓ mcpScript await tools.search({ query: 'logs' })"]);
  });

  it("renders rendererless third-party tools with their registered name", () => {
    const { renderer: r } = renderer();
    const line = r.renderCall("goland__execute_tool", {}, widthTheme, makeContext("completed"));
    assert.deepEqual(line.render(80).map(plain), [" ▌ ✓ goland__execute_tool"]);
  });

  it("does not throw on missing or partial arguments", () => {
    const { renderer: r } = renderer();
    for (const state of ["queued", "running", "completed", "failed"] as const) {
      assert.doesNotThrow(() => r.renderCall("read", undefined, theme, makeContext(state)));
      assert.doesNotThrow(() => r.renderCall("bash", {}, theme, makeContext(state, { argsComplete: false })));
    }
  });

  it("reuses lastComponent only when it is a CompactLine", () => {
    const { renderer: r } = renderer();
    const foreign = new EmptyComponent();
    const line = r.renderCall("ls", {}, theme, makeContext("completed", { lastComponent: foreign }));
    assert.ok(line instanceof CompactLine);
  });

  it("handles every BUILT_INS name and rejects non-native names", () => {
    // Guards against Pi renaming a built-in: an unhandled name silently falls
    // back to the verbose card.
    const { renderer: r } = renderer();
    for (const name of BUILT_INS) {
      assert.equal(r.handles(name), true, name);
      assert.doesNotThrow(() => r.renderCall(name, {}, theme, makeContext("completed")));
    }
  });
});

describe("renderResult", () => {
  it("hides collapsed built-in output entirely", () => {
    const { renderer: r } = renderer();
    const native = nativeRenderer(["line one", "line two"]);

    const component = r.renderResult(
      "read",
      { content: [] },
      { expanded: false, isPartial: false },
      theme,
      makeContext("completed"),
      native.render,
    );

    assert.deepEqual(component!.render(80), [], "collapsed result must add zero lines");
    assert.equal(native.seenLastComponents.length, 0, "native renderer must not run when collapsed");
  });

  it("delegates expanded built-in output to the native renderer and gutters every line", () => {
    const { renderer: r } = renderer();
    const native = nativeRenderer(["first", "second", "third"]);
    const context = makeContext("completed", { expanded: true });

    const component = r.renderResult(
      "read",
      { content: [] },
      { expanded: true, isPartial: false },
      theme,
      context,
      native.render,
    );

    assert.ok(component instanceof GutteredComponent);
    assert.deepEqual(component.render(80).map(plain), [" ▌ first", " ▌ second", " ▌ third"]);
  });

  it("reuses the wrapper and native component while output is still streaming", () => {
    // Expanding a tool that is still producing output: partial results keep
    // arriving, so both the wrapper and the native component must stay stable.
    const { renderer: r } = renderer();
    const native = nativeRenderer(["partial"]);
    const context = makeContext("partial", { expanded: true });
    const options = { expanded: true, isPartial: true };

    const first = r.renderResult("bash", {}, options, theme, context, native.render);
    const second = r.renderResult("bash", {}, options, theme, { ...context, lastComponent: first }, native.render);

    assert.equal(second, first, "wrapper must be stable while streaming");
    assert.ok(native.seenLastComponents[1] !== undefined, "native component must be reused");
    assert.deepEqual(second!.render(80).map(plain), [" ▌ partial"]);
  });

  it("passes the cached native component back on expanded re-render", () => {
    const { renderer: r } = renderer();
    const native = nativeRenderer(["out"]);
    const context = makeContext("completed", { expanded: true });
    const options = { expanded: true, isPartial: false };

    const first = r.renderResult("read", {}, options, theme, context, native.render);
    const second = r.renderResult("read", {}, options, theme, { ...context, lastComponent: first }, native.render);

    assert.equal(second, first, "the gutter wrapper must be stable across renders");
    assert.equal(native.seenLastComponents[0], undefined, "first pass has no cached component");
    assert.ok(native.seenLastComponents[1] !== undefined, "second pass must reuse the native component");
  });

  it("delegates expanded MCP output to its native renderer", () => {
    const { renderer: r } = renderer();
    const native = nativeRenderer(["MCP result"]);
    const component = r.renderResult(
      "mcp__atlassian",
      {},
      { expanded: true },
      theme,
      makeContext("completed", { expanded: true }),
      native.render,
    );

    assert.ok(component instanceof GutteredComponent);
    assert.deepEqual(component.render(80).map(plain), [" ▌ MCP result"]);
  });

  it("falls back to core rendering for rendererless tools when expanded", () => {
    const { renderer: r } = renderer();
    const context = makeContext("completed", { expanded: true });

    const expanded = r.renderResult("goland__execute_tool", {}, { expanded: true }, theme, context, undefined);
    assert.equal(expanded, undefined, "undefined tells core to use its own full output");

    const collapsed = r.renderResult("goland__execute_tool", {}, { expanded: false }, theme, makeContext("completed"), undefined);
    assert.deepEqual(collapsed!.render(80), []);
  });

  it("hides output when a built-in ships no native result renderer", () => {
    const { renderer: r } = renderer();
    const component = r.renderResult("ls", {}, { expanded: true }, theme, makeContext("completed", { expanded: true }), undefined);
    assert.deepEqual(component!.render(80), []);
  });
});

describe("statusGlyph", () => {
  it("maps every UI state to its glyph, color, and grouping outcome", () => {
    assert.deepEqual(statusGlyph(makeContext("queued"), config), { glyph: "›", color: "success", outcome: "pending" });
    assert.deepEqual(statusGlyph(makeContext("completed"), config), { glyph: "✓", color: "success", outcome: "success" });
    assert.deepEqual(statusGlyph(makeContext("failed"), config), { glyph: "✗", color: "error", outcome: "failure" });

    const running = statusGlyph(makeContext("running"), config);
    assert.equal(running.glyph, "•");
    assert.equal(running.color, "success");
    assert.equal(running.outcome, "pending");
    assert.equal(running.elapsed, 0);
  });

  it("shows ✓ for replayed history where executionStarted is false", () => {
    // Session replay never calls markExecutionStarted(); keying off
    // executionStarted would show the queued caret for every historical call.
    const replayed = { state: {}, isPartial: false, isError: false, executionStarted: false };
    assert.equal(statusGlyph(replayed, config).glyph, "✓");
  });

  it("advances elapsed seconds with the injected clock", () => {
    const clock = fakeClock();
    const context = makeContext("running");

    assert.equal(statusGlyph(context, config, clock.now).elapsed, 0);
    clock.advance(2_400);
    assert.equal(statusGlyph(context, config, clock.now).elapsed, 2);
    clock.advance(600);
    assert.equal(statusGlyph(context, config, clock.now).elapsed, 3);
  });

  it("stops reporting elapsed once the result is final", () => {
    assert.equal(statusGlyph(makeContext("completed"), config).elapsed, undefined);
    assert.equal(timerBadge(undefined, config), "");
    assert.equal(timerBadge(0, config), "", "no badge under one second (avoids 0s flicker)");
    assert.equal(timerBadge(1, config), "[⏱ 1s]");
    assert.equal(timerBadge(7, config), "[⏱ 7s]");
  });
});
