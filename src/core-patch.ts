/**
 * RUNTIME core patches — the replacement for the old patch-pi.sh bundle edits.
 *
 * WHY THIS WORKS (the discovery that removed the patch script)
 * -----------------------------------------------------------
 * Pi's bundled CLI loads extensions through jiti with
 * `virtualModules: VIRTUAL_MODULES` (see core/extensions/loader.ts; the bundle
 * sets `isBundledNode = true`). Those virtual modules are the bundle's OWN live
 * module namespaces. So when this extension imports
 * `@earendil-works/pi-coding-agent`, it receives the very same class objects the
 * running TUI instantiates — not a second copy from `dist/`.
 *
 * `ToolExecutionComponent` and `AssistantMessageComponent` are public exports,
 * and every seam the old patch script rewrote is a `prototype` method. Wrapping
 * those prototypes at load time therefore produces exactly the behavior the perl
 * substitutions produced, with three advantages:
 *
 *   - a Pi upgrade cannot silently revert it (nothing on disk is modified);
 *   - no `node --check`, no marker greps, no per-release regex maintenance;
 *   - the wrappers are ordinary TypeScript, unit-testable against the real
 *     components (see test/core-patch.test.ts).
 *
 * Each wrapper reads its behavior from the process-global bridge slots at CALL
 * time (see bridge.ts), so `/reload` swaps behavior without re-wrapping — and
 * an unloaded extension degrades to Pi's native rendering.
 */

import type { Component } from "@earendil-works/pi-tui";
import { BRIDGE_SYMBOLS } from "./bridge.ts";
import { FoldableProse } from "./components.ts";
import type { Row, ThemeLike } from "./row.ts";

type Globals = Record<symbol, unknown>;

function bridge<T>(key: keyof typeof BRIDGE_SYMBOLS): T | undefined {
  return (globalThis as Globals)[Symbol.for(BRIDGE_SYMBOLS[key])] as T | undefined;
}

/** Applied-once marker per prototype, so /reload never double-wraps. */
const PATCHED = Symbol.for("pi.minimalist.corePatched");

function once(target: object, name: string, apply: () => void): void {
  const marks = ((target as any)[PATCHED] ??= {});
  if (marks[name]) return;
  apply();
  marks[name] = true;
}

// ---------------------------------------------------------------------------
// The shapes this module needs from Pi. Structural, and deliberately loose:
// these are core internals, so a narrow `any` at the seam beats a fake
// full-fidelity type that would silently drift on the next release.
//
// Pi declares most of these members `private`, which makes its real classes
// structurally INCOMPATIBLE with any interface naming them (TS treats a private
// member as nominal). `private` is a compile-time notion only — at runtime these
// are ordinary properties — so patchCore() accepts the class objects loosely and
// each patch function keeps its precise internal shape for the body below.
// ---------------------------------------------------------------------------

type ToolRendererBridge = {
  renderShell?: "self" | "default";
  handles?: (name: string) => boolean;
  renderCall?: (name: string, args: unknown, theme: unknown, context: unknown) => Component;
  renderResult?: (
    name: string,
    result: unknown,
    options: unknown,
    theme: unknown,
    context: unknown,
    nativeRenderer?: unknown,
  ) => Component | undefined;
};

type ToolExecutionProto = {
  toolName: string;
  toolCallId: string;
  toolDefinition?: { renderCall?: unknown; renderResult?: unknown; renderShell?: string };
  children: Component[];
  contentBox: Component;
  contentTextRegion: Component;
  selfRenderContainer: Component;
  callRendererComponent?: Component;
  resultRendererComponent?: Component;
  rendererState: { callLine?: unknown; originalResult?: unknown };
  updateDisplay(): void;
  getCallRenderer(): unknown;
  getResultRenderer(): unknown;
  hasRendererDefinition(): boolean;
  getRenderShell(): string;
  createResultFallback(): Component | undefined;
  render(width: number): string[];
};

