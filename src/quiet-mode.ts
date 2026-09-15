/**
 * Quiet-mode grouping state.
 *
 * ToolExecutionComponent instances are independent transcript entries, but their
 * call renderers are constructed in transcript order. Keep that order here so
 * each row can decide AT RENDER TIME whether it is hidden, unchanged, or the
 * visible tail of a folded run. That is what makes /quiet affect existing
 * history with no core rebuild and no core patch.
 */

import { summaryRow, type Count, type Row, type ThemeLike } from "./row.ts";

export type QuietOutcome = "success" | "failure" | "pending";

type Entry = {
  id: string;
  name: string;
  outcome: QuietOutcome;
  expanded: boolean;
  foldable: boolean;
};

/** "show" keeps the row as-is, "hide" draws nothing, counts fold a whole run. */
export type QuietView = "show" | "hide" | { done: Count[]; failed: Count[] };

/** Fold completed, adjacent low-noise tools while /quiet is enabled. */
export class QuietMode {
  private enabled: boolean;
  private entries: Entry[] = [];
  private byId = new Map<string, Entry>();
  private ownerIds = new WeakMap<object, number>();
  private ownerEntries = new Map<number, Set<string>>();
  private nextOwnerId = 1;

  constructor(enabled = false) {
    this.enabled = enabled;
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** Record the current call state. Re-renders update one stable entry in place. */
  observe(id: string, name: string, outcome: QuietOutcome, expanded: boolean, foldable = true): void {
    const entry = this.byId.get(id);
    if (!entry) {
      const created = { id, name, outcome, expanded, foldable };
      this.byId.set(id, created);
      this.entries.push(created);
      return;
    }
    entry.name = name;
    entry.outcome = outcome;
    entry.expanded = expanded;
    entry.foldable = foldable;
  }

  /** Observe a thinking block with its core component identity and local run index. */
  observeThinking(owner: object, runIndex: number, done: boolean, expanded: boolean): void {
    const id = this.thinkingId(owner, runIndex);
    this.rememberOwnerEntry(owner, id);
    this.observe(id, "think", done ? "success" : "pending", expanded);
  }

  /** Assistant prose is a hard quiet-run boundary. */
  observeProse(owner: object, contentIndex: number): void {
    const id = `prose:${this.ownerId(owner)}:${contentIndex}`;
    this.rememberOwnerEntry(owner, id);
    this.observe(id, "prose", "pending", false, false);
  }

  thinkingId(owner: object, runIndex: number): string {
    return `think:${this.ownerId(owner)}:${runIndex}`;
  }

  /** Hide a message's initial spacer only when every one of its rows is hidden. */
  showMessageSpacer(owner: object): boolean {
    const entries = this.ownerEntries.get(this.ownerId(owner));
    return !entries || [...entries].some((id) => this.view(id) !== "hide");
  }

  /**
   * The single translation from quiet state to something drawable: the row's own
   * appearance, nothing, or the folded run summary. Both features route through
   * here, so quiet semantics live in exactly one place.
   */
  rowFor(id: string, theme: ThemeLike, base: () => Row): Row | null {
    const view = this.view(id);
    if (view === "show") return base();
    if (view === "hide") return null;
    return summaryRow(theme, view.done, view.failed);
  }

  view(id: string): QuietView {
    if (!this.enabled) return "show";

    // ponytail: linear scan per row per frame — O(n²) over one transcript.
    // Fine at a few hundred entries; index runs by id if long sessions lag.
    const index = this.entries.findIndex((entry) => entry.id === id);
    if (index === -1 || !this.foldable(this.entries[index])) return "show";

    let first = index;
    while (first > 0 && this.foldable(this.entries[first - 1])) first--;
    let last = index;
    while (last + 1 < this.entries.length && this.foldable(this.entries[last + 1])) last++;

    // A lone foldable call is left alone: folding it would save no lines.
    if (first === last) return "show";
    if (index !== last) return "hide";
    const run = this.entries.slice(first, last + 1);
    return {
      done: summarize(run.filter((entry) => entry.outcome === "success").map((entry) => entry.name)),
      failed: summarize(run.filter((entry) => entry.outcome === "failure").map((entry) => entry.name)),
    };
  }

  private foldable(entry: Entry | undefined): boolean {
    return Boolean(entry?.foldable && entry.outcome !== "pending" && !entry.expanded);
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

/** Count names in first-seen order: read, edit, read → read ×2, edit ×1. */
export function summarize(names: string[]): Count[] {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count }));
}
