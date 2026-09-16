import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Config, type Settings } from "../src/config.ts";
import { countNames, formatDuration, RunGrouping, type Outcome } from "../src/run-grouping.ts";
import { plain, plainTheme, testConfig, testPainter } from "./test-support.ts";

function observe(grouping: RunGrouping, id: string, name: string, outcome: Outcome = "success", expanded = false): void {
  grouping.observe(id, name, outcome, expanded);
}

/** Grouping with folding OFF, to assert the disabled baseline. */
function ungrouped(): RunGrouping {
  return new RunGrouping(testConfig());
}

/** Grouping with folding ON, which is what most of these tests need. */
function grouped(settings: Partial<Settings> = {}): RunGrouping {
  return new RunGrouping(testConfig({ groupToolRuns: true, ...settings }));
}

/** Only the groups a test cares about; the rest stay empty. */
function summary(groups: { done?: string[]; failed?: string[]; running?: string[] }) {
  return {
    done: countNames(groups.done ?? []),
    failed: countNames(groups.failed ?? []),
    running: countNames(groups.running ?? []),
  };
}

describe("run grouping", () => {
  it("draws every row itself while disabled", () => {
    const grouping = ungrouped();
    observe(grouping, "1", "read");
    observe(grouping, "2", "edit");

    assert.equal(grouping.enabled, false);
    assert.equal(grouping.view("1"), "show");
    assert.equal(grouping.view("2"), "show");
  });

  it("folds an alternating completed run into its final line", () => {
    const grouping = grouped();
    observe(grouping, "1", "read");
    observe(grouping, "2", "edit");
    observe(grouping, "3", "read");
    observe(grouping, "4", "edit");

    // Only the LAST row of a run draws anything.
    for (const id of ["1", "2", "3"]) assert.equal(grouping.view(id), "hide", id);
    assert.deepEqual(grouping.view("4"), summary({ done: ["read", "edit", "read", "edit"] }));
  });

  it("leaves a lone foldable row alone, because folding it saves no lines", () => {
    const grouping = grouped();
    observe(grouping, "only", "read");
    assert.equal(grouping.view("only"), "show");
  });

  it("folds failures and RUNNING rows, but stops at an expanded row", () => {
    const grouping = grouped();
    observe(grouping, "read-1", "read");
    observe(grouping, "generic", "goland__execute_tool");
    observe(grouping, "failed", "read", "failure");
    observe(grouping, "pending", "bash", "pending");
    observe(grouping, "edit", "edit");
    observe(grouping, "expanded", "read", "success", true);
    observe(grouping, "find", "find");
    observe(grouping, "ls", "ls");

    // A running row folds by DEFAULT: folds are recomputed every render, so it
    // reappears the moment it matters, and the summary still counts it.
    for (const id of ["read-1", "generic", "failed", "pending"]) {
      assert.equal(grouping.view(id), "hide", id);
    }
    assert.deepEqual(
      grouping.view("edit"),
      summary({ done: ["read", "goland__execute_tool", "edit"], failed: ["read"], running: ["bash"] }),
    );
    // An EXPANDED row is a hard boundary: the user asked to see it.
    assert.equal(grouping.view("expanded"), "show");
    assert.equal(grouping.view("find"), "hide");
    assert.deepEqual(grouping.view("ls"), summary({ done: ["find", "ls"] }));
  });

  it("keeps a RUNNING row out of a fold when configured", () => {
    const grouping = grouped({ keepActiveToolsExpanded: true });
    observe(grouping, "read-1", "read");
    observe(grouping, "read-2", "read");
    observe(grouping, "pending", "bash", "pending");
    observe(grouping, "find", "find");
    observe(grouping, "ls", "ls");

    // The running row now splits the transcript into two independent runs.
    assert.equal(grouping.view("read-1"), "hide");
    assert.deepEqual(grouping.view("read-2"), summary({ done: ["read", "read"] }));
    assert.equal(grouping.view("pending"), "show");
    assert.equal(grouping.view("find"), "hide");
    assert.deepEqual(grouping.view("ls"), summary({ done: ["find", "ls"] }));
  });

  it("unifies completed thinking and tool rows in transcript order", () => {
    const grouping = grouped();
    const owner = {};
    observe(grouping, "bash", "bash");
    grouping.observeThinking(owner, 0, true, false);
    observe(grouping, "edit", "edit");
    grouping.observeThinking(owner, 1, true, false);

    assert.equal(grouping.view("bash"), "hide");
    assert.equal(grouping.view("edit"), "hide");
    assert.equal(grouping.view(grouping.thinkingId(owner, 0)), "hide");
    // First-seen order, so the interleaved thinking sits between the tools:
    // bash, think, edit — not all tools followed by all thinking.
    assert.deepEqual(
      grouping.view(grouping.thinkingId(owner, 1)),
      summary({ done: ["bash", "think", "edit", "think"] }),
    );
  });

  it("uses expanded thinking and prose as run boundaries", () => {
    const grouping = grouped();
    const owner = {};
    observe(grouping, "read", "read");
    grouping.observeThinking(owner, 0, true, true);
    observe(grouping, "edit", "edit");
    grouping.observeProse(owner, 1);
    observe(grouping, "write", "write");

    for (const id of ["read", grouping.thinkingId(owner, 0), "edit", "write"]) {
      assert.equal(grouping.view(id), "show", id);
    }
  });

  it("hides a message spacer only when every row of that message is hidden", () => {
    const grouping = grouped();
    const first = {};
    const last = {};
    grouping.observeThinking(first, 0, true, false);
    grouping.observeThinking(last, 0, true, false);

    assert.equal(grouping.showsMessageSpacer(first), false);
    assert.equal(grouping.showsMessageSpacer(last), true);
  });

  it("restores individual rows when the setting is turned back off", () => {
    // The live Config is the single source of truth, so a toggle re-folds
    // existing history with no rebuild.
    const config = new Config({ groupToolRuns: true });
    const grouping = new RunGrouping(config);
    observe(grouping, "1", "read");
    observe(grouping, "2", "ls");

    assert.equal(grouping.view("1"), "hide");
    config.set("groupToolRuns", false);
    assert.equal(grouping.view("1"), "show");
    assert.equal(grouping.view("2"), "show");
  });

  it("computes fold views once per state revision", () => {
    const grouping = grouped({ foldIntermediateActivity: true });
    grouping.observeProse({}, 0);
    const ids = Array.from({ length: 240 }, (_, index) => `tool-${index}`);
    for (const id of ids) observe(grouping, id, "read");
    grouping.observeProse({}, 0);

    const internals = grouping as unknown as {
      foldable(entry: unknown): boolean;
      activityFoldable(entry: unknown): boolean;
    };
    const foldable = internals.foldable.bind(grouping);
    const activityFoldable = internals.activityFoldable.bind(grouping);
    let checks = 0;
    internals.foldable = (entry) => { checks++; return foldable(entry); };
    internals.activityFoldable = (entry) => { checks++; return activityFoldable(entry); };

    for (const id of ids) grouping.view(id);
    const firstRenderChecks = checks;
    for (const id of ids) grouping.view(id);
    assert.equal(checks, firstRenderChecks, "unchanged rows must reuse the computed views");
    assert.ok(firstRenderChecks < ids.length * 4, `expected one linear pass, got ${firstRenderChecks} checks`);

    observe(grouping, ids[0], "read", "failure");
    grouping.view(ids[0]);
    assert.ok(checks > firstRenderChecks, "an outcome change must invalidate the views");
  });
});

