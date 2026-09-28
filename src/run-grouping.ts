/**
 * Folding adjacent low-noise rows into one summary (the `groupToolRuns` setting).
 *
 * Formerly `quiet-mode.ts` / `QuietMode`, named after a `/quiet` command that no
 * longer exists.
 *
 * WHY THIS STATE EXISTS AT ALL
 * ---------------------------
 * Each tool row is an independent transcript entry that knows nothing about its
 * neighbours, but folding is a question about NEIGHBOURS. Their renderers are
 * constructed in transcript order, so recording that order here lets every row
 * decide AT RENDER TIME whether it is hidden, unchanged, or the visible tail of a
 * folded run. That is what makes a settings toggle re-fold existing history with
 * no core rebuild and no core patch.
 */

import type { Config } from "./config.ts";
import type { Count, Painter, Row, RunSummary } from "./row.ts";

export type Outcome = "success" | "failure" | "pending";

type EntryKind = "tool" | "thinking" | "prose";

type Entry = {
  id: string;
  name: string;
  outcome: Outcome;
  kind: EntryKind;
  cycle: number;
  /** The user expanded this row (Ctrl+O), so it must stay visible. */
  expanded: boolean;
  /** False for rows that are never folded, e.g. assistant prose. */
  foldable: boolean;
};

type Cycle = { startedAt: number; settledAt?: number; finalAnswerStarted: boolean };

/** "show" keeps the row as-is, "hide" draws nothing, a summary folds a whole run. */
export type RowView = "show" | "hide" | RunSummary;
type ActivityState = "show" | "hide" | "summary";
type ViewCache = {
  key: string;
  activity: Map<string, ActivityState>;
  grouped: Map<string, RowView>;
  actions: Map<number, RunSummary>;
};

export class RunGrouping {
  private config: Config;
  private entries: Entry[] = [];
  private byId = new Map<string, Entry>();
  private ownerIds = new WeakMap<object, number>();
  private ownerEntries = new Map<number, Set<string>>();
  private nextOwnerId = 1;
  private cycle = 0;
  private cycles = new Map<number, Cycle>();
  private agentActive = false;
  private version = 0;
  private cache?: ViewCache;

  constructor(config: Config) {
    this.config = config;
  }

  get enabled(): boolean {
    return this.config.get("groupToolRuns");
  }

  /** Start/finish one user-prompt agent cycle without discarding old transcript state. */
  agentStarted(now = Date.now()): void {
    // Replay leaves `cycle` pointing at the next empty slot. A subsequent live
    // interaction can use it directly; consecutive live interactions advance.
    if (this.entries.some((entry) => entry.cycle === this.cycle)) this.cycle++;
    this.cycles.set(this.cycle, { startedAt: now, finalAnswerStarted: false });
    this.agentActive = true;
    this.invalidateViews();
  }

  agentSettled(now = Date.now()): void {
    const cycle = this.cycles.get(this.cycle);
    if (cycle) cycle.settledAt = now;
    this.agentActive = false;
  }

  /** Record the current row state. Re-renders update one stable entry in place. */
  observe(
    id: string,
    name: string,
    outcome: Outcome,
    expanded: boolean,
    foldable = true,
    kind: EntryKind = "tool",
  ): void {
    const existing = this.byId.get(id);
    if (!existing) {
      const entry: Entry = { id, name, outcome, kind, cycle: this.cycle, expanded, foldable };
      this.byId.set(id, entry);
      this.entries.push(entry);
      this.invalidateViews();
      return;
    }
    if (
      existing.name === name &&
      existing.outcome === outcome &&
      existing.expanded === expanded &&
      existing.foldable === foldable &&
      existing.kind === kind
    ) return;
    existing.name = name;
    existing.outcome = outcome;
    existing.expanded = expanded;
    existing.foldable = foldable;
    existing.kind = kind;
    this.invalidateViews();
  }

  /** Observe a thinking block by its component identity and local run index. */
  observeThinking(owner: object, runIndex: number, done: boolean, expanded: boolean): void {
    const id = this.thinkingId(owner, runIndex);
    this.rememberOwnerEntry(owner, id);
    this.observe(id, "think", done ? "success" : "pending", expanded, true, "thinking");
  }