/**
 * PATCH 1 — give the compact renderer priority and remove the self-shell spacer
 * when a tool row temporarily hosts the one folded-activity summary.
 *
 * Replaces the old `getCallRenderer` / `getResultRenderer` /
 * `hasRendererDefinition` / `getRenderShell` bundle rewrite, plus both
 * `create*Fallback` rewrites. The fallbacks no longer need patching: because
 * `hasRendererDefinition()` and the two getters now always answer for a handled
 * tool, core never reaches its verbose `formatToolExecution()` branch, and
 * late-registered tools with `toolDefinition === undefined` are covered by the
 * same condition.
 *
 * The native tool definitions are NOT touched: this is render-only, so built-ins
 * keep their builtin source ownership and pi-subagents keeps exposing
 * read/bash/write to child runtimes.
 */
export function patchToolExecution(proto: ToolExecutionProto): void {
  const nativeResultFallback = proto.createResultFallback;
  const nativeRender = proto.render;
  const nativeUpdateDisplay = proto.updateDisplay;

  /**
   * "Ours" when the bridge claims this tool name — and ONLY then.
   *
   * `handles()` is now the single authority (blacklist plus the master switch),
   * so it covers rendererless MCP/third-party tools and late-registered tools
   * whose definition is missing from the UI lookup entirely.
   *
   * There used to be an extra "...or the tool has no renderer of its own"
   * fallback here. Under the old whitelist it was load-bearing. With a blacklist
   * it silently OVERRODE the user: an excluded tool with no renderer, and every
   * tool when `compactToolRows` was off, got compacted anyway.
   */
  function claims(this: ToolExecutionProto): ToolRendererBridge | undefined {
    const renderer = bridge<ToolRendererBridge>("toolRenderer");
    if (!renderer?.renderCall) return undefined;
    return renderer.handles?.(this.toolName) ? renderer : undefined;
  }

  once(proto, "toolExecution", () => {
    // Pi attaches exactly one shell after its leading spacer in the constructor.
    // Its getters change live, but updateDisplay() never replaces that child.
    const ownership = new WeakMap<ToolExecutionProto, boolean>();
    function syncShell(this: ToolExecutionProto): boolean {
      const claimed = claims.call(this) !== undefined;
      const shell = this.hasRendererDefinition()
        ? this.getRenderShell() === "self" ? this.selfRenderContainer : this.contentBox
        : this.contentTextRegion;
      const previous = ownership.get(this);
      ownership.set(this, claimed);
      if (previous === claimed && this.children[1] === shell) return false;

      if (previous !== undefined) {
        // /reload can replace the CompactLine class while this wrapper survives.
        const callLine = this.rendererState.callLine as { stopTicker?: () => void } | undefined;
        if (typeof callLine?.stopTicker === "function") callLine.stopTicker();
        delete this.rendererState.callLine;
        delete this.rendererState.originalResult;
        this.callRendererComponent = undefined;
        this.resultRendererComponent = undefined;
      }
      // Keep the spacer first and Pi's existing image/spacer children after the
      // shell; native updateDisplay() refreshes their content on this same pass.
      this.children[1] = shell;
      return true;
    }

    proto.updateDisplay = function () {
      syncShell.call(this);
      nativeUpdateDisplay.call(this);
    };

    proto.getCallRenderer = function () {
      const renderer = claims.call(this);
      if (!renderer?.renderCall) return this.toolDefinition?.renderCall;
      return (args: unknown, theme: unknown, context: unknown) =>
        renderer.renderCall!(this.toolName, args, theme, context);
    };

    proto.getResultRenderer = function () {
      const renderer = claims.call(this);
      if (!renderer?.renderResult) return this.toolDefinition?.renderResult;
      const nativeRenderer = this.toolDefinition?.renderResult;
      return (result: unknown, options: unknown, theme: unknown, context: unknown) => {
        const component = renderer.renderResult!(this.toolName, result, options, theme, context, nativeRenderer);
        // `undefined` means "show Pi's own text output". Core's RESULT-RENDERER
        // path (unlike its fallback path) would wrap undefined in a MouseRegion
        // and crash at render, so resolve the fallback here instead.
        return component ?? nativeResultFallback.call(this) ?? EMPTY;
      };
    };

    // A handled tool always has a renderer, so core must never treat the row as
    // definition-less and fall back to the verbose JSON card.
    const nativeHasDefinition = proto.hasRendererDefinition;
    proto.hasRendererDefinition = function (this: ToolExecutionProto) {
      return nativeHasDefinition.call(this) || claims.call(this) !== undefined;
    };

    const nativeRenderShell = proto.getRenderShell;
    proto.getRenderShell = function () {
      const renderer = claims.call(this);
      return renderer?.renderShell ?? nativeRenderShell.call(this);
    };

    proto.render = function (width: number) {
      // A settings toggle may only request a repaint, not an updateDisplay().
      // Rebuild once on transition, never on every render (or during a renderer).
      if (syncShell.call(this)) nativeUpdateDisplay.call(this);
      const lines = nativeRender.call(this, width);
      const ownsSummary = bridge<(id: string) => boolean>("activitySummaryRow")?.(this.toolCallId);
      // The summary must have the same one-line separation regardless of which
      // tool/assistant component happened to become its host.
      return ownsSummary ? withOneLeadingBlank(lines) : lines;
    };
  });
}

