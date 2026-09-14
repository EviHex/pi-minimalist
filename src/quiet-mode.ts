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
export const QUIET_TOOLS = new Set(["read", "edit", "write", "grep", "find", "ls", "bash", "toolcall"]);

type Entry = {
  id: string;
  name: string;
  done: boolean;
  expanded: boolean;
};

export type QuietView = "show" | "hide" | { summary: string };

/** Fold completed, adjacent low-noise tools while /quiet is enabled. */
export class QuietMode {
  private enabled = false;
  private entries: Entry[] = [];
  private byId = new Map<string, Entry>();

  toggle(): boolean {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  /** Record the current call state. Re-renders update one stable entry in place. */
  observe(id: string, name: string, done: boolean, expanded: boolean): void {
    let entry = this.byId.get(id);
    if (!entry) {
      entry = { id, name, done, expanded };
      this.byId.set(id, entry);
      this.entries.push(entry);
      return;
    }
    entry.name = name;
    entry.done = done;
    entry.expanded = expanded;
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
    return { summary: summarize(this.entries.slice(first, last + 1).map((entry) => entry.name)) };
  }

  private foldable(entry: Entry | undefined): boolean {
    return Boolean(entry?.done && !entry.expanded && QUIET_TOOLS.has(entry.name));
  }
}

/** Preserve first-seen order: read, edit, read becomes "read ×2, edit ×1". */
export function summarize(names: string[]): string {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].map(([name, count]) => `${name} ×${count}`).join(", ");
}
