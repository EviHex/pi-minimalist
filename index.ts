/**
 * pi-minimalist
 * =============
 * One home for all Pi UI simplification. Three independent features share
 * the same tiny-core-bridge infrastructure (see patch-pi.sh in this folder):
 *
 * 1. COMPACT TOOL RENDERER — every tool call renders as ONE line
 *        ✓ read src/a.ts
 *        ✗ bash go test ./...
 *    Full original output stays available via the expand keybinding
 *    (Ctrl+O / Cmd+O). Covers built-ins AND rendererless MCP tools.
 *
 * 2. COLLAPSED THINKING PREVIEW — a hidden thinking block (Ctrl+T) shows
 *        • think The user wants me to…   ← while streaming (row highlighted)
 *        ✓ think The user wants me to…   ← once the message completes
 *    instead of Pi's bare "Thinking..." label. Expanded view unchanged.
 *
 * 3. FOOTER STATUS MANAGER — view and selectively hide extension footer
 *    statuses (polyglot, caveman, ponytail, MCP adapters, JetBrains MCP…):
 *        /footer             interactive viewer; select a status to toggle
 *        /footer <key>       direct toggle; the key autocompletes
 *    Hidden keys persist in hidden.json next to this file.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CORE BRIDGES (see AGENTS.md + patch-pi.sh)
 * Pi's extension API cannot express any of the three features alone, so a
 * small idempotent patch (patch-pi.sh) makes core consult process-global
 * symbols; ALL styling/behavior lives here so /reload refreshes it:
 *   - Symbol.for("pi.defaultToolRenderer")  → feature 1
 *   - Symbol.for("pi.thinkingPreview")      → feature 2
 *   - Symbol.for("pi.statusTap")            → feature 3 (hide statuses)
 *   - ctx.ui.getExtensionStatuses()         → feature 3 (view statuses)
 */

import { homedir } from "node:os";
import { readFileSync, writeFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text, truncateToWidth, matchesKey } from "@earendil-works/pi-tui";
import type { Component } from "@earendil-works/pi-tui";

/*
 * TYPESCRIPT QUICK READING GUIDE
 * ------------------------------
 * - `import type` imports only a compile-time type; no JavaScript is loaded.
 * - `value ?? fallback` uses fallback only for null/undefined (not for 0/"").
 * - `condition ? a : b` is a compact if/else expression.
 * - `` `${value}` `` is a template string: values inside ${...} are inserted.
 * - `foo?: T` means property foo is optional.
 * - `unknown` means "some value; inspect/convert before using it".
 * - `any` disables type checking. Pi's renderer contexts are currently typed as
 *   any here because wrapping seven differently typed tools into one loop would
 *   otherwise add lots of generic type machinery without changing behavior.
 * - `as SomeType` tells TypeScript how to view a value; it does not transform it.
 * - `{ ...object, x: y }` copies object, then replaces/adds x.
 * - `() => value` is an arrow function (short function syntax).
 */

// Symbol.for uses a process-wide registry: core patch and extension reloads
// asking for these exact strings receive the SAME symbol (Symbol() would not).
const DEFAULT_RENDERER = Symbol.for("pi.defaultToolRenderer");
const THINKING_PREVIEW = Symbol.for("pi.thinkingPreview");
const STATUS_TAP = Symbol.for("pi.statusTap");

// This type documents the object contract shared with the small core bridge.
// It disappears after TypeScript compilation; it has no runtime cost.
type NativeResultRenderer = (result: any, options: any, theme: any, context: any) => Component;

type GlobalRenderer = {
  renderShell: "self";
  /** Named overrides replace rendering only; tool definition/execution stays native. */
  handles: (name: string) => boolean;
  renderCall: (name: string, args: unknown, theme: any, context: any) => CompactLine;
  renderResult: (
    name: string,
    result: any,
    options: any,
    theme: any,
    context: any,
    nativeRenderer?: NativeResultRenderer,
  ) => Component | undefined;
};