/** Renders nothing, for the "no result content at all" case. */
const EMPTY: Component = { render: () => [], invalidate: () => {} };

// ---------------------------------------------------------------------------
// PATCH 2 — thinking blocks
// ---------------------------------------------------------------------------

type ThinkingBridge = (
  text: string,
  theme: unknown,
  pad: number,
  streaming?: boolean,
  owner?: object,
  runIndex?: number,
) => Component;

type AssistantProto = {
  contentContainer: { children: Component[] };
  hideThinkingBlock: boolean;
  thinkingVisibilityOverrides: Map<number, boolean>;
  markdownTheme: Record<string, unknown>;
  outputPad: number;
  isStreaming: boolean;
  updateContent(message: any, isStreaming?: boolean): void;
  render(width: number): string[];
};

/** One thinking run: consecutive `thinking` blocks, exactly as core groups them. */
function thinkingRuns(message: any): string[][] {
  const runs: string[][] = [];
  const content: any[] = message?.content ?? [];
  for (let i = 0; i < content.length; i++) {
    if (content[i]?.type !== "thinking") continue;
    const blocks: string[] = [];
    for (; i < content.length && content[i]?.type === "thinking"; i++) {
      const text = String(content[i].thinking ?? "").trim();
      if (text) blocks.push(text);
    }
    i--;
    if (blocks.length) runs.push(blocks);
  }
  return runs;
}

/**
 * Core wraps every thinking run — and ONLY a thinking run — in a MouseRegion, so
 * the Nth MouseRegion in contentContainer is the Nth thinking run. That is the
 * seam this patch uses instead of the old bundle rewrite.
 *
 * Recognized STRUCTURALLY, not by `instanceof` or `constructor.name`, because
 * neither is reliable across Pi's loading modes:
 *   - `instanceof` fails when the bundle INLINES its own copy of pi-tui: the
 *     bundle's MouseRegion is then a different class object from the one an
 *     `import` resolves to (verified against the real bundle);
 *   - `constructor.name` depends on the minifier keeping inferred class names.
 * Field names are part of the runtime behavior of these classes, so `child` +
 * `onMouse` is the stable signal.
 */
function isMouseRegion(value: any): boolean {
  return typeof value?.onMouse === "function" && value.child !== undefined;
}

function thinkingRegions(children: Component[]): any[] {
  return children.filter(isMouseRegion);
}