describe("countNames", () => {
  it("counts names in first-seen order", () => {
    assert.deepEqual(countNames(["read", "edit", "read", "ls", "edit"]), [
      { name: "read", count: 2 },
      { name: "edit", count: 2 },
      { name: "ls", count: 1 },
    ]);
  });
});

describe("prose folding", () => {
  const painter = testPainter({}, plainTheme());

  it("dynamically keeps the latest prose and moves one summary behind it", () => {
    const grouping = new RunGrouping(testConfig({ foldIntermediateActivity: true }));
    grouping.agentStarted(0);
    const first = grouping.observeProse({}, 0);
    assert.equal(grouping.proseView(first, painter, 3_000), undefined);

    const second = grouping.observeProse({}, 0);
    assert.equal(plain(grouping.proseView(first, painter, 3_000)!.text), "Worked for 3s");
    assert.equal(grouping.proseView(second, painter, 3_000), undefined);

    const third = grouping.observeProse({}, 0);
    assert.equal(grouping.proseView(first, painter, 3_000), null);
    assert.equal(plain(grouping.proseView(second, painter, 3_000)!.text), "Worked for 3s");
    assert.equal(grouping.proseView(third, painter, 3_000), undefined);
  });

  it("waits for OpenAI's final-answer signal before folding commentary", () => {
    const grouping = new RunGrouping(testConfig({
      foldIntermediateActivity: true,
      foldActivityOnFinalAnswer: true,
    }));
    grouping.agentStarted(0);
    const commentary = grouping.observeProse({}, 0, { phase: "commentary" });
    grouping.observeProse({}, 0, { phase: "commentary" });
    assert.equal(grouping.proseView(commentary, painter, 2_000), undefined, "commentary remains visible");

    const final = grouping.observeProse({}, 0, { phase: "final_answer" });
    assert.equal(grouping.proseView(commentary, painter, 2_000), null, "folds on explicit final phase");
    assert.equal(grouping.proseView(final, painter, 2_000), undefined);
  });

  it("collapses prose, tools, and thinking into one tool summary", () => {
    const grouping = new RunGrouping(testConfig({
      foldIntermediateActivity: true,
      activitySummary: "tools",
    }));
    grouping.agentStarted(0);
    const first = grouping.observeProse({}, 0);
    observe(grouping, "read-1", "read");
    const middle = grouping.observeProse({}, 0);
    observe(grouping, "read-2", "read");
    observe(grouping, "bash", "bash", "failure");
    const thinkingOwner = {};
    grouping.observeThinking(thinkingOwner, 0, true, false);
    const thinking = grouping.thinkingId(thinkingOwner, 0);
    const final = grouping.observeProse({}, 0);

    // Hidden prose is transparent: it no longer splits the tools into several
    // neighbouring group summaries. The final pre-answer row owns ONE summary.
    for (const id of [first, middle]) assert.equal(grouping.proseView(id, painter), null);
    for (const id of ["read-1", "read-2", "bash"]) {
      assert.equal(grouping.rowFor(id, painter, () => ({ gutter: "", text: id })), null);
    }
    assert.equal(
      plain(grouping.rowFor(thinking, painter, () => ({ gutter: "", text: "thinking" }))!.text),
      "✓ read ×2, think ×1 · ✗ bash ×1",
    );
    assert.equal(grouping.proseView(final, painter), undefined);
  });

  it("replaces prior tool rows with elapsed time instead of adding another line", () => {
    const grouping = new RunGrouping(testConfig({ foldIntermediateActivity: true }));
    grouping.agentStarted(0);
    const prose = grouping.observeProse({}, 0);
    observe(grouping, "read", "read");
    grouping.observeProse({}, 0);
    grouping.agentSettled(4_000);

    assert.equal(grouping.proseView(prose, painter, 4_000), null);
    assert.equal(
      plain(grouping.rowFor("read", painter, () => ({ gutter: "", text: "read must not remain" }))!.text),
      "Worked for 4s",
    );
  });

  it("freezes elapsed time when the agent settles", () => {
    const grouping = new RunGrouping(testConfig({ foldIntermediateActivity: true }));
    grouping.agentStarted(1_000);
    const first = grouping.observeProse({}, 0);
    grouping.observeProse({}, 0);
    grouping.agentSettled(66_000);
    assert.equal(plain(grouping.proseView(first, painter, 99_000)!.text), "Worked for 1m 5s");
  });

  it("rebuilds replay boundaries and preserves every interaction's final prose", () => {
    const grouping = new RunGrouping(testConfig({
      foldIntermediateActivity: true,
      activitySummary: "tools",
    }));

    const progress1 = grouping.observeProse({}, 0, { phase: "commentary", timestamp: 0 });
    observe(grouping, "read", "read");
    const final1 = grouping.observeProse({}, 0, {
      phase: "final_answer",
      stopReason: "stop",
      streaming: false,
      timestamp: 1_000,
    });
    const progress2 = grouping.observeProse({}, 0, { phase: "commentary", timestamp: 2_000 });
    observe(grouping, "bash", "bash");
    const final2 = grouping.observeProse({}, 0, {
      stopReason: "stop",
      streaming: false,
      timestamp: 3_000,
    });

    assert.equal(grouping.proseView(progress1, painter), null);
    assert.equal(plain(grouping.rowFor("read", painter, () => ({ gutter: "", text: "read" }))!.text), "✓ read ×1");
    assert.equal(grouping.proseView(final1, painter), undefined, "first interaction final remains visible");
    assert.equal(grouping.proseView(progress2, painter), null);
    assert.equal(plain(grouping.rowFor("bash", painter, () => ({ gutter: "", text: "bash" }))!.text), "✓ bash ×1");
    assert.equal(grouping.proseView(final2, painter), undefined, "second interaction final remains visible");
  });

  it("formats compact durations", () => {
    assert.equal(formatDuration(59_999), "59s");
    assert.equal(formatDuration(127_000), "2m 7s");
    assert.equal(formatDuration(3_900_000), "1h 5m");
  });
});

describe("rowFor", () => {
  const painter = testPainter({}, plainTheme());
  const base = () => ({ gutter: "|", text: "BASE" });

  it("is the ONE place grouping state becomes a drawable row", () => {
    const config = new Config();
    const grouping = new RunGrouping(config);
    observe(grouping, "1", "read");
    observe(grouping, "2", "edit");

    // Disabled: every row draws itself.
    assert.deepEqual(grouping.rowFor("1", painter, base), { gutter: "|", text: "BASE" });

    config.set("groupToolRuns", true);
    assert.equal(grouping.rowFor("1", painter, base), null, "folded members draw nothing");
    assert.equal(
      plain(grouping.rowFor("2", painter, base)!.text),
      "✓ read ×1, edit ×1",
      "the tail carries the summary",
    );
  });

  it("does not build the base row for a hidden row", () => {
    const grouping = grouped();
    observe(grouping, "1", "read");
    observe(grouping, "2", "edit");
    let built = 0;
    grouping.rowFor("1", painter, () => {
      built++;
      return base();
    });
    assert.equal(built, 0);
  });
});
