/**
 * Deterministic doubles for the UI tests. NOT used at runtime.
 *
 * Rules these helpers enforce:
 * - theme tokens are asserted as `<token>text</token>`, never as RGB escapes,
 *   so tests never depend on the machine's terminal or the active theme;
 * - the elapsed timer is driven by a fake clock and fake interval, so no test
 *   sleeps and a leaked ticker is detectable;
 * - render contexts are built explicitly per UI state (queued/running/…).
 */

import type { Timers } from "../src/components.ts";
import { Config, type Settings } from "../src/config.ts";
import { Painter, type ThemeLike } from "../src/row.ts";
import { RunGrouping } from "../src/run-grouping.ts";
import type { RenderState } from "../src/tool-renderer.ts";

/**
 * Theme whose output NAMES the token it used, e.g. `<success>✓</success>`.
 * Use it to assert which token a row used. Its markup occupies real columns, so
 * it must NOT be used for width assertions — use plainTheme() for those.
 */
export function fakeTheme(): ThemeLike {
  return {
    fg: (token, text) => `<${token}>${text}</${token}>`,
  };
}

/**
 * Zero-width theme: returns text unchanged, like a real theme whose ANSI codes
 * occupy no visible columns. Use it for layout, truncation, and width tests.
 */
export function plainTheme(): ThemeLike {
  return { fg: (_token, text) => text };
}

/** Strip fake-theme markup AND real ANSI codes to assert on visible text. */
export function plain(line: string): string {
  return line
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/<\/?[a-zA-Z]+>|\[\/?[a-zA-Z]+\]/g, "");
}

/**
 * Settings for a test, on top of the real defaults.
 *
 * Tests name only the settings they care about, so adding a new setting does not
 * touch every test, and each test still exercises the production defaults.
 */
export function testConfig(settings: Partial<Settings> = {}): Config {
  return new Config(settings);
}

/** Config plus its grouping state, the pair every renderer needs. */
export function testState(settings: Partial<Settings> = {}): { config: Config; grouping: RunGrouping } {
  const config = testConfig(settings);
  return { config, grouping: new RunGrouping(config) };
}

/** Painter over the token-naming fake theme. */
export function testPainter(settings: Partial<Settings> = {}, theme: ThemeLike = fakeTheme()): Painter {
  return new Painter(theme, testConfig(settings));
}

export type FakeClock = {
  now: () => number;
  advance: (ms: number) => void;
};

export function fakeClock(start = 1_000_000): FakeClock {
  let current = start;
  return {
    now: () => current,
    advance: (ms) => void (current += ms),
  };
}

export type FakeTimers = Timers & {
  /** Interval callbacks currently registered (a leak shows up as a nonzero length). */
  pending: () => number;
  /** Invoke every registered interval callback once. */
  fire: () => void;
};

export function fakeTimers(): FakeTimers {
  const callbacks = new Map<number, () => void>();
  let nextId = 1;
  return {
    setInterval: (callback) => {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
    clearInterval: (handle) => void callbacks.delete(handle as number),
    pending: () => callbacks.size,
    fire: () => {
      for (const callback of [...callbacks.values()]) callback();
    },
  };
}

/** Every UI state the compact tool row supports. */
export type UiState = "queued" | "running" | "completed" | "failed" | "partial";

export type TestContext = {
  state: RenderState;
  isPartial: boolean;
  isError: boolean;
  executionStarted: boolean;
  /**
   * Core sets this while streaming arguments, but no renderer reads it: queued
   * vs running is decided by executionStarted. Kept so contexts mirror core's
   * real shape, and so a future renderer that DOES read it has it available.
   */
  argsComplete: boolean;
  expanded: boolean;
  lastComponent?: unknown;
  toolCallId?: string;
  invalidate: () => void;
  invalidateCount: () => number;
};

/**
 * Build a render context in one of the states core can produce.
 * - queued:    streaming args, execution not started yet
 * - running:   execution started, no final result
 * - partial:   streaming output already arriving (same flags as running)
 * - completed: final result present, no error
 * - failed:    final result present, isError
 */
export function makeContext(
  state: UiState,
  options: { expanded?: boolean; argsComplete?: boolean; lastComponent?: unknown; toolCallId?: string } = {},
): TestContext {
  const live = state === "running" || state === "partial" || state === "queued";
  let invalidations = 0;
  return {
    toolCallId: options.toolCallId,
    state: {},
    isPartial: live,
    isError: state === "failed",
    executionStarted: state === "running" || state === "partial",
    argsComplete: options.argsComplete ?? state !== "queued",
    expanded: options.expanded ?? false,
    lastComponent: options.lastComponent,
    invalidate: () => void invalidations++,
    invalidateCount: () => invalidations,
  };
}
