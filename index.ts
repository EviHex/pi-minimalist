/**
 * pi-minimalist
 * =============
 * One home for all Pi UI simplification. Three independent features share the
 * same tiny-core-bridge infrastructure (see patch-pi.sh in this folder):
 *
 * 1. COMPACT TOOL RENDERER — every tool call renders as ONE line
 *        ✓ read src/a.ts
 *        ✗ bash go test ./...
 *    Full original output stays available via the expand keybinding (Ctrl+O).
 *    Covers native built-ins AND rendererless MCP/third-party tools.
 *
 * 2. COLLAPSED THINKING PREVIEW — a hidden thinking block (Ctrl+T) shows
 *        • think The user wants me to…   ← while streaming (row highlighted)
 *        ✓ think The user wants me to…   ← once the message completes
 *    instead of Pi's bare "Thinking..." label. Expanded view unchanged.
 *
 * 3. FOOTER STATUS MANAGER — view and selectively hide extension footer
 *    statuses:  /footer  (dialog)   /footer <key>  (direct toggle)
 *    Hidden keys persist in hidden.json next to this file.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LAYOUT — this file is WIRING ONLY; all behavior lives in src/ so it can be
 * unit tested without an extension runtime (see src/*.test.ts, run-tests.sh):
 *   src/components.ts        CompactLine, EmptyComponent, GutteredComponent, gutters
 *   src/tool-rows.ts         pure row text, status glyphs, colors
 *   src/tool-renderer.ts     feature 1 renderer factory
 *   src/thinking-preview.ts  feature 2 preview factory
 *   src/footer.ts            feature 3 state, tap, dialog
 *
 * CORE BRIDGES (see AGENTS.md + patch-pi.sh). Pi's extension API cannot express
 * these features alone, so a small idempotent patch makes core consult
 * process-global symbols; ALL styling/behavior stays here so /reload refreshes it:
 *   - Symbol.for("pi.defaultToolRenderer")  → feature 1
 *   - Symbol.for("pi.thinkingPreview")      → feature 2
 *   - Symbol.for("pi.statusTap")            → feature 3 (hide statuses)
 *   - ctx.ui.getExtensionStatuses()         → feature 3 (view statuses)
 *
 * This extension registers NO tools. Re-registering read/bash/edit/write would
 * make pi-subagents classify them as extension-owned and strip them from child
 * tool allowlists; the render-only core bridge exists precisely to avoid that.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { FooterStatuses, FooterToggleDialog, jsonFileStore } from "./src/footer.ts";
import { createThinkingPreview, type ThinkingPreview } from "./src/thinking-preview.ts";
import { createToolRenderer, type ToolRenderer } from "./src/tool-renderer.ts";

// Symbol.for uses a process-wide registry: the core patch and every extension
// reload asking for these exact strings receive the SAME symbol.
const DEFAULT_RENDERER = Symbol.for("pi.defaultToolRenderer");
const THINKING_PREVIEW = Symbol.for("pi.thinkingPreview");
const STATUS_TAP = Symbol.for("pi.statusTap");

type Bridges = {
  [DEFAULT_RENDERER]?: ToolRenderer;
  [THINKING_PREVIEW]?: ThinkingPreview;
  [STATUS_TAP]?: (key: string, text: string | undefined) => boolean;
};

export default function (pi: ExtensionAPI) {
  // globalThis is the process-global object; this cast only teaches TypeScript
  // about our symbol keys. The runtime object is unchanged.
  const globals = globalThis as typeof globalThis & Bridges;
  const statuses = new FooterStatuses(jsonFileStore(`${import.meta.dirname}/hidden.json`));

  // Every /reload overwrites these slots with the newest instances. Do NOT clear
  // them in session_shutdown: Pi's reload lifecycle can run old shutdown hooks
  // after new extension loading, which would erase the fresh registrations and
  // revert tools to boxed rendering. Process exit clears globalThis naturally;
  // disabling this extension requires one full Pi restart.
  globals[DEFAULT_RENDERER] = createToolRenderer();
  globals[THINKING_PREVIEW] = createThinkingPreview();
  globals[STATUS_TAP] = (key, text) => statuses.tap(key, text);

  // Capture ctx.ui once so autocomplete (which runs outside handlers) can merge
  // statuses that were set before our tap registered.
  pi.on("session_start", (_event, ctx) => {
    statuses.attachUi(ctx.ui as { getExtensionStatuses?: () => Map<string, string> });
  });

  pi.registerCommand("footer", {
    description: "View / toggle extension footer statuses (hide noisy ones)",
    // Autocomplete for `/footer <key>`: offer every known status key, with
    // hidden ones described as such, so nobody has to remember extension names.
    getArgumentCompletions: (argumentPrefix: string) =>
      statuses
        .keys()
        .filter((key) => key.startsWith(argumentPrefix.trim()))
        .map((key) => ({
          value: key,
          label: key,
          description: statuses.isHidden(key)
            ? "hidden — select in /footer dialog or re-run to show"
            : (statuses.text(key) ?? ""),
        })),
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      statuses.attachUi(ctx.ui as { getExtensionStatuses?: () => Map<string, string> });
      const entries = statuses.entries();

      if (entries.length === 0) {
        ctx.ui.notify("No extension statuses are currently set.", "info");
        return;
      }

      // Direct toggle mode: `/footer polyglot`
      const directKey = args.trim();
      if (directKey) {
        if (!statuses.has(directKey)) {
          ctx.ui.notify(
            `Unknown status key: "${directKey}". Run /footer with no args to list keys.`,
            "error",
          );
          return;
        }
        const hidden = statuses.toggle(directKey);
        // notify() accepts only info | warning | error — there is no "success".
        ctx.ui.notify(
          `${directKey}: ${hidden ? "hidden from footer" : "visible in footer"}`,
          "info",
        );
        return;
      }

      // Interactive mode: ctx.ui.custom replaces the editor with our dialog
      // until done() is called.
      await ctx.ui.custom<void>((_tui, theme, keybindings, done) =>
        new FooterToggleDialog(entries, theme, keybindings, statuses, () => done()),
      );
    },
  });
}