/**
 * PATCH 2 — collapsed preview, streaming expansion, all-purple expanded
 * Markdown, and the run-grouping chronology/spacer hooks.
 *
 * Replaces five bundle rewrites inside `updateContent` with one wrapper:
 *
 *  - active thinking: a streaming block stays COLLAPSED by default (its compact
 *    preview already shows the latest text). `keepActiveThinkingExpanded` forces
 *    it open for the duration of the original call by neutralizing
 *    `hideThinkingBlock` + the override map, then restoring both. Either way the
 *    click handler stores into the LIVE map, so an explicit Ctrl+T expansion
 *    always survives — the default only decides what happens when the user has
 *    not expressed a preference.
 *  - collapsed preview: swap the hidden run's `Text` for our compact line.
 *  - expanded theme: recolor the run's `Markdown` in place (its private `theme`
 *    field is read at render time, and this runs before the first render).
 *  - chronology: observe prose/thinking in transcript order, which is what run
 *    folding needs.
 *  - message spacer: replace the leading `Spacer` with one that asks, at render
 *    time, whether it still belongs.
 */
export function patchAssistantMessage(proto: AssistantProto): void {
  once(proto, "assistantMessage", () => {
    const nativeUpdateContent = proto.updateContent;
    const nativeRender = proto.render;

    proto.updateContent = function (this: AssistantProto, message: any, isStreaming = this.isStreaming) {
      const savedHide = this.hideThinkingBlock;
      const savedOverrides = this.thinkingVisibilityOverrides;
      // Default: a streaming block stays collapsed to its compact preview, which
      // already shows the newest text. Opt in to force it open instead.
      const forceOpen = isStreaming && bridge<() => boolean>("keepActiveThinkingExpanded")?.() === true;
      if (forceOpen) {
        this.hideThinkingBlock = false;
        this.thinkingVisibilityOverrides = new Map();
      }
      try {
        nativeUpdateContent.call(this, message, isStreaming);
      } finally {
        this.hideThinkingBlock = savedHide;
        this.thinkingVisibilityOverrides = savedOverrides;
      }
      decorateThinking(this, message, isStreaming);
    };

    proto.render = function (width: number) {
      const lines = nativeRender.call(this, width);
      const view = bridge<(owner: object) => "normal" | "hidden" | "summary">("activityMessageView")?.(this);
      if (view === "hidden") return [];
      return view === "summary" ? withOneLeadingBlank(lines) : lines;
    };
  });
}

function decorateThinking(component: AssistantProto, message: any, isStreaming: boolean): void {
  const preview = bridge<ThinkingBridge>("thinkingPreview");
  const purple = bridge<(base: Record<string, unknown>, theme: unknown) => Record<string, unknown>>(
    "thinkingMarkdownTheme",
  );
  const observeThinking = bridge<(owner: object, run: number, streaming: boolean, hidden: boolean) => void>(
    "observeThinking",
  );
  const observeProse = bridge<(
    owner: object,
    contentIndex: number,
    signal: {
      phase?: "commentary" | "final_answer";
      stopReason?: string;
      streaming?: boolean;
      timestamp?: number;
    },
  ) => string>("observeProse");
  const proseView = bridge<(id: string, theme: ThemeLike) => Row | null | undefined>("proseView");
  const messageSpacer = bridge<(owner: object) => boolean>("messageSpacer");
  const theme = liveTheme();

  const children = component.contentContainer.children;
  const regions = thinkingRegions(children);
  const runs = thinkingRuns(message);

  // Direct Markdown children correspond one-for-one with non-empty text blocks;
  // thinking Markdown lives inside MouseRegion and is deliberately excluded.
  const proseChildren = children
    .map((child, index) => ({ child: child as any, index }))
    .filter(({ child }) => typeof child?.text === "string" && child?.theme !== undefined);

  // Transcript order: core interleaves prose and thinking while walking
  // message.content, and run folding depends on that order.
  let run = 0;
  let prose = 0;
  for (let i = 0; i < (message?.content?.length ?? 0); i++) {
    const content = message.content[i];
    if (content?.type === "text" && String(content.text ?? "").trim()) {
      const phase = textPhase(content.textSignature);
      const id = observeProse?.(component, i, {
        phase,
        stopReason: message.stopReason,
        streaming: isStreaming,
        timestamp: message.timestamp,
      });
      const target = proseChildren[prose++];
      if (id && target && proseView && theme) {
        children[target.index] = new FoldableProse(target.child, () => proseView(id, theme as ThemeLike));
      }
      continue;
    }
    if (content?.type !== "thinking") continue;
    while (i + 1 < message.content.length && message.content[i + 1]?.type === "thinking") i++;
    const blocks = runs[run];
    if (!blocks) continue;
    const entry = regions[run];
    const runIndex = run++;
    if (!entry) continue;

    const inner = entry.child as any;
    // Collapsed runs are a Text (the hidden label); expanded runs are a Markdown.
    // Only Markdown carries a `theme` field, which is also the field the
    // all-purple recolor needs, so one check serves both branches.
    const hidden = inner?.theme === undefined;
    // Pass `hidden` THROUGH, never `!hidden`. bridge.ts negates it into
    // `expanded` itself, so negating here too inverted all run folding: expanded
    // thinking became foldable (swallowing whole runs of tool rows into one
    // summary) and collapsed thinking stopped folding entirely.
    observeThinking?.(component, runIndex, isStreaming, hidden);

    if (hidden) {
      if (!preview || !theme) continue;
      // MouseRegion.child is `private` in TS only; reassigning keeps the
      // existing click handler (and therefore the expand/collapse toggle).
      entry.child = preview(
        blocks.join("\n"),
        theme,
        component.outputPad,
        isStreaming,
        component,
        runIndex,
      );
    } else if (purple && theme && inner?.theme !== undefined) {
      // Markdown reads its (TS-private) theme at render time, and this runs
      // before the first render, so recoloring in place needs no reconstruction.
      inner.theme = purple(component.markdownTheme, theme);
    }
  }

  // Leading spacer: hidden only when every row of this message is hidden.
  // Identified by what it DOES (renders exactly one blank line) rather than by
  // class, for the same cross-loading-mode reason as isMouseRegion.
  const first = children[0] as any;
  if (messageSpacer && first && typeof first.setLines === "function") {
    children[0] = {
      render: () => (messageSpacer(component) === false ? [] : [""]),
      invalidate: () => {},
    };
  }
}

