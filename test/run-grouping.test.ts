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
  return new RunGrouping(testConfig({ groupToolRuns: false }));
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
    const grouping = grouped({ thinkingAsToolCall: true });
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
    const grouping = grouped({ thinkingAsToolCall: true });
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
    const grouping = grouped({ thinkingAsToolCall: true });
    const first = {};
    const last = {};
    grouping.observeThinking(first, 0, true, false);
    grouping.observeThinking(last, 0, true, false);

    assert.equal(grouping.showsMessageSpacer(first), false);
    assert.equal(grouping.showsMessageSpacer(last), true);
  });

  it("keeps native thinking out of tool groups and recomputes on live toggles", () => {
    const config = new Config({ groupToolRuns: true });
    const grouping = new RunGrouping(config);
    const owner = {};
    observe(grouping, "read", "read");
    grouping.observeThinking(owner, 0, true, false);
    observe(grouping, "edit", "edit");
    const thinking = grouping.thinkingId(owner, 0);
    for (const compact of [false, true, false]) {
      config.set("thinkingAsToolCall", compact);
      assert.equal(grouping.view("read"), compact ? "hide" : "show");
      assert.equal(grouping.view(thinking), compact ? "hide" : "show");
      assert.deepEqual(grouping.view("edit"), compact ? summary({ done: ["read", "think", "edit"] }) : "show");
      assert.equal(grouping.showsMessageSpacer(owner), !compact);
    }
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

  it("opens a clicked activity summary into separate rows for good", () => {
    const grouping = grouped({ foldIntermediateActivity: true, groupToolRuns: true });
    grouping.agentStarted(0);
    const first = grouping.observeProse({}, 0);
    observe(grouping, "a", "read");
    observe(grouping, "b", "edit");
    grouping.observeProse({}, 0);
    assert.equal(grouping.isActivitySummary("b"), true);

    assert.equal(grouping.open("a"), false, "a hidden member draws no summary");
    assert.equal(grouping.open("b"), true);
    assert.equal(grouping.isActivitySummary("b"), false);
    // Opened rows must not fall back into the tool-run fold either.
    assert.deepEqual([grouping.view("a"), grouping.view("b")], ["show", "show"]);
    assert.equal(grouping.proseView(first, testPainter({}, plainTheme())), undefined);
  });
});

