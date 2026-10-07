import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BUILT_INS, block, compact, describeTool, isBuiltIn, refreshMcpTools, summaryName } from "../src/tools.ts";
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
    // Not a whitelist: third-party tools with their own renderer are compacted too.
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

  it("collapses a multiline command when budgeted, keeps its lines when not", () => {
    const command = "python3 - <<'EOF'\nprint(1)\n\n  print(2)\nEOF";

    const collapsed = describeTool("bash", { command }, { budget: 100 }).details;
    const expanded = describeTool("bash", { command }).details;

    assert.equal(collapsed, "python3 - <<'EOF' print(1) print(2) EOF");
    assert.equal(expanded, "python3 - <<'EOF'\nprint(1)\n\n  print(2)\nEOF");
  });

  it("shows a huge command in full when expanded, and only a slice of it scanned when budgeted", () => {
    const command = "echo " + "z".repeat(20000);
    assert.equal(describeTool("bash", { command }).details, command);
    const budgeted = describeTool("bash", { command }, { budget: 30 }).details;
    assert.equal(budgeted.length, 30);
    assert.ok(budgeted.endsWith("…"));
  });

  it("keeps lines for other tools' scalar details when expanded", () => {
    assert.equal(describeTool("grep", { pattern: "a\nb", path: "src" }).details, "/a\nb/ in src");
    assert.equal(describeTool("grep", { pattern: "a\nb", path: "src" }, { budget: 80 }).details, "/a b/ in src");
    assert.equal(describeTool("mcpScript", { code: "x\ny" }).details, "x\ny");
    assert.equal(describeTool("custom_tool", { prompt: "x\n\ny" }).details, "x\n\ny");
    // Expanded keeps the whole pattern; a budget clips it (the path survives).
    const pattern = "averyveryverylongpattern".repeat(3);
    assert.equal(describeTool("grep", { pattern, path: "src" }).details, `/${pattern}/ in src`);
    const clipped = describeTool("grep", { pattern, path: "src" }, { budget: 40 }).details;
    assert.ok(clipped.length <= 40 && clipped.endsWith("in src") && !clipped.includes(pattern), clipped);
  });

  it("turns terminal-affecting line separators into spaces when expanded", () => {
    const command = "a\vb\fc\u2028d\u2029e\u0085f\tg\r\nh";
    assert.equal(describeTool("bash", { command }).details, "a b c d e f  g\nh");
  });

  it("truncates to the given width budget, not a fixed character count", () => {
    const command = "echo " + "y".repeat(300);

    // The budget comes from the real viewport width at render time. A wide
    // terminal therefore shows more (no fixed character cap).
    assert.equal(describeTool("bash", { command }, { budget: 60 }).details.length, 60);
    assert.equal(describeTool("bash", { command }, { budget: 180 }).details.length, 180);

    const collapsed = describeTool("bash", { command }, { budget: 100 }).details;
    const expanded = describeTool("bash", { command }).details;

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

  it("has no length cap of its own", () => {
    assert.equal(compact("a ".repeat(20000)).length, 39999);
  });
});

describe("block", () => {
  it("normalizes line endings and tabs, trims outer blank lines and trailing spaces", () => {
    assert.equal(block("\n\n a  \r\n\tb\t\r\n\n"), " a\n  b");
    assert.equal(block("a\n\nb"), "a\n\nb");
    assert.equal(block(undefined), "");
    assert.equal(block(" \n \t"), "");
  });
});
