import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  callText,
  colorAction,
  compact,
  fallbackCallText,
  isBuiltIn,
  rowText,
  statusGlyph,
  timerBadge,
} from "../src/tool-rows.ts";
import { fakeClock, fakeTheme, makeContext, plain } from "../test/test-support.ts";

const theme = fakeTheme();

describe("isBuiltIn", () => {
  it("covers exactly Pi's native tool names", () => {
    for (const name of ["read", "bash", "edit", "write", "grep", "find", "ls"]) {
      assert.equal(isBuiltIn(name), true, name);
    }
    for (const name of ["mcp", "subagent", "TaskCreate", "web_search", ""]) {
      assert.equal(isBuiltIn(name), false, name);
    }
  });
});

describe("callText", () => {
  it("renders the documented one-line summary per tool", () => {
    assert.equal(callText("read", { path: "src/a.ts" }), "read src/a.ts");
    assert.equal(callText("read", { path: "a.ts", offset: 10, limit: 5 }), "read a.ts:10-14");
    assert.equal(callText("read", { path: "a.ts", offset: 10 }), "read a.ts:10");
    assert.equal(callText("bash", { command: "go test ./..." }), "bash go test ./...");
    assert.equal(callText("edit", { path: "src/b.ts" }), "edit src/b.ts");
    assert.equal(callText("write", { path: "src/c.ts" }), "write src/c.ts");
    assert.equal(callText("grep", { pattern: "foo", path: "src" }), "grep /foo/ in src");
    assert.equal(callText("find", { pattern: "*.ts" }), "find *.ts in .");
    assert.equal(callText("ls", {}), "ls .");
  });

  it("shows paths verbatim (no ~/ abbreviation)", () => {
    assert.equal(callText("read", { path: "/Users/me/x/y.ts" }), "read /Users/me/x/y.ts");
    assert.equal(callText("read", { path: "src/a.ts" }), "read src/a.ts");
  });

  it("collapses a multiline command into ONE row, collapsed and expanded", () => {
    const command = "python3 - <<'EOF'\nprint(1)\n\n  print(2)\nEOF";

    const collapsed = callText("bash", { command });
    const expanded = callText("bash", { command }, true);

    assert.ok(!collapsed.includes("\n"), "collapsed row must be single-line");
    assert.ok(!expanded.includes("\n"), "expanded row must be single-line");
    assert.equal(expanded, "bash python3 - <<'EOF' print(1) print(2) EOF");
  });

  it("truncates long commands when collapsed but keeps full length when expanded", () => {
    const command = "echo " + "y".repeat(300);

    const collapsed = callText("bash", { command });
    const expanded = callText("bash", { command }, true);

    assert.equal(collapsed.length, "bash ".length + 100);
    assert.ok(collapsed.endsWith("…"));
    assert.equal(expanded, `bash ${command}`);
  });

  it("never throws on missing or incomplete arguments", () => {
    for (const name of ["read", "bash", "edit", "write", "grep", "find", "ls"] as const) {
      assert.doesNotThrow(() => callText(name, undefined));
      assert.doesNotThrow(() => callText(name, {}));
      assert.doesNotThrow(() => callText(name, { path: undefined, command: undefined }));
    }
    // Streaming args arrive incrementally, so partial JSON must still render.
    assert.equal(callText("bash", { command: "git st" }), "bash git st");
    assert.equal(callText("read", {}), "read ");
  });
});

describe("compact", () => {
  it("collapses whitespace and truncates with an ellipsis", () => {
    assert.equal(compact("  a \n\t b  "), "a b");
    assert.equal(compact("abcdef", 4), "abc…");
    assert.equal(compact(undefined), "");
    assert.equal(compact("abc", Number.POSITIVE_INFINITY), "abc");
  });
});

describe("statusGlyph", () => {
  it("maps every UI state to its glyph and color", () => {
    assert.deepEqual(statusGlyph(makeContext("queued")), { glyph: "›", color: "success" });
    assert.deepEqual(statusGlyph(makeContext("completed")), { glyph: "✓", color: "success" });
    assert.deepEqual(statusGlyph(makeContext("failed")), { glyph: "✗", color: "error" });

    const running = statusGlyph(makeContext("running"));
    assert.equal(running.glyph, "•");
    assert.equal(running.color, "success");
    assert.equal(running.elapsed, 0);
  });

  it("shows ✓ for replayed history where executionStarted is false", () => {
    // Session replay never calls markExecutionStarted(); keying off
    // executionStarted would show the queued caret for every historical call.
    const replayed = { state: {}, isPartial: false, isError: false, executionStarted: false };
    assert.equal(statusGlyph(replayed).glyph, "✓");
  });

  it("advances elapsed seconds with the injected clock", () => {
    const clock = fakeClock();
    const context = makeContext("running");

    assert.equal(statusGlyph(context, clock.now).elapsed, 0);
    clock.advance(2_400);
    assert.equal(statusGlyph(context, clock.now).elapsed, 2);
    clock.advance(600);
    assert.equal(statusGlyph(context, clock.now).elapsed, 3);
  });

  it("stops reporting elapsed once the result is final", () => {
    assert.equal(statusGlyph(makeContext("completed")).elapsed, undefined);
    assert.equal(timerBadge(undefined), "");
    assert.equal(timerBadge(7), "[⏱ 7s]");
  });
});

describe("colorAction / rowText", () => {
  it("colors the action word green and the details with toolTitle", () => {
    assert.equal(
      colorAction("read a.ts", theme),
      "<success>read</success><toolTitle> a.ts</toolTitle>",
    );
  });

  it("places the timer between the action word and the details", () => {
    assert.equal(
      plain(colorAction("bash sleep 5", theme, "[⏱ 3s]")),
      "bash [⏱ 3s] sleep 5",
    );
  });

  it("uses the generic toolcall label for non-built-in tools", () => {
    assert.equal(fallbackCallText("goland__execute_tool"), "toolcall goland__execute_tool");
    assert.equal(
      plain(rowText("goland__execute_tool", {}, theme, { glyph: "✓", color: "success" }, false)),
      "✓ toolcall goland__execute_tool",
    );
  });

  it("assembles rows per state without stray leading spaces", () => {
    const args = { command: "ls" };
    assert.equal(plain(rowText("bash", args, theme, statusGlyph(makeContext("queued")), false)), "› bash ls");
    assert.equal(plain(rowText("bash", args, theme, statusGlyph(makeContext("completed")), false)), "✓ bash ls");
    assert.equal(plain(rowText("bash", args, theme, statusGlyph(makeContext("failed")), false)), "✗ bash ls");
    assert.equal(
      plain(rowText("bash", args, theme, { glyph: "", color: "success" }, false)),
      "bash ls",
      "an empty glyph must not leave a leading space",
    );
  });

  it("colors the failure glyph with the error token", () => {
    const row = rowText("bash", { command: "false" }, theme, statusGlyph(makeContext("failed")), false);
    assert.ok(row.startsWith("<error>✗</error>"), row);
  });
});
