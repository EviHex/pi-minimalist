/**
 * Pure row-text logic for compact tool rows: which tools we compact, how their
 * one-line summary reads, which status glyph applies, and how the row is
 * colored. No components, no globals — every function here is deterministic
 * given its arguments, which is what makes the row layout unit-testable.
 */

import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import type { ThemeLike } from "./components.ts";

/** Every native tool whose RENDERING (never its definition) we replace. */
// `as const` preserves literal names instead of widening every item to string.
export const BUILT_INS = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;

// `(typeof BUILT_INS)[number]` turns the tuple values into a union type.
export type ToolName = (typeof BUILT_INS)[number];

/** True for native tools whose rendering (only) we replace. */
export function isBuiltIn(name: string): name is ToolName {
  return BUILT_INS.includes(name as ToolName);
}

/**
 * State shared between renderCall and renderResult through context.state.
 * It caches the component produced by the ORIGINAL built-in renderResult so
 * consecutive expanded re-renders reuse one instance (the built-ins expect
 * this — they inspect context.lastComponent), plus the row's start timestamp.
 */
export type RenderState = {
  originalResult?: unknown;
  /**
   * Cached call row. Core's FALLBACK path (createCallFallback, used for tools
   * with no renderer of their own) always calls getRenderContext(undefined), so
   * context.lastComponent is never populated there and state is the only stable
   * per-call cache. Without it, every repaint allocated a new row and registered
   * another 1s ticker that nothing could ever clear.
   */
  callLine?: unknown;
  /** Wall-clock timestamp (ms) of the first render after execution started. */
  startedAt?: number;
};

/** The render context fields this module reads. Pi's real context has more. */
export type CallContext = {
  toolCallId?: string;
  state: RenderState;
  isPartial?: boolean;
  isError?: boolean;
  executionStarted?: boolean;
  expanded?: boolean;
};

