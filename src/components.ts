/**
 * TUI components. Purely presentational: they render painted rows (see row.ts)
 * and know nothing about themes, tools, or run grouping.
 *
 * Kept free of Pi extension API imports so unit tests can exercise the real
 * production components without loading an extension runtime.
 */

import { truncateToWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
import { gutterWidth, type Row } from "./row.ts";

/**
 * Injectable timer pair. Production passes Node's globals; tests pass fakes so
 * the elapsed timer can be advanced without sleeping and leaks are detectable.
 */
export type Timers = {
  setInterval: (callback: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
};

export const realTimers: Timers = {
  setInterval: (callback, ms) => {
    const handle = setInterval(callback, ms);
    // A forgotten ticker must never hold the process open.
    handle.unref?.();
    return handle;
  },
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

/**
 * Resolve what to draw, at render time. `null` means draw NOTHING (zero lines),
 * which is how run grouping hides a row. Resolved on every render, so a config
 * toggle repaints existing transcript rows with no core rebuild.
 *
 * Receives the real terminal width, because detail truncation budgets depend on
 * it and TUI only reveals the width during render(). Passing a fixed character
 * count from the caller cannot adapt to the actual viewport.
 */
export type ResolveRow = (width: number) => Row | null;

/**
 * One physical terminal line with width-aware truncation and full-width color.
 *
 * Pi's Text component wraps long strings. That is correct for prose but made a
 * long path spill onto a second line in a supposedly single-line renderer. TUI
 * only supplies the real terminal width during render(), so truncating with a
 * fixed character count in the caller cannot solve this reliably.
 */
export class CompactLine implements Component {
  private resolve: ResolveRow = () => null;
  private ticker: unknown;
  private timers: Timers;

  constructor(timers: Timers = realTimers) {
    this.timers = timers;
  }

  /** Install the row resolver. Called on every updateDisplay with fresh state. */
  setRow(resolve: ResolveRow): void {
    this.resolve = resolve;
  }

  /**
   * Repaint once per second while a tool runs, so the elapsed timer ticks even
   * for silent commands that produce no streaming output (the only other
   * repaint trigger). stopTicker() clears it at a final state.
   */
  startTicker(requestRender: () => void): void {
    if (this.ticker !== undefined) return; // already ticking
    this.ticker = this.timers.setInterval(requestRender, 1000);
  }

  stopTicker(): void {
    if (this.ticker !== undefined) {
      this.timers.clearInterval(this.ticker);
      this.ticker = undefined;
    }
  }

  /** Test/inspection helper: is a repaint interval currently registered? */
  isTicking(): boolean {
    return this.ticker !== undefined;
  }

  render(width: number): string[] {
    const row = this.resolve(width);
    if (row === null) return [];

    // TUI pads each line to terminal width, so no manual trailing padding is
    // needed. truncateToWidth understands ANSI codes and wide Unicode glyphs,
    // so colored text truncates at VISIBLE columns. The gutter is a fixed-width
    // prefix, so the content gets the remaining columns. Width comes from the
    // row's OWN gutter text, so a disabled gutter reclaims those columns.
    const line = truncateToWidth(row.text, Math.max(1, width - gutterWidth(row.gutter)), "…");
    return [row.gutter + (row.highlight ? row.highlight(line) : line)];
  }

  // Component contract allows cached components to be invalidated. This class
  // computes one cheap line every render, so no cache needs clearing.
  invalidate(): void {}
}

/**
 * Collapsed results must render ZERO lines, not one blank line.
 *
 * Pi's Text component returns [""] for empty strings (one blank row), which
 * doubled the height of every collapsed tool call. This is the only safe way to
 * say "no content at all" while still returning a Component, as the
 * renderResult slot contract requires.
 */
export class FoldableProse implements Component {
  private inner: Component;
  private resolve: (width: number) => Row | null | undefined;

  constructor(inner: Component, resolve: (width: number) => Row | null | undefined) {
    this.inner = inner;
    this.resolve = resolve;
  }

  render(width: number): string[] {
    const row = this.resolve(width);
    if (row === undefined) return this.inner.render(width);
    const line = new CompactLine();
    line.setRow(() => row);
    return line.render(width);
  }

  invalidate(): void {
    this.inner.invalidate?.();
  }
}

export class EmptyComponent implements Component {
  render(): string[] {
    return [];
  }

  invalidate(): void {}
}

/**
 * Wraps another component and prefixes EVERY line it renders with a gutter, so
 * expanded output stays visually attached to the call row above it instead of
 * blending into model prose.
 *
 * The inner component renders at a reduced width (the gutter occupies real
 * columns), otherwise its own wrapping/truncation would overflow the row.
 */
export class GutteredComponent implements Component {
  private inner: Component;
  private gutterText: string;

  constructor(inner: Component, gutterText: string) {
    this.inner = inner;
    this.gutterText = gutterText;
  }

  /** Swap in the newest inner component while keeping this wrapper stable. */
  setInner(inner: Component): void {
    this.inner = inner;
  }

  render(width: number): string[] {
    const lines = this.inner.render(Math.max(1, width - gutterWidth(this.gutterText)));
    return lines.map((line) => this.gutterText + line);
  }

  invalidate(): void {
    this.inner.invalidate?.();
  }
}