  /**
   * Record prose and return its stable id. `stopReason=stop` is available on the
   * first empty final-answer update, before OpenAI streams its first text delta;
   * the finalized block later confirms the same fact through `phase`.
   */
  observeProse(
    owner: object,
    contentIndex: number,
    signal: {
      phase?: "commentary" | "final_answer";
      stopReason?: string;
      streaming?: boolean;
      timestamp?: number;
    } = {},
  ): string {
    const id = `prose:${this.ownerId(owner)}:${contentIndex}`;
    const isNew = !this.byId.has(id);
    const timestamp = signal.timestamp ?? Date.now();
    if (!this.cycles.has(this.cycle)) {
      this.cycles.set(this.cycle, { startedAt: timestamp, finalAnswerStarted: false });
    }
    this.rememberOwnerEntry(owner, id);
    this.observe(id, "prose", "pending", false, false, "prose");

    const isFinal = signal.phase === "final_answer" || signal.stopReason === "stop";
    const cycle = this.cycles.get(this.byId.get(id)!.cycle)!;
    if (isFinal && !cycle.finalAnswerStarted) {
      cycle.finalAnswerStarted = true;
      this.invalidateViews();
    }

    // session replay has no agent_start/agent_settled events. A newly observed,
    // finalized answer is therefore the only reliable boundary between old user
    // interactions. Advance AFTER assigning the answer so it remains the latest
    // prose of its own cycle; stable ids prevent re-renders from advancing twice.
    if (!this.agentActive && isNew && isFinal && !signal.streaming) {
      cycle.settledAt = timestamp;
      this.cycle++;
    }
    return id;
  }

  /**
   * `undefined` keeps native prose, `null` hides it, and a Row replaces all
   * earlier prose. This is resolved on every render, so a newly streamed block
   * immediately moves the summary forward without rebuilding old components.
   */
  proseView(id: string, painter: Painter, now = Date.now()): Row | null | undefined {
    const entry = this.byId.get(id);
    const state = this.activityState(entry);
    if (state === "show") return undefined;
    if (state === "hide") return null;
    return this.activitySummary(entry!, painter, now);
  }

  /** True when this row owns the single folded-activity replacement. */
  isActivitySummary(id: string): boolean {
    return this.activityState(this.byId.get(id)) === "summary";
  }

  /** Let the host component remove spacer-only output or normalize its summary gap. */
  activityMessageView(owner: object): "normal" | "hidden" | "summary" {
    const ids = this.ownerEntries.get(this.ownerId(owner));
    if (!ids) return "normal";
    const states = [...ids].map((id) => this.activityState(this.byId.get(id)));
    if (states.includes("summary")) return "summary";
    return states.length > 0 && states.every((state) => state === "hide") ? "hidden" : "normal";
  }

  thinkingId(owner: object, runIndex: number): string {
    return `think:${this.ownerId(owner)}:${runIndex}`;
  }

  /** Hide a message's leading spacer only when every one of its rows is hidden. */
  showsMessageSpacer(owner: object): boolean {
    const entries = this.ownerEntries.get(this.ownerId(owner));
    return !entries || [...entries].some((id) => {
      const entry = this.byId.get(id);
      const activity = this.activityState(entry);
      // A summary row draws its own compact line; unlike native prose it does
      // not need the AssistantMessageComponent's leading blank spacer.
      if (activity !== "show") return false;
      return entry?.kind === "prose" || this.view(id) !== "hide";
    });
  }

  /**
   * The single translation from grouping state to something drawable: the row's
   * own appearance, nothing at all, or the folded run summary.
   *
   * Every feature routes through here, so fold semantics live in exactly one
   * place. `base` is a thunk so an unfolded row is only painted when needed.
   */
  rowFor(id: string, painter: Painter, base: () => Row): Row | null {
    const entry = this.byId.get(id);
    const activity = this.activityState(entry);
    if (activity === "hide") return null;
    if (activity === "summary") return this.activitySummary(entry!, painter);

    const view = this.view(id);
    if (view === "show") return base();
    if (view === "hide") return null;
    return painter.summary(view);
  }

  view(id: string): RowView {
    return this.views().grouped.get(id) ?? "show";
  }

  /**
   * Can this entry disappear into a run summary?
   *
   * A RUNNING entry folds by default: folds are recomputed on every render, so
   * the row reappears the moment it matters, and the summary still counts it in
   * its `running` group. `keepActiveToolsExpanded` opts out for people who want
   * to watch a long command in place.
   */
  /** Collapse every collapsible row before the latest prose into ONE activity summary. */
  private activityState(entry: Entry | undefined): ActivityState {
    return entry ? (this.views().activity.get(entry.id) ?? "show") : "show";
  }