/** Collapse whitespace and truncate long values for one-line display. */
export function compact(value: unknown, max = 100): string {
  // Replacing every whitespace run prevents multi-line call rows.
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Build the one-line summary shown next to the status glyph, e.g.
 * "read src/a.ts:1-50", "bash go test ./...", "edit src/b.ts".
 *
 * Every result STARTS with its action word; colorAction() relies on that.
 */
export function callText(name: ToolName, args: any, expanded = false): string {
  const safeArgs = args ?? {};
  // Paths are shown verbatim (no ~/ home abbreviation — it was decorative and
  // cost a homedir() call per render).
  const path = (value: unknown) => String(value ?? "");
  switch (name) {
    case "bash":
      // Spell out the action; "$" looked like terminal output rather than a tool
      // name and could not take the same action color as other tools.
      //
      // Collapsed rows truncate at 100 chars. Expanded rows preserve the full
      // command LENGTH but still collapse newlines into ONE physical line;
      // otherwise a multiline `python -c`/heredoc escapes the call-row gutter
      // and visually merges with the expanded output below it. CompactLine then
      // clips that single line at the real terminal width.
      return `bash ${compact(safeArgs.command, expanded ? Number.POSITIVE_INFINITY : 100)}`;
    case "read": {
      // Show the line range when offset/limit were used, mirroring the built-in
      // read tool's "path:start-end" notation.
      const start = safeArgs.offset ?? 1;
      const range = safeArgs.offset !== undefined || safeArgs.limit !== undefined
        ? `:${start}${safeArgs.limit ? `-${start + safeArgs.limit - 1}` : ""}`
        : "";
      return `read ${path(safeArgs.path)}${range}`;
    }
    case "edit":
    case "write":
      return `${name} ${path(safeArgs.path)}`;
    case "grep":
      return `grep /${compact(safeArgs.pattern, 50)}/ in ${path(safeArgs.path ?? ".")}`;
    case "find":
      return `find ${compact(safeArgs.pattern, 50)} in ${path(safeArgs.path ?? ".")}`;
    case "ls":
      return `ls ${path(safeArgs.path ?? ".")}`;
  }
}

/** Generic label for third-party/MCP tools that ship no renderer of their own. */
export function fallbackCallText(name: string): string {
  return `toolcall ${name}`;
}

// color is a real ThemeColor so a mistyped token fails to compile: at runtime
// theme.fg() would throw and core would silently fall back to a verbose card.
export type Status = { glyph: string; color: ThemeColor; elapsed?: number };

/**
 * Pick the status glyph + color for a render context:
 * - finished: ✓ success green; failed: ✗ error red
 * - running:  • success green, with elapsed seconds
 * - queued:   › success green
 *
 * GOTCHA: session replay (restart with history) never calls
 * markExecutionStarted(), so executionStarted stays false for reloaded tools.
 * "Finished" must therefore key off !isPartial (a final result exists), NOT off
 * executionStarted, or every historical tool call shows the queued caret after
 * a restart. executionStarted only separates queued from running while live.
 */
export function statusGlyph(context: CallContext, now: () => number = Date.now): Status {
  if (!context.isPartial) {
    // Final result present: covers both live completion and replayed history.
    return { glyph: context.isError ? "✗" : "✓", color: context.isError ? "error" : "success" };
  }
  if (context.executionStarted) {
    const state = context.state;
    state.startedAt ??= now();
    return { glyph: "•", color: "success", elapsed: Math.floor((now() - state.startedAt) / 1000) };
  }
  return { glyph: "›", color: "success" };
}

/**
 * Elapsed-timer badge inserted after the action word, or "" when not running
 * or under one second. Hiding the first second avoids a `[⏱ 0s]` flicker on
 * commands that finish instantly; the 1s ticker repaints the row once the
 * elapsed time reaches 1s, so the badge appears only when it is meaningful.
 */
export function timerBadge(elapsed: number | undefined): string {
  return elapsed !== undefined && elapsed >= 1 ? `[⏱ ${elapsed}s]` : "";
}

/**
 * Color the action word (always success green), insert the elapsed timer right
 * after it (before the command/path details), then the details in tool-title
 * color. The action color is hard-coded: every action is green now that the
 * per-category actionColor() is gone.
 */
export function colorAction(text: string, theme: ThemeLike, timer?: string): string {
  const separator = text.indexOf(" ");
  const action = separator === -1 ? text : text.slice(0, separator);
  const details = separator === -1 ? "" : text.slice(separator);
  const timerPart = timer ? ` ${theme.fg("success", timer)}` : "";
  return theme.fg("success", action) + timerPart + theme.fg("toolTitle", details);
}

/** Color every action name in a quiet summary like a normal tool row. */
export function colorQuietSummary(
  summary: string,
  theme: ThemeLike,
  actionColor: ThemeColor = "success",
  detailColor: ThemeColor = "toolTitle",
): string {
  return summary.split(", ").map((item) => {
    const separator = item.indexOf(" ");
    return theme.fg(actionColor, item.slice(0, separator)) + theme.fg(detailColor, item.slice(separator));
  }).join(theme.fg(detailColor, ", "));
}

export function quietSummaryText(summary: string, failures: string | undefined, theme: ThemeLike): string {
  const parts = summary ? [`${theme.fg("success", "✓")} ${colorQuietSummary(summary, theme)}`] : [];
  if (failures) parts.push(`${theme.fg("error", "✗")} ${colorQuietSummary(failures, theme, "error")}`);
  return parts.join(theme.fg("toolTitle", " · "));
}

/** Assemble the full row text: glyph, colored action word, timer, details. */
export function rowText(
  name: string,
  args: unknown,
  theme: ThemeLike,
  status: Status,
  expanded: boolean,
): string {
  const text = isBuiltIn(name) ? callText(name, args, expanded) : fallbackCallText(name);
  const parts: string[] = [];
  // Skip an absent glyph so the row never starts with a stray space.
  if (status.glyph) parts.push(theme.fg(status.color, status.glyph));
  parts.push(colorAction(text, theme, timerBadge(status.elapsed)));
  return parts.join(" ");
}
