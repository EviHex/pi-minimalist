/**
 * TUI components. Purely presentational: they render painted rows (see row.ts)
 * and know nothing about themes, tools, or run grouping.
 *
 * Kept free of Pi extension API imports so unit tests can exercise the real
 * production components without loading an extension runtime.
 */

import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { Component, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
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

/** Columns the details must keep on each line before wrapping is worth it. */
const MIN_WRAP_COLUMNS = 10;

/**
 * An expanded row's details wrapped under themselves (a hanging indent below
 * `glyph label`), or undefined when the terminal is too narrow to wrap
 * usefully: the caller then truncates as usual. A body that fits wraps to a
 * single line.
 */
function wrapped({ head, body }: { head: string; body: string }, room: number): string[] | undefined {
  const indent = visibleWidth(head) + 1;
  if (room - indent < MIN_WRAP_COLUMNS) return undefined;
  const pad = " ".repeat(indent);
  return wrapTextWithAnsi(body, room - indent).map((line, i) => (i === 0 ? `${head} ` : pad) + line);
}

/**
 * Paint a resolved row at `width`; `null` renders ZERO lines.
 *
 * TUI pads each line to terminal width, so no manual trailing padding is
 * needed. truncateToWidth understands ANSI codes and wide Unicode glyphs, so
 * colored text truncates at VISIBLE columns. The gutter is a fixed-width
 * prefix, so the content gets the remaining columns. Width comes from the
 * row's OWN gutter text, so a disabled gutter reclaims those columns.
 */
function renderRow(row: Row | null, width: number): string[] {
  if (row === null) return [];
  const room = Math.max(1, width - gutterWidth(row.gutter));
  const paint = (line: string) => row.gutter + line;
  const lines = row.wrap ? wrapped(row.wrap, room) : undefined;
  if (lines) return lines.map(paint);
  return [paint(truncateToWidth(row.text, room, "…"))];
}

/**
 * One physical terminal line (several for an expanded row) with width-aware
 * truncation and full-width color.
 *
 * Pi's Text component wraps long strings. That is correct for prose but made a
 * long path spill onto a second line in a renderer meant for one line. TUI
 * only supplies the real terminal width during render(), so truncating with a
 * fixed character count in the caller cannot solve this reliably.
 *
 * The one exception is an EXPANDED row (`row.wrap`): there the user asked to see
 * everything, so a long command wraps under its own details instead.
 */
export class CompactLine implements Component {
  private resolve: ResolveRow = () => null;
  private click?: (onHeader: boolean) => boolean;
  /** Did the last render draw a header line at y=0? */
  private headed = false;
  private ticker: unknown;
  private timers: Timers;

  constructor(timers: Timers = realTimers) {
    this.timers = timers;
  }

  /**
   * Install the row resolver. Called on every updateDisplay with fresh state.
   * `click` returning true stops Pi's own left-click (expand) handler; its
   * argument says whether the click landed on the row's header line.
   */
  setRow(resolve: ResolveRow, click?: (onHeader: boolean) => boolean): void {
    this.resolve = resolve;
    this.click = click;
  }

  // Pi's MouseRegion asks its child first, so a handled click never reaches
  // the region's own expand/collapse toggle.
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type !== "click" || event.button !== "left") return undefined;
    // `y` is local to THIS component (Container subtracts earlier siblings).
    return this.click?.(this.headed && event.y === 0) ? { handled: true } : undefined;
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

  render(width: number): string[] {
    const row = this.resolve(width);
    this.headed = row?.header !== undefined;
    return [...(row?.header ? [...renderRow(row.header, width), ""] : []), ...renderRow(row, width)];
  }

  // Component contract allows cached components to be invalidated. This class
  // computes one cheap line every render, so no cache needs clearing.
  invalidate(): void {}
}

/**
 * Assistant prose or native thinking that a fold may take over: the resolver
 * returns a Row to draw it instead, `null` to hide it (zero lines), or
 * `undefined` to leave `inner` untouched (with an opened run's header line
 * above it, when `header` supplies one). The header is followed by one blank line. Clicks on the summary or header go to
 * `click`.
 */
export class FoldableProse implements Component {
  private inner: Component;
  private resolve: (width: number) => Row | null | undefined;
  private header: () => Row | undefined;
  private click: (onHeader: boolean) => boolean;
  /** What the last render drew: a folded summary, or a header line above native output. */
  private summary = false;
  private headed = false;

  /**
   * `header` is the opened-run header to draw above the native output; `click`
   * has the same contract as `CompactLine.setRow`'s: it gets whether the click
   * landed on that header line.
   */
  constructor(
    inner: Component,
    resolve: (width: number) => Row | null | undefined,
    header: () => Row | undefined,
    click: (onHeader: boolean) => boolean,
  ) {
    this.inner = inner;
    this.resolve = resolve;
    this.header = header;
    this.click = click;
  }

  render(width: number): string[] {
    const row = this.resolve(width);
    this.summary = row !== undefined && row !== null;
    const header = row === undefined ? this.header() : undefined;
    this.headed = header !== undefined;
    if (row !== undefined) return renderRow(row, width);
    return header ? [...renderRow(header, width), "", ...this.inner.render(width)] : this.inner.render(width);
  }

  // Only the summary or the header line is clickable; the native output below
  // keeps whatever click behavior its own host (e.g. a thinking MouseRegion) has.
  // `y` is local to THIS component, like CompactLine's.
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    if (event.type !== "click" || event.button !== "left") return undefined;
    const onHeader = this.headed && event.y === 0;
    if (!this.summary && !onHeader) return undefined;
    return this.click(onHeader) ? { handled: true } : undefined;
  }

  invalidate(): void {
    this.inner.invalidate?.();
  }
}

/**
 * Collapsed results must render ZERO lines, not one blank line.
 *
 * Pi's Text component returns [""] for empty strings (one blank row), which
 * doubled the height of every collapsed tool call. This is the only safe way to
 * say "no content at all" while still returning a Component, as the
 * renderResult slot contract requires.
 */
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