describe("re-folding an opened run", () => {
  const painter = testPainter({}, plainTheme());
  const base = (name: string) => () => ({ gutter: "|", text: name });
  const draw = (grouping: RunGrouping, id: string, p = painter) =>
    grouping.rowFor(id, p, base(id));

  function openRun(settings: Partial<Settings> = {}): RunGrouping {
    const grouping = grouped(settings);
    observe(grouping, "a", "read");
    observe(grouping, "b", "edit", "pending");
    observe(grouping, "c", "read");
    assert.equal(grouping.open("c"), true);
    return grouping;
  }

  it("draws the plain header on the first row only, keeping a running member", () => {
    const grouping = openRun();
    const head = draw(grouping, "a")!;
    assert.equal(head.text, "a");
    assert.equal(plain(head.header!.text), "▾ Expanded · click to fold");
    assert.equal(draw(grouping, "b")!.header, undefined);
    assert.equal(draw(grouping, "c")!.header, undefined);
  });

  it("closes only from the header row, folds back, and reopens", () => {
    const grouping = openRun();
    assert.equal(grouping.close("zzz"), false);
    assert.equal(grouping.close("a"), true);
    assert.equal(draw(grouping, "a"), null);
    assert.equal(plain(draw(grouping, "c")!.text), "✓ read ×2 · • edit ×1");
    assert.equal(grouping.open("c"), true);
    assert.equal(plain(draw(grouping, "a")!.header!.text), "▾ Expanded · click to fold");
  });

  it("uses a plain marker in the ascii style", () => {
    const grouping = openRun({ glyphStyle: "ascii" });
    const ascii = testPainter({ glyphStyle: "ascii" }, plainTheme());
    assert.equal(draw(grouping, "a", ascii)!.header!.text, "v Expanded - click to fold");
  });

  it("drops the header when grouping is turned off", () => {
    const config = testConfig({ groupToolRuns: true });
    const grouping = new RunGrouping(config);
    observe(grouping, "a", "read");
    observe(grouping, "b", "edit");
    grouping.open("b");
    config.set("groupToolRuns", false);
    assert.equal(draw(grouping, "a")!.header, undefined);
  });

  it("puts the header on the first prose or native-thinking member, which can host it", () => {
    const grouping = grouped({ foldIntermediateActivity: true, thinkingAsToolCall: false });
    const owner = {};
    grouping.agentStarted(0);
    const first = grouping.observeProse({}, 0);
    grouping.observeThinking(owner, 0, true, false);
    observe(grouping, "a", "read");
    observe(grouping, "b", "edit");
    grouping.observeProse({}, 0);
    grouping.agentSettled(5000);
    const think = grouping.thinkingId(owner, 0);
    const painter = testPainter({ foldIntermediateActivity: true, thinkingAsToolCall: false }, plainTheme());

    assert.equal(grouping.open("b"), true);
    assert.equal(plain(grouping.headerFor(first, painter)!.text), "▾ Expanded · click to fold");
    for (const id of [think, "a", "b"]) assert.equal(grouping.headerFor(id, painter), undefined, id);

    // Native thinking alone is a host too: a run it summarizes can be opened and closed.
    const lonely = grouped({ foldIntermediateActivity: true, thinkingAsToolCall: false });
    const other = {};
    lonely.agentStarted(0);
    const lead2 = lonely.observeProse({}, 0);
    lonely.observeThinking(other, 0, true, false);
    lonely.observeProse({}, 0);
    const id = lonely.thinkingId(other, 0);
    assert.equal(lonely.isActivitySummary(id), true);
    assert.equal(lonely.click(id, false), true);
    assert.notEqual(lonely.headerFor(lead2, painter), undefined);
    assert.equal(lonely.click(lead2, true), true);
    assert.equal(lonely.isActivitySummary(id), true, "folded again");
  });

  it("keeps the header on a compact thinking head while it is expanded, and after", () => {
    const grouping = grouped({ thinkingAsToolCall: true });
    const owner = {};
    grouping.observeThinking(owner, 0, true, false);
    observe(grouping, "a", "read");
    observe(grouping, "b", "edit");
    const think = grouping.thinkingId(owner, 0);
    assert.equal(grouping.open("b"), true);

    const headers = () => [think, "a", "b"].map((id) => draw(grouping, id)!.header !== undefined);
    assert.deepEqual(headers(), [true, false, false]);

    grouping.observeThinking(owner, 0, true, true); // Ctrl+T: now Markdown, not a CompactLine
    assert.deepEqual(headers(), [true, false, false], "still on the first member");

    grouping.observeThinking(owner, 0, true, false); // collapsed again
    assert.deepEqual(headers(), [true, false, false]);
    assert.equal(grouping.click(think, true), true, "the header row folds the run back");
    assert.equal(grouping.view("b") !== "show", true);
  });

  it("headers an opened activity summary on its first member and closes it", () => {
    const grouping = grouped({ foldIntermediateActivity: true });
    grouping.agentStarted(0);
    const lead = grouping.observeProse({}, 0);
    observe(grouping, "a", "read");
    observe(grouping, "b", "edit");
    grouping.observeProse({}, 0);
    grouping.agentSettled(5000);
    grouping.open("b");
    const painter = testPainter({}, plainTheme());
    assert.equal(plain(grouping.headerFor(lead, painter)!.text), "▾ Expanded · click to fold");
    assert.equal(draw(grouping, "a")!.header, undefined);
    assert.equal(draw(grouping, "b")!.header, undefined);
    assert.equal(grouping.close(lead), true);
    assert.equal(grouping.isActivitySummary("b"), true);
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
    const tool = (id: string) => {
      grouping.agentSettled(3_000);
      return grouping.rowFor(id, painter, () => ({ gutter: "", text: id }));
    };
    grouping.agentStarted(0);
    const first = grouping.observeProse({}, 0);
    observe(grouping, "read-1", "read");
    assert.equal(grouping.proseView(first, painter, 3_000), undefined, "no later prose yet");

    const second = grouping.observeProse({}, 0);
    assert.equal(grouping.proseView(first, painter, 3_000), null);
    assert.equal(plain(tool("read-1")!.text), "Worked for 3s");
    assert.equal(grouping.proseView(second, painter, 3_000), undefined);

    observe(grouping, "read-2", "read");
    const third = grouping.observeProse({}, 0);
    assert.equal(grouping.proseView(first, painter, 3_000), null);
    assert.equal(grouping.proseView(second, painter, 3_000), null);
    assert.equal(tool("read-1"), null);
    assert.equal(plain(tool("read-2")!.text), "Worked for 3s");
    assert.equal(grouping.proseView(third, painter, 3_000), undefined);
  });

  for (const activitySummary of ["elapsed", "tools"] as const) {
    for (const foldActivityOnFinalAnswer of [false, true]) {
      it(`never folds a cycle of prose only (${activitySummary}, final-answer wait ${foldActivityOnFinalAnswer})`, () => {
        const grouping = new RunGrouping(testConfig({
          foldIntermediateActivity: true,
          activitySummary,
          foldActivityOnFinalAnswer,
        }));
        grouping.agentStarted(0);
        const owners = [{}, {}, {}];
        const ids = [
          grouping.observeProse(owners[0], 0, { phase: "commentary" }),
          grouping.observeProse(owners[1], 0, { phase: "commentary" }),
          grouping.observeProse(owners[2], 0, { phase: "final_answer" }),
        ];
        grouping.agentSettled(5_000);
        for (const id of ids) {
          assert.equal(grouping.proseView(id, painter, 5_000), undefined);
          assert.equal(grouping.isActivitySummary(id), false);
        }
        for (const owner of owners) {
          assert.equal(grouping.activityMessageView(owner), "normal");
          assert.equal(grouping.showsMessageSpacer(owner), true);
        }
      });
    }
  }

  it("treats cycles independently: a prose-only cycle stays open, a later mixed one folds", () => {
    const grouping = new RunGrouping(testConfig({ foldIntermediateActivity: true }));
    grouping.agentStarted(0);
    const a1 = grouping.observeProse({}, 0);
    const a2 = grouping.observeProse({}, 0, { stopReason: "stop" });
    grouping.agentSettled(1_000);
    grouping.agentStarted(2_000);
    const b1 = grouping.observeProse({}, 0);
    observe(grouping, "read", "read");
    const b2 = grouping.observeProse({}, 0, { stopReason: "stop" });
    grouping.agentSettled(5_000);

    for (const id of [a1, a2, b2]) assert.equal(grouping.proseView(id, painter, 5_000), undefined);
    assert.equal(grouping.proseView(b1, painter, 5_000), null);
    assert.equal(
      plain(grouping.rowFor("read", painter, () => ({ gutter: "", text: "read" }))!.text),
      "Worked for 3s",
    );
  });

  it("waits for OpenAI's final-answer signal before folding commentary", () => {
    const grouping = new RunGrouping(testConfig({
      foldIntermediateActivity: true,
      foldActivityOnFinalAnswer: true,
    }));
    grouping.agentStarted(0);
    const commentary = grouping.observeProse({}, 0, { phase: "commentary" });
    observe(grouping, "read", "read");
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
    grouping.observeProse({}, 0);
    observe(grouping, "read", "read");
    grouping.observeProse({}, 0);
    grouping.agentSettled(66_000);
    assert.equal(
      plain(grouping.rowFor("read", painter, () => ({ gutter: "", text: "read" }))!.text),
      "Worked for 1m 5s",
    );
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
    const config = new Config({ groupToolRuns: false });
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
