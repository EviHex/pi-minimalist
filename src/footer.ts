/**
 * FEATURE 3: footer status manager — view and selectively hide extension footer
 * statuses (polyglot, caveman, ponytail, MCP adapters…).
 *
 *     /footer          interactive viewer; space toggles the selected status
 *     /footer <key>    direct toggle; the key autocompletes
 *
 * Core bridges (patch-pi.sh): Symbol.for("pi.statusTap") intercepts every
 * setStatus call, and ctx.ui.getExtensionStatuses() exposes statuses that were
 * already set before this extension loaded.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import type { ThemeLike } from "./components.ts";

/** Where hidden keys persist. Injectable so tests never touch user files. */
export type HiddenStore = {
  read: () => string[];
  write: (keys: string[]) => void;
};

export function jsonFileStore(path: string): HiddenStore {
  return {
    read: () => {
      try {
        return JSON.parse(readFileSync(path, "utf-8"));
      } catch {
        return []; // Missing or corrupt file → nothing hidden. Safe default.
      }
    },
    write: (keys) => writeFileSync(path, JSON.stringify(keys, null, 2) + "\n"),
  };
}

export function memoryStore(initial: string[] = []): HiddenStore {
  let keys = [...initial];
  return { read: () => keys, write: (next) => void (keys = [...next]) };
}

/** The ctx.ui surface this feature needs (plus the patched bridge method). */
export type StatusUi = { getExtensionStatuses?: () => Map<string, string> };

/**
 * Keybinding lookup used by the dialog. Method shorthand on purpose: methods
 * are bivariant, so Pi's KeybindingsManager — whose second parameter is the
 * narrow `keyof Keybindings` union — stays assignable under strictFunctionTypes,
 * and tests can pass a tiny stub.
 */
export type KeybindingLookup = { matches(keyData: string, action: string): boolean };

/**
 * Everything the footer feature owns: which statuses exist, which are hidden,
 * and how hidden keys persist. A class (not module-level state) so each test
 * gets an isolated instance.
 */
export class FooterStatuses {
  /** Every status the tap has seen since we loaded. */
  private registry = new Map<string, string>();
  private hidden: Set<string>;
  private store: HiddenStore;
  /**
   * Extension commands receive ctx only inside handlers, but autocomplete runs
   * OUTSIDE any handler — so the first ctx.ui we see is cached for it.
   */
  private ui: StatusUi | undefined;

  constructor(store: HiddenStore) {
    this.store = store;
    this.hidden = new Set(store.read());
  }

  /** Remember the UI handle used to read pre-existing statuses. */
  attachUi(ui: StatusUi): void {
    this.ui = ui;
    this.mergeLive();
  }

  /**
   * Merge statuses set BEFORE our tap registered (load-order stragglers: MCP
   * adapters and friends) via the getExtensionStatuses bridge. Only visible ones
   * appear there — hidden statuses never reach that map.
   */
  mergeLive(): void {
    const live = this.ui?.getExtensionStatuses?.();
    if (!live) return;
    for (const [key, text] of live) {
      if (text !== undefined) this.registry.set(key, text);
    }
  }

  /**
   * The status tap. Core calls it for EVERY setStatus(key, text), including
   * text === undefined ("clear"). Returning true swallows the status, keeping it
   * out of the footer.
   *
   * GOTCHA: never call ctx.ui.setStatus from inside the tap — infinite loop.
   */
  tap(key: string, text: string | undefined): boolean {
    if (text === undefined) this.registry.delete(key); // Cleared → drop from viewer.
    else this.registry.set(key, text);
    return this.hidden.has(key);
  }

  /** All known statuses (tap registry + pre-existing ones), sorted by key. */
  entries(): [string, string][] {
    this.mergeLive();
    return [...this.registry.entries()].sort(([a], [b]) => a.localeCompare(b));
  }

  keys(): string[] {
    this.mergeLive();
    return [...this.registry.keys()];
  }

  has(key: string): boolean {
    return this.registry.has(key);
  }

  text(key: string): string | undefined {
    return this.registry.get(key);
  }

  isHidden(key: string): boolean {
    return this.hidden.has(key);
  }

  /** Flip one key and persist immediately; returns the new hidden state. */
  toggle(key: string): boolean {
    if (this.hidden.has(key)) this.hidden.delete(key);
    else this.hidden.add(key);
    this.persist();
    return this.hidden.has(key);
  }

  setHidden(key: string, hidden: boolean): void {
    if (hidden) this.hidden.add(key);
    else this.hidden.delete(key);
    this.persist();
  }

  private persist(): void {
    this.store.write([...this.hidden]);
  }
}

/**
 * Interactive dialog for `/footer` (via ctx.ui.custom, which swaps the editor
 * for this component until done() is called).
 *
 * Keys: ↑/↓ or k/j move, space toggles hidden ↔ visible (persisted on every
 * toggle), s / Enter / Esc close. Space rather than ←/→ because left/right never
 * fired reliably across terminals. Intentionally borderless and narrow: this is
 * a quick toggle list, not a document.
 */
export class FooterToggleDialog implements Component {
  private entries: [string, string][];
  private theme: ThemeLike;
  private keybindings: KeybindingLookup;
  private statuses: FooterStatuses;
  private onClose: () => void;
  private selected = 0;

  constructor(
    entries: [string, string][],
    theme: ThemeLike,
    keybindings: KeybindingLookup,
    statuses: FooterStatuses,
    onClose: () => void,
  ) {
    this.entries = entries;
    this.theme = theme;
    this.keybindings = keybindings;
    this.statuses = statuses;
    this.onClose = onClose;
  }

  render(): string[] {
    const theme = this.theme;
    const lines: string[] = [];
    lines.push(theme.fg("accent", theme.bold?.("extension footer statuses") ?? "extension footer statuses"));
    for (let i = 0; i < this.entries.length; i++) {
      const [key, text] = this.entries[i];
      const cursor = i === this.selected ? theme.fg("accent", "→ ") : "  ";
      // ✓ = visible in the footer, ✗ = hidden.
      const state = this.statuses.isHidden(key)
        ? theme.fg("warning", "✗")
        : theme.fg("success", "✓");
      lines.push(
        `${cursor}${state} ${theme.fg("success", key)} ${theme.fg("muted", "→")} ${truncateToWidth(text, 80, "…")}`,
      );
    }
    lines.push(theme.fg("dim", "↑↓ select · space toggle · Enter/Esc close"));
    return lines;
  }

  handleInput(keyData: string): boolean {
    const kb = this.keybindings;
    if (kb.matches(keyData, "tui.select.up") || keyData === "k") {
      this.selected = Math.max(0, this.selected - 1);
    } else if (kb.matches(keyData, "tui.select.down") || keyData === "j") {
      this.selected = Math.min(this.entries.length - 1, this.selected + 1);
    } else if (matchesKey(keyData, "space")) {
      this.statuses.toggle(this.entries[this.selected][0]);
    } else if (
      keyData === "s" ||
      kb.matches(keyData, "tui.select.cancel") ||
      kb.matches(keyData, "tui.select.confirm") ||
      keyData === "\n"
    ) {
      // hidden state is already persisted on every toggle, so "save" is implicit.
      this.onClose();
    }
    return true; // consume all keys while the dialog is focused
  }

  /** Test/inspection helper: which row the cursor is on. */
  selectedIndex(): number {
    return this.selected;
  }

  invalidate(): void {}
}