/**
 * One physical terminal line with width-aware truncation and full-width color.
 *
 * Pi's Text component wraps long strings. That is correct for prose but made a
 * long path spill onto a second line in our supposedly single-line renderer.
 * TUI only supplies the real terminal width during render(), so truncating in
 * callText() with a fixed character count cannot solve this reliably.
 */
class CompactLine implements Component {
  private text = "";
  private background: ((text: string) => string) | undefined;
  private ticker: ReturnType<typeof setInterval> | undefined;
  private gutter = "";

  set(text: string, background?: (text: string) => string): void {
    this.text = text;
    this.background = background;
  }

  /**
   * Left gutter marker, e.g. a dim "│ " drawn before the row content.
   * Consecutive tool rows then form one continuous vertical line, which
   * visually groups them into a block distinct from model prose (which
   * stays flush against the left edge). Pre-colored by the caller so the
   * gutter can use a different color than the row text.
   */
  setGutter(gutter: string): void {
    this.gutter = gutter;
  }

  /**
   * Repaint once per second while a tool runs, so the elapsed timer ticks
   * even for silent commands that produce no streaming output (the only
   * other repaint trigger). unref() keeps a forgotten ticker from holding
   * the process open; stopTicker() clears it when the row finishes.
   */
  startTicker(requestRender: () => void): void {
    if (this.ticker) return; // already ticking
    this.ticker = setInterval(requestRender, 1000);
    this.ticker.unref?.();
  }

  stopTicker(): void {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = undefined;
    }
  }

  render(width: number): string[] {
    // TUI pads each line to terminal width with spaces, so no manual trailing
    // padding is needed. truncateToWidth understands ANSI color codes and
    // wide Unicode glyphs, so colored text truncates at visible columns.
    // The gutter is a fixed-width prefix, so truncate the content to the
    // remaining columns. gutterWidth counts visible columns (the gutter
    // string carries ANSI color codes, which occupy no screen width).
    const gutterWidth = this.gutter ? GUTTER_WIDTH : 0;
    const line = truncateToWidth(this.text, Math.max(1, width - gutterWidth), "…");
    return this.background ? [this.gutter + this.background(line)] : [this.gutter + line];
  }

  // Component contract allows cached components to be invalidated. This class
  // computes one cheap line every render, so no cache needs clearing.
  invalidate(): void {}
}

/**
 * Collapsed results must render ZERO lines, not one blank line.
 *
 * Pi's Text component returns [""] for empty strings (one blank row), which
 * doubled the height of every collapsed tool call. This tiny component is the
 * only safe way to say "no content at all" while still returning a Component
 * as the renderResult slot contract requires.
 */
class EmptyComponent implements Component {
  render(): string[] {
    return [];
  }

  invalidate(): void {}
}

/**
 * Wraps another component and prefixes EVERY line it renders with the tool
 * gutter, so expanded output stays visually attached to the call row above it
 * instead of blending into model prose.
 *
 * The inner component renders at a reduced width (the gutter occupies real
 * columns), otherwise its own wrapping/truncation would overflow the row.
 */
class GutteredComponent implements Component {
  // The wrapped component is stored so repeated renders reuse one instance,
  // which built-in result renderers rely on for their internal caching.
  constructor(
    private inner: Component,
    private gutterText: string,
    private gutterWidth: number,
  ) {}

  /** Swap in the newest inner component while keeping this wrapper stable. */
  setInner(inner: Component): void {
    this.inner = inner;
  }

  render(width: number): string[] {
    const lines = this.inner.render(Math.max(1, width - this.gutterWidth));
    return lines.map((line) => this.gutterText + line);
  }

  invalidate(): void {
    this.inner.invalidate?.();
  }
}

/** Every built-in tool this extension knows how to compact. */
// `as const` preserves literal names instead of widening every item to string.
const BUILT_INS = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;
// `(typeof BUILT_INS)[number]` turns tuple values into the union type:
// "read" | "bash" | "edit" | "write" | "grep" | "find" | "ls".
type ToolName = (typeof BUILT_INS)[number];