  private activitySummary(entry: Entry, painter: Painter, now = Date.now()): Row {
    const cycle = this.cycles.get(entry.cycle);
    const actions = this.views().actions.get(entry.cycle);
    if (this.config.get("activitySummary") === "tools" && actions) {
      return painter.summary(actions);
    }
    const elapsed = Math.max(0, (cycle?.settledAt ?? now) - (cycle?.startedAt ?? now));
    return painter.labeled({ label: "Worked", details: `for ${formatDuration(elapsed)}` });
  }

  private views(): ViewCache {
    const key = [
      this.version,
      this.config.get("groupToolRuns"),
      this.config.get("thinkingAsToolCall"),
      this.config.get("foldIntermediateActivity"),
      this.config.get("foldActivityOnFinalAnswer"),
      this.config.get("keepActiveToolsExpanded"),
    ].join(":");
    if (this.cache?.key === key) return this.cache;

    const activity = new Map<string, ActivityState>();
    const grouped = new Map<string, RowView>();
    const actions = new Map<number, RunSummary>();

    if (this.enabled) {
      for (let first = 0; first < this.entries.length;) {
        if (!this.foldable(this.entries[first])) {
          first++;
          continue;
        }
        let last = first + 1;
        while (last < this.entries.length && this.foldable(this.entries[last])) last++;
        if (last - first > 1) {
          for (let index = first; index < last - 1; index++) grouped.set(this.entries[index].id, "hide");
          grouped.set(this.entries[last - 1].id, summarize(this.entries.slice(first, last)));
        }
        first = last;
      }
    }

    if (this.config.get("foldIntermediateActivity")) {
      const byCycle = new Map<number, Entry[]>();
      for (const entry of this.entries) {
        const entries = byCycle.get(entry.cycle) ?? [];
        entries.push(entry);
        byCycle.set(entry.cycle, entries);
      }
      for (const [cycleId, entries] of byCycle) {
        const prose = entries.filter((entry) => entry.kind === "prose");
        const cycle = this.cycles.get(cycleId);
        if (
          prose.length < 2 ||
          (this.config.get("foldActivityOnFinalAnswer") && !cycle?.finalAnswerStarted)
        ) continue;

        const beforeLatest = entries.slice(0, entries.indexOf(prose.at(-1)!));
        const collapsible = beforeLatest.filter((entry) => this.activityFoldable(entry));
        for (let index = 0; index < collapsible.length - 1; index++) {
          activity.set(collapsible[index].id, "hide");
        }
        const tail = collapsible.at(-1);
        if (tail) activity.set(tail.id, "summary");
        const actionEntries = beforeLatest.filter((entry) => entry.kind !== "prose");
        if (actionEntries.length > 0) actions.set(cycleId, summarize(actionEntries));
      }
    }

    return (this.cache = { key, activity, grouped, actions });
  }

  private invalidateViews(): void {
    this.version++;
    this.cache = undefined;
  }

  private activityFoldable(entry: Entry): boolean {
    if (entry.expanded) return false;
    if (entry.outcome === "pending" && entry.kind !== "prose" && this.config.get("keepActiveToolsExpanded")) {
      return false;
    }
    return true;
  }

  private foldable(entry: Entry | undefined): boolean {
    if (!entry?.foldable || entry.expanded) return false;
    if (entry.kind === "thinking" && !this.config.get("thinkingAsToolCall")) return false;
    if (entry.outcome === "pending" && this.config.get("keepActiveToolsExpanded")) return false;
    return true;
  }

  private rememberOwnerEntry(owner: object, entryId: string): void {
    const id = this.ownerId(owner);
    let entries = this.ownerEntries.get(id);
    if (!entries) {
      entries = new Set();
      this.ownerEntries.set(id, entries);
    }
    entries.add(entryId);
  }

  private ownerId(owner: object): number {
    let id = this.ownerIds.get(owner);
    if (id === undefined) {
      id = this.nextOwnerId++;
      this.ownerIds.set(owner, id);
    }
    return id;
  }
}

/** Group a run's entries by outcome, each in first-seen order. */
export function summarize(run: Entry[]): RunSummary {
  const named = (outcome: Outcome) =>
    countNames(run.filter((entry) => entry.outcome === outcome).map((entry) => entry.name));
  return { done: named("success"), failed: named("failure"), running: named("pending") };
}

/** Compact elapsed time: 3s, 2m 7s, 1h 4m. */
export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m ${totalSeconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Count names in first-seen order: read, edit, read → read ×2, edit ×1. */
export function countNames(names: string[]): Count[] {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count }));
}
