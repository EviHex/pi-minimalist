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
  getCallRenderer(): unknown;
  getResultRenderer(): unknown;
  hasRendererDefinition(): boolean;
  getRenderShell(): string;
  createResultFallback(): Component | undefined;
};

/**
 * PATCH 1 — give the compact renderer priority for selected native built-ins
 * and for every rendererless third-party/MCP tool.
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
 * Markdown, and the quiet chronology/spacer hooks.
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
 *  - quiet chronology: observe prose/thinking in transcript order.
 *  - quiet message spacer: replace the leading `Spacer` with one that asks quiet
 *    mode, at render time, whether it still belongs.
 */
export function patchAssistantMessage(proto: AssistantProto): void {
  once(proto, "assistantMessage", () => {
    const nativeUpdateContent = proto.updateContent;

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
  });
}

function decorateThinking(component: AssistantProto, message: any, isStreaming: boolean): void {
  const preview = bridge<ThinkingBridge>("thinkingPreview");
  const purple = bridge<(base: Record<string, unknown>, theme: unknown) => Record<string, unknown>>(
    "thinkingMarkdownTheme",
  );
  const quietThinking = bridge<(owner: object, run: number, streaming: boolean, hidden: boolean) => void>(
    "quietThinking",
  );
  const quietProse = bridge<(owner: object, contentIndex: number) => void>("quietProse");
  const messageSpacer = bridge<(owner: object) => boolean>("quietMessageSpacer");
  const theme = liveTheme();

  const children = component.contentContainer.children;
  const regions = thinkingRegions(children);
  const runs = thinkingRuns(message);

  // Transcript order: core interleaves prose and thinking while walking
  // message.content, and quiet mode's run folding depends on that order.
  let run = 0;
  for (let i = 0; i < (message?.content?.length ?? 0); i++) {
    const content = message.content[i];
    if (content?.type === "text" && String(content.text ?? "").trim()) {
      quietProse?.(component, i);
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
    // Pass `hidden`, NOT `!hidden`. The bridge itself negates it into `expanded`
    // (bridge.ts), so negating here too inverted quiet folding: expanded
    // thinking became foldable (swallowing whole runs of tool rows into one
    // summary) and collapsed thinking stopped folding.
    quietThinking?.(component, runIndex, isStreaming, hidden);

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
