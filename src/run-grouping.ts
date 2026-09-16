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

type Entry = {
  id: string;
  name: string;
  outcome: Outcome;
  /** The user expanded this row (Ctrl+O), so it must stay visible. */
  expanded: boolean;
  /** False for rows that are never folded, e.g. assistant prose. */
  foldable: boolean;
};

/** "show" keeps the row as-is, "hide" draws nothing, a summary folds a whole run. */
export type RowView = "show" | "hide" | RunSummary;

export class RunGrouping {
  private config: Config;
  private entries: Entry[] = [];
  private byId = new Map<string, Entry>();
  private ownerIds = new WeakMap<object, number>();
  private ownerEntries = new Map<number, Set<string>>();
  private nextOwnerId = 1;

  constructor(config: Config) {
    this.config = config;
  }

  get enabled(): boolean {
    return this.config.get("groupToolRuns");
  }

  /** Record the current row state. Re-renders update one stable entry in place. */
  observe(id: string, name: string, outcome: Outcome, expanded: boolean, foldable = true): void {
    const existing = this.byId.get(id);
    if (!existing) {
      const entry: Entry = { id, name, outcome, expanded, foldable };
      this.byId.set(id, entry);
      this.entries.push(entry);
      return;
    }
    existing.name = name;
    existing.outcome = outcome;
    existing.expanded = expanded;
    existing.foldable = foldable;
  }

  /** Observe a thinking block by its component identity and local run index. */
  observeThinking(owner: object, runIndex: number, done: boolean, expanded: boolean): void {
    const id = this.thinkingId(owner, runIndex);
    this.rememberOwnerEntry(owner, id);
    this.observe(id, "think", done ? "success" : "pending", expanded);
  }

  /** Assistant prose is a hard run boundary: it is never folded away. */
  observeProse(owner: object, contentIndex: number): void {
    const id = `prose:${this.ownerId(owner)}:${contentIndex}`;
    this.rememberOwnerEntry(owner, id);
    this.observe(id, "prose", "pending", false, false);
  }

  thinkingId(owner: object, runIndex: number): string {
    return `think:${this.ownerId(owner)}:${runIndex}`;
  }

  /** Hide a message's leading spacer only when every one of its rows is hidden. */
  showsMessageSpacer(owner: object): boolean {
    const entries = this.ownerEntries.get(this.ownerId(owner));
    return !entries || [...entries].some((id) => this.view(id) !== "hide");
  }

  /**
   * The single translation from grouping state to something drawable: the row's
   * own appearance, nothing at all, or the folded run summary.
   *
   * Every feature routes through here, so fold semantics live in exactly one
   * place. `base` is a thunk so an unfolded row is only painted when needed.
   */
  rowFor(id: string, painter: Painter, base: () => Row): Row | null {
    const view = this.view(id);
    if (view === "show") return base();
    if (view === "hide") return null;
    return painter.summary(view);
  }

  view(id: string): RowView {
    if (!this.enabled) return "show";

    // ponytail: linear scan per row per frame — O(n²) over one transcript.
    // Fine at a few hundred entries; index runs by id if long sessions lag.
    const index = this.entries.findIndex((entry) => entry.id === id);
    if (index === -1 || !this.foldable(this.entries[index])) return "show";

    let first = index;
    while (first > 0 && this.foldable(this.entries[first - 1])) first--;
    let last = index;
    while (last + 1 < this.entries.length && this.foldable(this.entries[last + 1])) last++;

    // A lone foldable row is left alone: folding it would save no lines.
    if (first === last) return "show";
    // Only the LAST row of a run draws the summary; the rest draw nothing.
    if (index !== last) return "hide";
    return summarize(this.entries.slice(first, last + 1));
  }

  /**
   * Can this entry disappear into a run summary?
   *
   * A RUNNING entry folds by default: folds are recomputed on every render, so
   * the row reappears the moment it matters, and the summary still counts it in
   * its `running` group. `keepActiveToolsExpanded` opts out for people who want
   * to watch a long command in place.
   */
  private foldable(entry: Entry | undefined): boolean {
    if (!entry?.foldable || entry.expanded) return false;
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

/** Count names in first-seen order: read, edit, read → read ×2, edit ×1. */
export function countNames(names: string[]): Count[] {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count }));
}