/** Exactly one physical blank before a visible activity summary. */
function withOneLeadingBlank(lines: string[]): string[] {
  const firstVisible = lines.findIndex((line) => !visiblyBlank(line));
  if (firstVisible === -1) return [];
  if (firstVisible === 0) return ["", ...lines];
  // Keep the first blank because it may carry Pi's OSC 133 zone-start marker;
  // discard every other spacer-only line before the summary.
  return [lines[0], ...lines.slice(firstVisible)];
}

function visiblyBlank(line: string): boolean {
  return line
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .trim() === "";
}

function textPhase(signature: unknown): "commentary" | "final_answer" | undefined {
  if (typeof signature !== "string" || !signature.startsWith("{")) return undefined;
  try {
    const phase = JSON.parse(signature).phase;
    return phase === "commentary" || phase === "final_answer" ? phase : undefined;
  } catch {
    return undefined;
  }
}

/** Pi's live Theme instance, shared through globalThis by its theme module. */
function liveTheme(): unknown {
  return (globalThis as Globals)[Symbol.for("@earendil-works/pi-coding-agent:theme")];
}

/**
 * Install every runtime core patch. Idempotent across /reload.
 *
 * Takes the module namespace of `@earendil-works/pi-coding-agent`. Each class is
 * optional so a Pi release that drops or renames one degrades to native
 * rendering instead of throwing during extension load (which would disable the
 * whole extension). test/integration.test.ts fails loudly in that case.
 */
export function patchCore(core: {
  ToolExecutionComponent?: new (...args: never[]) => unknown;
  AssistantMessageComponent?: new (...args: never[]) => unknown;
}): void {
  // Pi's `private` members make these classes structurally unassignable to the
  // interfaces above, so cross the boundary once, here, explicitly.
  const proto = (target: unknown) => (target as { prototype: any } | undefined)?.prototype;
  const tool = proto(core.ToolExecutionComponent);
  const assistant = proto(core.AssistantMessageComponent);
  if (tool) patchToolExecution(tool);
  if (assistant) patchAssistantMessage(assistant);
}
