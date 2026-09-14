/**
 * Quiet-mode grouping state.
 *
 * ToolExecutionComponent instances are independent transcript entries, but their
 * call renderers are constructed in transcript order. Keep that order here so
 * each CompactLine can decide at render time whether it is hidden, unchanged,
 * or the visible tail of a compact summary. This makes /quiet affect existing
 * history too: no core rebuild or core patch is needed.
 */

/** Tools safe to summarize: routine file operations, bash, and generic toolcalls. */
export const QUIET_TOOLS = new Set(["read", "edit", "write", "grep", "find", "ls", "bash", "toolcall", "think"]);

export type QuietOutcome = "success" | "failure" | "pending";

type Entry = {
  id: string;
  name: string;
  outcome: QuietOutcome;
  expanded: boolean;
};

export type QuietView = "show" | "hide" | { summary: string; failures?: string }; 

/** Fold completed, adjacent low-noise tools while /quiet is enabled. */
export class QuietMode {
  private enabled: boolean;
  private entries: Entry[] = [];
  private byId = new Map<string, Entry>();
  private ownerIds = new WeakMap<object, number>();
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
  observe(id: string, name: string, outcome: QuietOutcome, expanded: boolean): void {
    let entry = this.byId.get(id);
    if (!entry) {
      entry = { id, name, outcome, expanded };
      this.byId.set(id, entry);
      this.entries.push(entry);
      return;
    }
    entry.name = name;
    entry.outcome = outcome;
    entry.expanded = expanded;
  }

  /** Observe a thinking block with its core component identity and local run index. */
  observeThinking(owner: object, runIndex: number, done: boolean, expanded: boolean): void {
    this.observe(this.thinkingId(owner, runIndex), "think", done ? "success" : "pending", expanded);
  }

  /** Assistant prose is a hard quiet-run boundary. */
  observeProse(owner: object, contentIndex: number): void {
    this.observe(`prose:${this.ownerId(owner)}:${contentIndex}`, "prose", "pending", false);
  }

  thinkingId(owner: object, runIndex: number): string {
    return `think:${this.ownerId(owner)}:${runIndex}`;
  }

  view(id: string): QuietView {
    if (!this.enabled) return "show";

    const index = this.entries.findIndex((entry) => entry.id === id);
    if (index === -1 || !this.foldable(this.entries[index])) return "show";

    let first = index;
    while (first > 0 && this.foldable(this.entries[first - 1])) first--;
    let last = index;
    while (last + 1 < this.entries.length && this.foldable(this.entries[last + 1])) last++;

    if (first === last) return "show";
    if (index !== last) return "hide";
    const run = this.entries.slice(first, last + 1);
    const summary = summarize(run.filter((entry) => entry.outcome === "success").map((entry) => entry.name));
    const failures = summarize(run.filter((entry) => entry.outcome === "failure").map((entry) => entry.name));
    return failures ? { summary, failures } : { summary }; 
  }

  private foldable(entry: Entry | undefined): boolean {
    return Boolean(entry && entry.outcome !== "pending" && !entry.expanded && QUIET_TOOLS.has(entry.name));
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

/** Preserve first-seen order: read, edit, read becomes "read ×2, edit ×1". */
export function summarize(names: string[]): string {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].map(([name, count]) => `${name} ×${count}`).join(", ");
}
