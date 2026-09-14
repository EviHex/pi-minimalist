/**
 * FEATURE 2: collapsed thinking preview — one NON-italic line replacing Pi's
 * bare "Thinking..." label, installed on Symbol.for("pi.thinkingPreview").
 *
 *     • think The user wants me to…    ← while streaming (row highlighted)
 *     ✓ think The user wants me to…    ← once the message completes
 *
 * The expanded view (Ctrl+T) is untouched native italic thinkingText markdown.
 * CompactLine truncates at the real viewport width during render().
 */

import { CompactLine, realTimers, type ThemeLike, type Timers } from "./components.ts";
import { QuietMode } from "./quiet-mode.ts";
import { quietSummaryText } from "./tool-rows.ts";

/** Core calls this with the full hidden thinking text plus a streaming flag. */
export type ThinkingPreview = (
  text: string,
  theme: ThemeLike,
  pad: number,
  streaming?: boolean,
  owner?: object,
  runIndex?: number,
) => CompactLine;

export function createThinkingPreview(timers: Timers = realTimers, quiet?: QuietMode): ThinkingPreview {
  // `pad` is part of the core bridge signature but unused: the gutter already
  // positions the row, so honoring pad too would double-indent it.
  return (text, theme, _pad, streaming, owner, runIndex) => {
    const line = new CompactLine(timers);
    // Match the tool-call status language (› • ✓): a dot while streaming, a
    // check once the message completes.
    const glyph = streaming ? "•" : "✓";
    // Purple gutter (thinkingText = #c4a7e7): matches the expanded thinking
    // text color, so collapsed and expanded thinking share one hue. Tool rows
    // stay pastel green.
    line.setGutter(` ${theme.fg("thinkingText", "▌")} `);
    line.set(
      `${theme.fg("success", glyph)} ${theme.fg("success", "think")} ${theme.fg("toolTitle", text.replace(/\s+/g, " ").trim())}`,
      streaming ? (row) => theme.bg("toolPendingBg", row) : undefined,
    );
    if (quiet && owner && runIndex !== undefined) {
      const id = quiet.thinkingId(owner, runIndex);
      line.setQuietText(() => {
        const view = quiet.view(id);
        if (view === "show") return undefined;
        if (view === "hide") return null;
        return quietSummaryText(view.summary, view.failures, theme);
      });
    }
    return line;
  };
}
