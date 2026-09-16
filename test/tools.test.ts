import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BUILT_INS, compact, describeTool, isBuiltIn, refreshMcpTools, summaryName } from "../src/tools.ts";
import { Config } from "../src/config.ts";

describe("isBuiltIn", () => {
  it("covers exactly Pi's native tool names", () => {
    for (const name of BUILT_INS) assert.equal(isBuiltIn(name), true, name);
    for (const name of ["mcp", "subagent", "TaskCreate", "web_search", ""]) {
      assert.equal(isBuiltIn(name), false, name);
    }
  });
});

describe("Config.compacts", () => {
  it("compacts every tool by default (blacklist, not whitelist)", () => {
    const config = new Config();
    // The old rule was a whitelist of built-ins + MCP, which silently exempted
    // every third-party tool that shipped its own renderer.
    for (const name of [...BUILT_INS, "mcp", "mcpScript", "mcp__atlassian", "TaskCreate", "web_search", "anything"]) {
      assert.equal(config.compacts(name), true, name);
    }
  });

  it("exempts only the configured tool names", () => {
    // `subagent` is excluded by DEFAULT, because its own renderer shows a run id
    // and state that one line cannot carry.
    assert.equal(new Config().compacts("subagent"), false);

    const custom = new Config({ excludeTools: ["web_search"] });
    assert.equal(custom.compacts("web_search"), false);
    // Replacing the list also un-excludes subagent: the list IS the policy.
    assert.equal(custom.compacts("subagent"), true);
  });

  it("labels pi-mcp-adapter tools as mcp without deciding what compacts", () => {
    refreshMcpTools([
      { name: "slack_search", sourceInfo: { path: "/packages/pi-mcp-adapter/index.ts" } },
      { name: "other_tool", sourceInfo: { path: "/extensions/other/index.ts" } },
    ]);

    assert.deepEqual(describeTool("slack_search", {}), { label: "mcp", details: "slack_search" });
    // Not an MCP tool, so it keeps its own name as the label.
    assert.equal(describeTool("other_tool", {}).label, "other_tool");
    refreshMcpTools([]);
  });
});

describe("describeTool", () => {
  it("splits every built-in into its label and details", () => {
    assert.deepEqual(describeTool("read", { path: "src/a.ts" }), { label: "read", details: "src/a.ts" });
    assert.deepEqual(describeTool("read", { path: "a.ts", offset: 10, limit: 5 }), { label: "read", details: "a.ts:10-14" });
    assert.deepEqual(describeTool("read", { path: "a.ts", offset: 10 }), { label: "read", details: "a.ts:10" });
    assert.deepEqual(describeTool("bash", { command: "go test ./..." }), { label: "bash", details: "go test ./..." });
    assert.deepEqual(describeTool("edit", { path: "src/b.ts" }), { label: "edit", details: "src/b.ts" });
    assert.deepEqual(describeTool("write", { path: "src/c.ts" }), { label: "write", details: "src/c.ts" });
    assert.deepEqual(describeTool("grep", { pattern: "foo", path: "src" }), { label: "grep", details: "/foo/ in src" });
    assert.deepEqual(describeTool("find", { pattern: "*.ts" }), { label: "find", details: "*.ts in ." });
    assert.deepEqual(describeTool("ls", {}), { label: "ls", details: "." });
  });

  it("shows the target MCP operation", () => {
    assert.deepEqual(describeTool("mcp", { tool: "atlassian_search" }), {
      label: "mcp",
      details: "atlassian_search",
    });
    assert.deepEqual(describeTool("mcp", { search: "calendar tools" }), {
      label: "mcp",
      details: "search calendar tools",
    });
    assert.deepEqual(describeTool("mcpScript", { code: "await tools.search({ query: 'logs' })" }), {
      label: "mcpScript",
      details: "await tools.search({ query: 'logs' })",
    });
    assert.deepEqual(describeTool("mcp__atlassian", { tool: "atlassian_search" }), {
      label: "mcp",
      details: "atlassian_search @ atlassian",
    });
  });

  it("uses the registered name for rendererless tools", () => {
    assert.deepEqual(describeTool("goland__execute_tool", {}), {
      label: "goland__execute_tool",
      details: "",
    });
  });

  it("uses actual operation names in run summaries", () => {
    assert.equal(summaryName("read", { path: "a.ts" }), "read");
    assert.equal(summaryName("goland__execute_tool", {}), "goland__execute_tool");
    assert.equal(summaryName("mcp", { tool: "atlassian_search" }), "atlassian_search");
    assert.equal(
      summaryName("mcp__atlassian", { tool: "atlassian_getConfluencePage" }),
      "atlassian_getConfluencePage @ atlassian",
    );
  });

  it("shows paths verbatim (no ~/ abbreviation)", () => {
    assert.equal(describeTool("read", { path: "/Users/me/x/y.ts" }).details, "/Users/me/x/y.ts");
  });

  it("collapses a multiline command into ONE row, collapsed and expanded", () => {
    const command = "python3 - <<'EOF'\nprint(1)\n\n  print(2)\nEOF";

    const collapsed = describeTool("bash", { command }, { budget: 100 }).details;
    const expanded = describeTool("bash", { command }, { expanded: true }).details;

    assert.ok(!collapsed.includes("\n"), "collapsed row must be single-line");
    assert.ok(!expanded.includes("\n"), "expanded row must be single-line");
    assert.equal(expanded, "python3 - <<'EOF' print(1) print(2) EOF");
  });

  it("truncates to the given width budget, not a fixed character count", () => {
    const command = "echo " + "y".repeat(300);

    // The budget comes from the real viewport width at render time. A wide
    // terminal therefore shows more, where the old fixed 100-char cap threw
    // away ~89 usable columns on a 200-column terminal.
    assert.equal(describeTool("bash", { command }, { budget: 60 }).details.length, 60);
    assert.equal(describeTool("bash", { command }, { budget: 180 }).details.length, 180);

    const collapsed = describeTool("bash", { command }, { budget: 100 }).details;
    const expanded = describeTool("bash", { command }, { expanded: true }).details;

    assert.equal(collapsed.length, 100);
    assert.ok(collapsed.endsWith("…"));
    assert.equal(expanded, command);
  });

  it("never throws on missing or incomplete arguments", () => {
    for (const name of BUILT_INS) {
      assert.doesNotThrow(() => describeTool(name, undefined));
      assert.doesNotThrow(() => describeTool(name, {}));
      assert.doesNotThrow(() => describeTool(name, { path: undefined, command: undefined }));
    }
    // Streaming args arrive incrementally, so partial JSON must still render.
    assert.equal(describeTool("bash", { command: "git st" }).details, "bash git st".slice(5));
    assert.equal(describeTool("read", {}).details, "", "an absent path leaves empty details, not a stray space");
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
