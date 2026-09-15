import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Config, DEFAULTS } from "../src/config.ts";
import { QuietMode, summarize, type QuietOutcome } from "../src/quiet-mode.ts";
import { plain, plainTheme } from "./test-support.ts";

function observe(mode: QuietMode, id: string, name: string, outcome: QuietOutcome = "success", expanded = false): void {
  mode.observe(id, name, outcome, expanded);
}

describe("quiet mode", () => {
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
    assert.deepEqual(mode.view("4"), {
      done: [{ name: "read", count: 2 }, { name: "edit", count: 2 }],
      failed: [],
      running: [],
    });
  });

  it("keeps a single low-noise action visible", () => {
    const mode = new QuietMode();
    observe(mode, "1", "read");
    mode.toggle();
    assert.equal(mode.view("1"), "show");
  });

  it("folds failures and RUNNING calls, but cuts runs at expanded calls", () => {
    const mode = new QuietMode();
    observe(mode, "read-1", "read");
    observe(mode, "generic", "goland__execute_tool");
    observe(mode, "edit-1", "edit");
    observe(mode, "failed", "read", "failure");
    observe(mode, "pending", "bash", "pending");
    observe(mode, "edit-2", "edit");
    observe(mode, "expanded", "read", "success", true);
    observe(mode, "find", "find");
    observe(mode, "ls", "ls");
    mode.toggle();

    // A running call folds by DEFAULT: the fold is recomputed on every render,
    // so the row reappears the moment it matters.
    for (const id of ["read-1", "generic", "edit-1", "failed", "pending"]) {
      assert.equal(mode.view(id), "hide", id);
    }
    assert.deepEqual(mode.view("edit-2"), {
      done: [{ name: "read", count: 1 }, { name: "goland__execute_tool", count: 1 }, { name: "edit", count: 2 }],
      failed: [{ name: "read", count: 1 }],
      // The running bash is counted, not silently dropped.
      running: [{ name: "bash", count: 1 }],
    });
    // An EXPANDED call is a hard boundary either way: the user asked to see it.
    assert.equal(mode.view("expanded"), "show");
    assert.equal(mode.view("find"), "hide");
    assert.deepEqual(mode.view("ls"), {
      done: [{ name: "find", count: 1 }, { name: "ls", count: 1 }],
      failed: [],
      running: [],
    });
  });

  it("keeps RUNNING calls out of a fold when configured", () => {
    const config = new Config({ ...DEFAULTS, groupToolRuns: true, keepActiveToolsExpanded: true });
    const mode = new QuietMode(config);
    observe(mode, "read-1", "read");
    observe(mode, "read-2", "read");
    observe(mode, "pending", "bash", "pending");
    observe(mode, "find", "find");
    observe(mode, "ls", "ls");

    // The running row splits the transcript into two independent runs.
    assert.equal(mode.view("read-1"), "hide");
    assert.deepEqual(mode.view("read-2"), { done: [{ name: "read", count: 2 }], failed: [], running: [] });
    assert.equal(mode.view("pending"), "show");
    assert.equal(mode.view("find"), "hide");
    assert.deepEqual(mode.view("ls"), {
      done: [{ name: "find", count: 1 }, { name: "ls", count: 1 }],
      failed: [],
      running: [],
    });
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
    assert.deepEqual(mode.view(mode.thinkingId(owner, 1)), {
      done: [{ name: "bash", count: 1 }, { name: "edit", count: 1 }, { name: "think", count: 2 }],
      failed: [],
      running: [],
    });
  });

  it("hides only a message spacer whose thinking row is quiet-hidden", () => {
    const mode = new QuietMode(true);
    const first = {};
    const last = {};
    mode.observeThinking(first, 0, true, false);
    mode.observeThinking(last, 0, true, false);

    assert.equal(mode.showMessageSpacer(first), false);
    assert.equal(mode.showMessageSpacer(last), true);
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
    assert.deepEqual(summarize(["read", "edit", "read", "ls", "edit"]), [
      { name: "read", count: 2 },
      { name: "edit", count: 2 },
      { name: "ls", count: 1 },
    ]);
  });
});

describe("rowFor", () => {
  const theme = plainTheme();
  const base = () => ({ gutter: "|", text: "BASE" });

  it("is the ONE place quiet state becomes a drawable row", () => {
    const mode = new QuietMode();
    observe(mode, "1", "read");
    observe(mode, "2", "edit");

    // Disabled: every row draws itself.
    assert.deepEqual(mode.rowFor("1", theme, base), { gutter: "|", text: "BASE" });

    mode.toggle();
    assert.equal(mode.rowFor("1", theme, base), null, "folded members draw nothing");
    assert.equal(plain(mode.rowFor("2", theme, base)!.text), "✓ read ×1, edit ×1", "the tail carries the summary");
  });

  it("does not call the base row builder for a hidden row", () => {
    const mode = new QuietMode(true);
    observe(mode, "1", "read");
    observe(mode, "2", "edit");
    let built = 0;
    mode.rowFor("1", theme, () => {
      built++;
      return base();
    });
    assert.equal(built, 0);
  });
});