/**
 * State shared between renderCall and renderResult via context.state.
 * We use it to cache the component produced by the original built-in
 * renderResult so consecutive expanded re-renders reuse the same instance
 * (the built-ins themselves expect this — they check context.lastComponent).
 */
type RenderState = {
  originalResult?: unknown;
  /** Wall-clock timestamp (ms) of the first render after execution started. */
  startedAt?: number;
};

/**
 * Dim vertical bar drawn at the left of every compact row (tool calls and
 * the thinking preview). Model prose stays flush left, so a run of tool rows
 * reads as one indented block instead of same-weight lines mixed into text.
 * Indented one column so the bar sits inside the text area instead of
 * colliding with the left border of user-message code blocks. Uses the
 * borderAccent, configured as pastel green in signal.json. borderAccent is a
 * native Pi theme token; custom color keys make theme.fg() throw at runtime.
 */
function gutter(theme: any): string {
  return ` ${theme.fg("borderAccent", "▌")} `;
}

/**
 * Gutter for expanded OUTPUT lines: same glyph and column position as the
 * call row, but dimmed so the call row still reads as the block header while
 * the bar visually binds the output to it.
 */
function outputGutter(theme: any): string {
  return ` ${theme.fg("borderMuted", "▌")} `;
}

/** Visible columns consumed by both gutter variants (space + block + space). */
const GUTTER_WIDTH = 3;

