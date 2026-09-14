import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { QUIET_TOOLS, QuietMode, summarize } from "../src/quiet-mode.ts";

function observe(mode: QuietMode, id: string, name: string, done = true, expanded = false): void {
  mode.observe(id, name, done, expanded);
}

describe("quiet mode", () => {
  it("whitelists only routine file operations", () => {
    assert.deepEqual([...QUIET_TOOLS], ["read", "edit", "write", "grep", "find", "ls", "bash", "toolcall", "think"]);
    assert.equal(QUIET_TOOLS.has("bash"), true);
    assert.equal(QUIET_TOOLS.has("toolcall"), true);
  });

  it("folds an alternating completed low-noise run into its final line", () => {
    const mode = new QuietMode();
    observe(mode, "1", "read");
    observe(mode, "2", "edit");
    observe(mode, "3", "read");
    observe(mode, "4", "edit");

    assert.equal(mode.view("1"), "show", "quiet starts disabled");
    mode.toggle();
    assert.equal(mode.view("1"), "hide");
    assert.equal(mode.view("2"), "hide");
    assert.equal(mode.view("3"), "hide");
    assert.deepEqual(mode.view("4"), { summary: "read ×2, edit ×2" });
  });

  it("keeps a single low-noise action visible", () => {
    const mode = new QuietMode();
    observe(mode, "1", "read");
    mode.toggle();
    assert.equal(mode.view("1"), "show");
  });

  it("folds generic toolcalls, but cuts runs at failed, running, and expanded calls", () => {
    const mode = new QuietMode();
    observe(mode, "read-1", "read");
    observe(mode, "generic", "toolcall");
    observe(mode, "edit-1", "edit");
    observe(mode, "failed", "read", false);
    observe(mode, "edit-2", "edit");
    observe(mode, "expanded", "read", true, true);
    observe(mode, "find", "find");
    observe(mode, "ls", "ls");
    mode.toggle();

    assert.equal(mode.view("read-1"), "hide");
    assert.equal(mode.view("generic"), "hide");
    assert.deepEqual(mode.view("edit-1"), { summary: "read ×1, toolcall ×1, edit ×1" });
    for (const id of ["failed", "edit-2", "expanded"]) assert.equal(mode.view(id), "show", id);
    assert.equal(mode.view("find"), "hide");
    assert.deepEqual(mode.view("ls"), { summary: "find ×1, ls ×1" });
  });

  it("unifies completed thinking and tool calls in transcript order", () => {
    const mode = new QuietMode(true);
    const owner = {};
    observe(mode, "bash", "bash");
    observe(mode, "edit", "edit");
    mode.observeThinking(owner, 0, true, false);
    mode.observeThinking(owner, 1, true, false);

    assert.equal(mode.view("bash"), "hide");
    assert.equal(mode.view("edit"), "hide");
    assert.equal(mode.view(mode.thinkingId(owner, 0)), "hide");
    assert.deepEqual(mode.view(mode.thinkingId(owner, 1)), { summary: "bash ×1, edit ×1, think ×2" });
  });

  it("uses expanded thinking and prose as quiet-run boundaries", () => {
    const mode = new QuietMode(true);
    const owner = {};
    observe(mode, "read", "read");
    mode.observeThinking(owner, 0, true, true);
    observe(mode, "edit", "edit");
    mode.observeProse(owner, 1);
    observe(mode, "write", "write");

    for (const id of ["read", mode.thinkingId(owner, 0), "edit", "write"]) assert.equal(mode.view(id), "show", id);
  });

  it("restores individual rows when toggled back off", () => {
    const mode = new QuietMode();
    observe(mode, "1", "read");
    observe(mode, "2", "ls");
    mode.toggle();
    assert.equal(mode.view("1"), "hide");
    mode.toggle();
    assert.equal(mode.view("1"), "show");
    assert.equal(mode.view("2"), "show");
  });
});

describe("summarize", () => {
  it("counts names in first-seen order", () => {
    assert.equal(summarize(["read", "edit", "read", "ls", "edit"]), "read ×2, edit ×2, ls ×1");
  });
});
