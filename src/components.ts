/**
 * Reusable TUI components and the gutter vocabulary shared by every feature.
 *
 * Kept free of Pi extension API imports so unit tests can exercise the real
 * production components without loading an extension runtime.
 */

import { truncateToWidth } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";
// Type-only imports: erased at runtime, so this stays free of Pi runtime deps
// while a mistyped token ("succes") becomes a compile error instead of a
// runtime theme.fg() throw that core silently turns into verbose fallback output.
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";

// ThemeBg is not exported publicly, so recover it from Theme.bg's own signature
// rather than importing a deep dist path (which is not a package export).
type ThemeBg = Parameters<Theme["bg"]>[0];

/** Visible columns consumed by every gutter variant (space + block + space). */
export const GUTTER_WIDTH = 3;

/**
 * Minimal theme surface these components need. Pi's real Theme satisfies it;
 * tests pass a deterministic fake that renders `<token>text</token>` so
 * assertions check the token, never a machine-specific RGB escape sequence.
 */
// Method shorthand (not property-with-function-type) on purpose: methods are
// bivariant, so Pi's Theme stays assignable under strictFunctionTypes while
// tests can pass a small fake.
export type ThemeLike = {
  fg(token: ThemeColor, text: string): string;
  bg(token: ThemeBg, text: string): string;
};

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
 * Dim vertical bar drawn at the left of every compact row (tool calls and the
 * thinking preview). Model prose stays flush left, so a run of tool rows reads
 * as one indented block instead of same-weight lines mixed into text.
 *
 * Indented one column so the bar sits inside the text area instead of colliding
 * with the left border of user-message code blocks. `borderAccent` is a native
 * Pi theme token (custom color keys make theme.fg() throw at runtime); signal
 * .json maps it to pastel green.
 */
export function gutter(theme: ThemeLike, token: ThemeColor = "borderAccent"): string {
  return ` ${theme.fg(token, "▌")} `;
}

/**
 * Gutter for expanded OUTPUT lines: same glyph and column as the call row, but
 * dimmed, so the call row still reads as the block header while the bar
 * visually binds the output to it.
 */
export function outputGutter(theme: ThemeLike): string {
  return ` ${theme.fg("borderMuted", "▌")} `;
}

/**
 * One physical terminal line with width-aware truncation and full-width color.
 *
 * Pi's Text component wraps long strings. That is correct for prose but made a
 * long path spill onto a second line in our supposedly single-line renderer.
 * TUI only supplies the real terminal width during render(), so truncating with
 * a fixed character count in the caller cannot solve this reliably.
 */
export class CompactLine implements Component {
  private text = "";
  private background: ((text: string) => string) | undefined;
  private ticker: unknown;
  private gutterText = "";
  private timers: Timers;

  constructor(timers: Timers = realTimers) {
    this.timers = timers;
  }

  set(text: string, background?: (text: string) => string): void {
    this.text = text;
    this.background = background;
  }

  /** Left gutter marker, pre-colored by the caller so it can differ from the row text. */
  setGutter(gutterText: string): void {
    this.gutterText = gutterText;
  }

  /**
   * Repaint once per second while a tool runs, so the elapsed timer ticks even
   * for silent commands that produce no streaming output (the only other
   * repaint trigger). stopTicker() clears it when the row reaches a final state.
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
    // TUI pads each line to terminal width, so no manual trailing padding is
    // needed. truncateToWidth understands ANSI codes and wide Unicode glyphs,
    // so colored text truncates at VISIBLE columns. The gutter is a fixed-width
    // prefix, so the content gets the remaining columns.
    const gutterWidth = this.gutterText ? GUTTER_WIDTH : 0;
    const line = truncateToWidth(this.text, Math.max(1, width - gutterWidth), "…");
    return this.background ? [this.gutterText + this.background(line)] : [this.gutterText + line];
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
export class EmptyComponent implements Component {
  render(): string[] {
    return [];
  }

  invalidate(): void {}
}

/**
 * Wraps another component and prefixes EVERY line it renders with the output
 * gutter, so expanded output stays visually attached to the call row above it
 * instead of blending into model prose.
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
    const lines = this.inner.render(Math.max(1, width - GUTTER_WIDTH));
    return lines.map((line) => this.gutterText + line);
  }

  invalidate(): void {
    this.inner.invalidate?.();
  }
}