/** Collapse whitespace and truncate long values for one-line display. */
function compact(value: unknown, max = 100): string {
  // `max = 100` is a default parameter. `/\s+/g` means every run of one or
  // more whitespace characters; replacing them prevents multi-line call rows.
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Shorten absolute paths inside the home directory to ~/... for display. */
function shortPath(value: unknown): string {
  const path = String(value ?? "");
  const home = homedir();
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}

/**
 * Build the one-line summary shown next to the status glyph,
 * e.g. "read src/a.ts:1-50", "bash go test ./...", "edit src/b.ts".
 */
function callText(name: ToolName, args: any, expanded = false): string {
  switch (name) {
    case "bash":
      // Spell out the action; "$" looked like terminal output rather than a
      // tool name and could not receive the same action color as other tools.
      // Collapsed rows truncate at 100 chars. Expanded rows preserve the full
      // command LENGTH but still collapse newlines/whitespace into one physical
      // line; otherwise a multiline `python -c`/heredoc escapes the call-row
      // gutter and visually merges with the expanded output below it.
      // CompactLine then clips that one line at the real terminal width.
      return `bash ${compact(args.command, expanded ? Number.POSITIVE_INFINITY : 100)}`;
    case "read": {
      // Show the line range when offset/limit were used, mirroring the
      // built-in read tool's "path:start-end" notation.
      const start = args.offset ?? 1;
      const range = args.offset !== undefined || args.limit !== undefined
        ? `:${start}${args.limit ? `-${start + args.limit - 1}` : ""}`
        : "";
      return `read ${shortPath(args.path)}${range}`;
    }
    case "edit":
    case "write":
      return `${name} ${shortPath(args.path)}`;
    case "grep":
      return `grep /${compact(args.pattern, 50)}/ in ${shortPath(args.path ?? ".")}`;
    case "find":
      return `find ${compact(args.pattern, 50)} in ${shortPath(args.path ?? ".")}`;
    case "ls":
      return `ls ${shortPath(args.path ?? ".")}`;
  }
}

/**
 * Pick the status glyph + color for a render context:
 * - finished: check, success green; failed: cross, error red
 * - running: dot, success green (with elapsed seconds)
 * - queued: caret, success green
 * Returns { glyph, color, elapsed } where elapsed is only set while running.
 *
 * GOTCHA: session replay (restart with history) never calls
 * markExecutionStarted(), so executionStarted stays false for reloaded
 * tools. "Finished" must therefore key off !isPartial (a final result
 * exists), NOT off executionStarted, or every historical tool call shows
 * the queued caret after a restart. executionStarted only distinguishes
 * queued vs running in the live streaming path.
 */
function statusGlyph(context: any): { glyph: string; color: string; elapsed?: number } {
  if (!context.isPartial) {
    // Final result present: covers both live completion and replayed history.
    return { glyph: context.isError ? "✗" : "✓", color: context.isError ? "error" : "success" };
  }
  if (context.executionStarted) {
    const state = context.state as RenderState;
    state.startedAt ??= Date.now();
    const elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
    // Running: a static dot, distinct from the queued caret.
    return { glyph: "•", color: "success", elapsed };
  }
  return { glyph: "›", color: "success" };
}

/**
 * Action color for the leading action word (read/bash/edit/toolcall…).
 * All green — see the note inside for why mutating tools are not warning.
 */
function actionColor(_name: string): string {
  // All actions green (user preference): mutating tools used to be warning
  // orange, but orange already carries "highlighted output" semantics in
  // prose, and the action word is a label, not a warning. Status is conveyed
  // by the glyph color (✗ red on failure), not the action color.
  return "success";
}

/**
 * Color the action word, then optionally insert the elapsed timer right after
 * it (before the command/path details), then the details in tool-title color.
 * Every callText() result starts with its action word.
 */
function colorAction(text: string, theme: any, color: string, timer?: string): string {
  const separator = text.indexOf(" ");
  const action = separator === -1 ? text : text.slice(0, separator);
  const details = separator === -1 ? "" : text.slice(separator);
  const timerPart = timer ? ` ${theme.fg("success", timer)}` : "";
  return theme.fg(color, action) + timerPart + theme.fg("toolTitle", details);
}

/** True for native tools whose rendering (only) we replace. */
function isBuiltIn(name: string): name is ToolName {
  return BUILT_INS.includes(name as ToolName);
}

// ═══════════════════════════════════════════════════════════════════════════
// FEATURE 3: footer status manager — module-level state & helpers
// ═══════════════════════════════════════════════════════════════════════════

// In-memory registry: every status the tap has seen since we loaded.
const statusRegistry = new Map<string, string>();

// Extension commands receive ctx (with the getExtensionStatuses bridge) only
// inside handlers, but autocomplete callbacks run OUTSIDE any handler. We
// cache the first ctx.ui we see (session_start fires before autocomplete can
// be used) so getArgumentCompletions can also merge live statuses.
let cachedUi: { getExtensionStatuses?: () => Map<string, string> } | undefined;

/** Merge statuses that were set BEFORE our tap registered (load-order
 *  stragglers: MCP adapters etc. load and call setStatus before us) into the
 *  registry via the getExtensionStatuses bridge. */
function mergeLiveStatuses(): void {
  const live = cachedUi?.getExtensionStatuses?.();
  if (live) {
    for (const [key, text] of live) {
      if (text !== undefined) statusRegistry.set(key, text);
    }
  }
}

// Persisted hidden keys, stored as a plain JSON array next to this file.
const HIDDEN_FILE = `${import.meta.dirname}/hidden.json`;
const hiddenStatuses = new Set<string>(readHiddenFile());

function readHiddenFile(): string[] {
  try {
    return JSON.parse(readFileSync(HIDDEN_FILE, "utf-8"));
  } catch {
    return []; // Missing or corrupt file → nothing hidden. Safe default.
  }
}

function writeHiddenFile(): void {
  writeFileSync(HIDDEN_FILE, JSON.stringify([...hiddenStatuses], null, 2) + "\n");
}

/**
 * Build the full picture: start from our tap registry (covers everything set
 * since we loaded), then layer in statuses that predate our registration
 * (read via the getExtensionStatuses bridge — visible ones only, since
 * hidden ones never reach that map). Returns entries sorted by key.
 */
function currentStatuses(ctx: ExtensionCommandContext): [string, string][] {
  cachedUi = ctx.ui as { getExtensionStatuses?: () => Map<string, string> };
  const live = cachedUi?.getExtensionStatuses?.();
  if (live) {
    for (const [key, text] of live) {
      if (text !== undefined) statusRegistry.set(key, text);
    }
  }
  return [...statusRegistry.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/** One plain-text viewer line per status: "key → text". */
function statusLabel([key, text]: [string, string]): string {
  const marker = hiddenStatuses.has(key) ? "hidden " : "";
  return `${marker}${key} → ${text}`;
}

/**
 * Interactive dialog for `/footer` (via ctx.ui.custom, which swaps the editor
 * for this component until done() is called).
 *
 * Keys:
 *   ↑/↓ or k/j   move selection
 *   space         toggle the selected status hidden ↔ visible (persists)
 *   s / Enter/Esc close (toggles are already saved on every change)
 *
 * ←/→ flip the state IMMEDIATELY (list + hidden.json) without closing, so
 * several statuses can be adjusted in one visit. The dialog is intentionally
 * borderless and narrow: it is a quick toggle list, not a document.
 */
class FooterToggleDialog implements Component {
  private entries: [string, string][];
  private theme: any;
  private keybindings: any; // injected KeybindingsManager from ctx.ui.custom
  private onClose: () => void;
  private onPersist: () => void;
  private selected = 0;

  constructor(
    entries: [string, string][],
    theme: any,
    keybindings: any,
    onClose: () => void,
    onPersist: () => void,
  ) {
    this.entries = entries;
    this.theme = theme;
    this.keybindings = keybindings;
    this.onClose = onClose;
    this.onPersist = onPersist;
  }

  /** Toggle helper shared by ←/→ so both keys stay symmetric. */
  private setHidden(key: string, hidden: boolean): void {
    if (hidden) hiddenStatuses.add(key);
    else hiddenStatuses.delete(key);
    this.onPersist();
  }

  render(): string[] {
    const theme = this.theme;
    const lines: string[] = [];
    lines.push(theme.fg("accent", theme.bold("extension footer statuses")));
    for (let i = 0; i < this.entries.length; i++) {
      const [key, text] = this.entries[i];
      const isHidden = hiddenStatuses.has(key);
      const cursor = i === this.selected ? theme.fg("accent", "→ ") : "  ";
      // ✓ = visible in footer, ✓ struck-through look via warning color for hidden.
      const state = isHidden
        ? theme.fg("warning", "✗")
        : theme.fg("success", "✓");
      lines.push(
        `${cursor}${state} ${theme.fg("success", key)} ${theme.fg("muted", "→")} ${truncateToWidth(text, 80, "…")}`,
      );
    }
    lines.push(
      theme.fg(
        "dim",
        "↑↓ select · ← hide · → show · Enter/Esc close",
      ),
    );
    return lines;
  }

  handleInput(keyData: string): boolean {
    const kb = this.keybindings;
    if (kb.matches(keyData, "tui.select.up") || keyData === "k") {
      this.selected = Math.max(0, this.selected - 1);
    } else if (kb.matches(keyData, "tui.select.down") || keyData === "j") {
      this.selected = Math.min(this.entries.length - 1, this.selected + 1);
    } else if (matchesKey(keyData, "space")) {
      // Space toggles the selected status hidden ↔ visible and persists right
      // away (writeHiddenFile via onPersist). Arrow-key toggling was tried but
      // left/right never fired reliably in all terminals.
      const key = this.entries[this.selected][0];
      this.setHidden(key, !hiddenStatuses.has(key));
    } else if (
      keyData === "s" ||
      kb.matches(keyData, "tui.select.cancel") ||
      kb.matches(keyData, "tui.select.confirm") ||
      keyData === "\n"
    ) {
      // s / Esc / Enter: close. hidden.json is already written on every
      // toggle, so "save" is implicit — nothing left to do here.
      this.onClose();
    }
    return true; // consume all keys while the dialog is focused
  }

  invalidate(): void {}
}

// ═══════════════════════════════════════════════════════════════════════════
// Extension entry point
// ═══════════════════════════════════════════════════════════════════════════

export default function (pi: ExtensionAPI) {
  /*
   * FEATURE 1: generic fallback for MCP and third-party tools that provide no
   * renderer. Collapsed rows show one status line; Ctrl+O returns undefined,
   * telling the core bridge to use Pi's original full-result fallback.
   */
  // globalThis is the process-global object. The intersection type (`A & B`)
  // says it has all normal globals plus our optional symbol-keyed renderer.
  // Runtime object stays unchanged; this cast only teaches TypeScript the key.
  const globals = globalThis as typeof globalThis & { [DEFAULT_RENDERER]?: GlobalRenderer };
  const renderer: GlobalRenderer = {
    renderShell: "self",
    // Core uses this predicate to override only RENDERING for native tools.
    // Their definitions remain built-in, preserving pi-subagents host-tool
    // discovery and every native execute/schema/security behavior.
    handles: isBuiltIn,
    renderCall(name, args, theme, context) {
      const { glyph, color, elapsed } = statusGlyph(context);
      const timer = elapsed !== undefined ? `[⏱ ${elapsed}s]` : "";
      const component = context.lastComponent instanceof CompactLine
        ? context.lastComponent
        : new CompactLine();
      if (elapsed !== undefined) component.startTicker(() => context.invalidate());
      else component.stopTicker();

      // Named native overrides retain their rich call summaries. Rendererless
      // third-party tools still reach this method through createCallFallback()
      // and receive the generic "toolcall <name>" label.
      const text = isBuiltIn(name) ? callText(name, args, context.expanded) : `toolcall ${name}`;
      const parts: string[] = [];
      if (glyph) parts.push(theme.fg(color, glyph));
      parts.push(colorAction(text, theme, actionColor(name), timer));
      component.setGutter(gutter(theme));
      component.set(parts.join(" "));
      return component;
    },
    renderResult(name, result, options, theme, context, nativeRenderer) {
      // Rendererless third-party tools use Pi's text fallback when expanded.
      if (!isBuiltIn(name)) return options.expanded ? undefined : new EmptyComponent();

      // Native built-ins: collapsed result is hidden; expanded result delegates
      // to the original renderer and adds the dim continuation gutter.
      if (!options.expanded || !nativeRenderer) return new EmptyComponent();
      const state = context.state as RenderState;
      const component = nativeRenderer(result, options, theme, {
        ...context,
        lastComponent: state.originalResult,
      });
      state.originalResult = component;
      const wrapper = context.lastComponent instanceof GutteredComponent
        ? context.lastComponent
        : new GutteredComponent(component, outputGutter(theme), GUTTER_WIDTH);
      wrapper.setInner(component);
      return wrapper;
    },
  };
  // Every /reload overwrites this slot with the newest renderer. Do not clear
  // it in session_shutdown: Pi's reload lifecycle can run old shutdown hooks
  // after extension loading, which would remove the freshly installed global
  // fallback and make MCP tools revert to boxed rendering. Process exit clears
  // globalThis naturally; disabling this extension requires one Pi restart.
  globals[DEFAULT_RENDERER] = renderer;

  /*
   * FEATURE 2: collapsed thinking preview — `> think <preview>` on ONE line,
   * NON-italic. "think" uses success green; the preview text uses toolTitle,
   * the same color other tools use for details. Expanded view is untouched
   * (Pi's native italic thinkingText markdown). CompactLine truncates at the
   * real viewport width in render(). Core passes the full hidden text plus
   * an isStreaming flag.
   */
  const globalsWithThinking = globalThis as typeof globalThis & { [THINKING_PREVIEW]?: (text: string, theme: any, pad: number, streaming?: boolean) => CompactLine };
  globalsWithThinking[THINKING_PREVIEW] = (text, theme, _pad, streaming) => {
    const line = new CompactLine();
    // While the model is still streaming thinking, prefix a running dot and
    // highlight the row like running tools; once done, show a check and plain
    // text, matching the tool-call status language (› • ✓).
    const glyph = streaming ? "•" : "✓";
    line.setGutter(gutter(theme));
    line.set(
      `${theme.fg("success", glyph)} ${theme.fg("success", "think")} ${theme.fg("toolTitle", text.replace(/\s+/g, " ").trim())}`,
      streaming ? (text) => theme.bg("toolPendingBg", text) : undefined,
    );
    return line;
  };

  /*
   * FEATURE 3a: the status tap. Core calls this for EVERY setStatus(key,
   * text) — including text === undefined ("clear"). We record everything in
   * our registry, then decide. Return true = swallow (keep it out of the
   * footer). Registered at load time, before other extensions set statuses.
   *
   * GOTCHA: never call ctx.ui.setStatus from inside this callback — infinite
   * loop (setStatus → tap → setStatus → …).
   */
  const globalsWithTap = globalThis as typeof globalThis & { [STATUS_TAP]?: (key: string, text: string | undefined) => boolean };
  globalsWithTap[STATUS_TAP] = (key, text) => {
    if (text === undefined) statusRegistry.delete(key); // Cleared → drop from viewer.
    else statusRegistry.set(key, text);
    return hiddenStatuses.has(key);
  };

  /*
   * Capture ctx.ui once so autocomplete (which runs outside handlers) can
   * merge live statuses; also seed the registry right away.
   */
  pi.on("session_start", (_event, ctx) => {
    cachedUi = ctx.ui as { getExtensionStatuses?: () => Map<string, string> };
    mergeLiveStatuses();
  });

  /*
   * FEATURE 3b: /footer — interactive viewer. Lists ALL statuses (visible +
   * hidden); select one to toggle it hidden ↔ visible. Esc closes unchanged.
   * `/footer <key>` toggles one key directly without the dialog.
   */
  pi.registerCommand("footer", {
    description: "View / toggle extension footer statuses (hide noisy ones)",
    // Autocomplete for `/footer <key>`: Pi calls this with the text typed
    // after the command + space. We offer every known status key so nobody
    // has to remember extension names. Keys come from our tap registry;
    // hidden ones are prefixed so you can see their state while choosing.
    getArgumentCompletions: (argumentPrefix: string) => {
      mergeLiveStatuses(); // Pick up statuses set before our tap registered.
      return [...statusRegistry.keys()]
        .filter((key) => key.startsWith(argumentPrefix.trim()))
        .map((key) => ({
          value: key,
          label: key,
          description: hiddenStatuses.has(key)
            ? "hidden — select in /footer dialog or re-run to show"
            : (statusRegistry.get(key) ?? ""),
        }));
    },
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const theme = ctx.ui.theme;
      const statuses = currentStatuses(ctx);

      if (statuses.length === 0) {
        ctx.ui.notify("No extension statuses are currently set.", "info");
        return;
      }

      // Direct toggle mode: `/footer polyglot`
      const directKey = args.trim();
      if (directKey) {
        if (!statusRegistry.has(directKey)) {
          ctx.ui.notify(`Unknown status key: "${directKey}". Run /footer with no args to list keys.`, "error");
          return;
        }
        if (hiddenStatuses.has(directKey)) hiddenStatuses.delete(directKey);
        else hiddenStatuses.add(directKey);
        writeHiddenFile();
        ctx.ui.notify(
          `${directKey}: ${hiddenStatuses.has(directKey) ? "hidden from footer" : "visible in footer"}`,
          "success",
        );
        return;
      }

      // Interactive mode: a custom dialog (ctx.ui.custom replaces the editor
      // with our component until done() is called). ui.select was tried first
      // but its Enter-to-select flow was clunky for pure toggling; here ←/→
      // flip a status immediately and stay in the list. Esc/Enter closes.
      await ctx.ui.custom<void>((tui, theme, keybindings, done) => {
        return new FooterToggleDialog(
          statuses,
          theme,
          keybindings,
          () => done(), // close dialog
          () => writeHiddenFile(), // persist on every toggle
        );
      });
    },
  });

  // (A sticky-widget viewer variant existed here as /footer-statuses.
  //  Removed: the /footer dialog already shows everything; two commands
  //  for the same data was confusing.)

}
