/**
 * RUNTIME core patches: wrappers on Pi's real component prototypes.
 *
 * WHY THIS WORKS
 * --------------
 * Pi's bundled CLI loads extensions through jiti with
 * `virtualModules: VIRTUAL_MODULES` (see core/extensions/loader.ts; the bundle
 * sets `isBundledNode = true`). Those virtual modules are the bundle's OWN live
 * module namespaces. So when this extension imports
 * `@earendil-works/pi-coding-agent`, it receives the very same class objects the
 * running TUI instantiates — not a second copy from `dist/`.
 *
 * Every seam is a `prototype` method on a public export, so wrapping at load time
 * leaves nothing on disk modified (a Pi upgrade cannot silently revert it) and
 * the wrappers are ordinary TypeScript, unit-testable against the real
 * components (see test/core-patch.test.ts).
 *
 * Each wrapper reads its behavior from the process-global `Bridge` at CALL time
 * (see bridge.ts), so `/reload` swaps behavior without re-wrapping — and an
 * unloaded extension degrades to Pi's native rendering.
 */

import type { Component } from "@earendil-works/pi-tui";
import { readBridge as bridge, type Bridge } from "./bridge.ts";
import { EmptyComponent, FoldableProse } from "./components.ts";
import type { ThemeLike } from "./row.ts";
import type { NativeResultRenderer, ToolRenderer } from "./tool-renderer.ts";

type Globals = Record<symbol, unknown>;

const EMPTY = new EmptyComponent();
const barrier = (id: string) => bridge()?.observeBarrier(id);

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
 * Give the compact renderer priority and normalize the self-shell spacer when a
 * tool row hosts the one folded-activity summary.
 *
 * `hasRendererDefinition()` and the two getters always answer for a handled tool,
 * so core never reaches its verbose `formatToolExecution()` branch, and
 * late-registered tools with `toolDefinition === undefined` are covered too.
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
   * `handles()` is the single authority (blacklist plus the master switch), so it
   * covers rendererless MCP/third-party tools and late-registered tools whose
   * definition is missing from the UI lookup entirely. Do NOT also claim "any
   * tool with no renderer of its own": that overrides the user's exclusions and
   * the master switch.
   */
  function claims(this: ToolExecutionProto): ToolRenderer | undefined {
    const renderer = bridge()?.toolRenderer;
    return renderer?.handles(this.toolName) ? renderer : undefined;
  }

  once(proto, "toolExecution", () => {
    // Pi attaches exactly one shell after its leading spacer in the constructor.
    // Its getters change live, but updateDisplay() never replaces that child.
    const ownership = new WeakMap<ToolExecutionProto, boolean>();
    function syncShell(this: ToolExecutionProto): boolean {
      const claimed = claims.call(this) !== undefined;
      // A card we do not draw is still visible: let it cut folded runs.
      if (!claimed && this.toolCallId) barrier(this.toolCallId);
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
      if (!renderer) return this.toolDefinition?.renderCall;
      return (args: unknown, theme: unknown, context: unknown) =>
        renderer.renderCall(this.toolName, args, theme, context);
    };

    proto.getResultRenderer = function () {
      const renderer = claims.call(this);
      if (!renderer) return this.toolDefinition?.renderResult;
      const nativeRenderer = this.toolDefinition?.renderResult as NativeResultRenderer | undefined;
      return (result: unknown, options: unknown, theme: unknown, context: unknown) => {
        const component = renderer.renderResult(this.toolName, result, options, theme, context, nativeRenderer);
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
      const ownsSummary = bridge()?.activitySummaryRow(this.toolCallId);
      // The summary must have the same one-line separation regardless of which
      // tool/assistant component happened to become its host.
      return ownsSummary ? withOneLeadingBlank(lines) : lines;
    };
  });
}

/**
 * A user message is visible but never observed otherwise, so without this a
 * folded run could jump over it. It is a barrier: it only cuts runs.
 */
export function patchUserMessage(proto: { rebuild(): void }): void {
  once(proto, "userMessage", () => {
    const nativeRebuild = proto.rebuild;
    // Keyed on the text: Pi builds NEW components for the same messages on every
    // chat rebuild, and a per-component id would append a fresh barrier each time.
    proto.rebuild = function (this: { rebuild(): void; text: string }) {
      nativeRebuild.call(this);
      barrier("user:" + this.text);
    };
  });
}

// ---------------------------------------------------------------------------
// Assistant messages: thinking, prose, summaries
// ---------------------------------------------------------------------------

type AssistantProto = {
  contentContainer: { children: Component[] };
  hideThinkingBlock: boolean;
  thinkingVisibilityOverrides: Map<number, boolean>;
  markdownTheme: Record<string, unknown>;
  isStreaming: boolean;
  lastMessage?: any;
  updateContent(message: any, isStreaming?: boolean): void;
  render(width: number): string[];
  handleMouse(event: MouseLike): unknown;
};

type MouseLike = { y: number; height: number };

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
 * the Nth MouseRegion in contentContainer is the Nth thinking run.
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

/**
 * Collapsed preview, streaming expansion, all-purple expanded Markdown, the
 * run-grouping chronology/spacer hooks, and the summary spacing and mouse
 * correction in `render` / `handleMouse`. `updateContent` does:
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
    const nativeHandleMouse = proto.handleMouse;
    const compactState = new WeakMap<AssistantProto, boolean>();
    // withOneLeadingBlank() changes the lines AFTER Container.render() recorded
    // its mouse layout, so Pi's y (relative to the lines we returned) would
    // miss the summary by that shift. Remember it to translate clicks back.
    const mouseShift = new WeakMap<AssistantProto, { shift: number; height: number }>();

    proto.updateContent = function (this: AssistantProto, message: any, isStreaming = this.isStreaming) {
      const savedHide = this.hideThinkingBlock;
      const savedOverrides = this.thinkingVisibilityOverrides;
      // Default: a streaming block stays collapsed to its compact preview, which
      // already shows the newest text. Opt in to force it open instead.
      const forceOpen = isStreaming && bridge()?.keepActiveThinkingExpanded() === true;
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
      const compact = compactThinking();
      decorateThinking(this, message, isStreaming, compact);
      compactState.set(this, compact);
    };

    proto.render = function (width: number) {
      // A settings toggle requests a repaint, not necessarily updateContent().
      // Rebuild from Pi's original components only on an ownership transition;
      // this also restores native Markdown colors and preserves click overrides.
      if (this.lastMessage && compactState.get(this) !== compactThinking()) {
        this.updateContent(this.lastMessage, this.isStreaming);
      }
      const lines = nativeRender.call(this, width);
      const view = bridge()?.activityMessageView(this);
      if (view === "hidden") return [];
      if (view !== "summary") {
        mouseShift.delete(this);
        return lines;
      }
      mouseShift.set(this, { shift: lines.findIndex((line) => !visiblyBlank(line)) - 1, height: lines.length });
      return withOneLeadingBlank(lines);
    };

    proto.handleMouse = function (this: AssistantProto, event: MouseLike) {
      const moved = mouseShift.get(this);
      return nativeHandleMouse.call(this, moved ? { ...event, y: event.y + moved.shift, height: moved.height } : event);
    };
  });
}

function compactThinking(): boolean {
  return bridge()?.compactThinking() === true;
}

type Decorating = {
  bridge: Bridge;
  theme: ThemeLike | undefined;
  component: AssistantProto;
  message: any;
  isStreaming: boolean;
  compact: boolean;
};

function decorateThinking(component: AssistantProto, message: any, isStreaming: boolean, compact: boolean): void {
  const b = bridge();
  if (!b) return;
  const ctx: Decorating = { bridge: b, theme: liveTheme(), component, message, isStreaming, compact };

  const children = component.contentContainer.children;
  const regions: any[] = children.filter(isMouseRegion);
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
      wrapProse(ctx, i, proseChildren[prose++]);
      continue;
    }
    if (content?.type !== "thinking") continue;
    while (i + 1 < message.content.length && message.content[i + 1]?.type === "thinking") i++;
    const blocks = runs[run];
    if (!blocks) continue;
    const region = regions[run];
    const runIndex = run++;
    if (region) wrapThinkingRun(ctx, region, blocks, runIndex);
  }

  wrapSpacer(ctx, children);
}

/** Wrap a host in the folding component for entry `id`. */
function foldable({ bridge: b, theme }: Decorating, inner: Component, id: string): Component {
  return new FoldableProse(
    inner,
    () => b.proseView(id, theme!),
    () => b.proseHeader(id, theme!),
    (onHeader) => b.click(id, onHeader),
  );
}

/** Observe one prose block and, when a theme is live, let it fold. */
function wrapProse(ctx: Decorating, contentIndex: number, target: { child: any; index: number } | undefined): void {
  const { bridge: b, component, message, isStreaming, theme } = ctx;
  const id = b.observeProse(component, contentIndex, {
    stopReason: message.stopReason,
    streaming: isStreaming,
    timestamp: message.timestamp,
  });
  if (id && target && theme) component.contentContainer.children[target.index] = foldable(ctx, target.child, id);
}

/** Observe one thinking run (a MouseRegion) and replace what it shows. */
function wrapThinkingRun(ctx: Decorating, region: any, blocks: string[], runIndex: number): void {
  const { bridge: b, component, message, isStreaming, theme, compact } = ctx;
  const inner = region.child as any;
  // Collapsed runs are a Text (the hidden label); expanded runs are a Markdown.
  // Only Markdown carries a `theme` field, which is also the field the
  // all-purple recolor needs, so one check serves both branches.
  const hidden = inner?.theme === undefined;
  // Pass `hidden` THROUGH, never `!hidden`. The bridge negates it into
  // `expanded` itself, so negating here too inverted all run folding: expanded
  // thinking became foldable (swallowing whole runs of tool rows into one
  // summary) and collapsed thinking stopped folding entirely.
  const id = b.observeThinking(component, runIndex, isStreaming, hidden, message.timestamp);

  if (!compact) {
    // Native thinking still participates in the separately enabled activity
    // fold, just like native prose. Otherwise keep Pi's component untouched.
    if (id && theme) region.child = foldable(ctx, inner, id);
    return;
  }
  if (!theme) return;

  if (hidden) {
    // MouseRegion.child is `private` in TS only; reassigning keeps the
    // existing click handler (and therefore the expand/collapse toggle).
    region.child = b.thinkingPreview(blocks.join("\n"), theme, isStreaming, component, runIndex);
  } else {
    // Markdown reads its (TS-private) theme at render time, and this runs
    // before the first render, so recoloring in place needs no reconstruction.
    inner.theme = b.thinkingMarkdownTheme(component.markdownTheme, theme);
    // Host the header like native thinking does, so an opened run's header
    // can sit above this row too.
    if (id) region.child = foldable(ctx, inner, id);
  }
}

/**
 * Leading spacer: hidden only when every row of this message is hidden.
 * Identified by what it DOES (renders exactly one blank line) rather than by
 * class, for the same cross-loading-mode reason as isMouseRegion.
 */
function wrapSpacer({ bridge: b, component }: Decorating, children: Component[]): void {
  const first = children[0] as any;
  if (first && typeof first.setLines === "function") {
    children[0] = {
      render: () => (b.messageSpacer(component) === false ? [] : [""]),
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

/** Pi's live Theme instance, shared through globalThis by its theme module. */
function liveTheme(): ThemeLike | undefined {
  return (globalThis as Globals)[Symbol.for("@earendil-works/pi-coding-agent:theme")] as ThemeLike | undefined;
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
  UserMessageComponent?: new (...args: never[]) => unknown;
}): void {
  // Pi's `private` members make these classes structurally unassignable to the
  // interfaces above, so cross the boundary once, here, explicitly.
  const proto = (target: unknown) => (target as { prototype: any } | undefined)?.prototype;
  const tool = proto(core.ToolExecutionComponent);
  const assistant = proto(core.AssistantMessageComponent);
  if (tool) patchToolExecution(tool);
  if (assistant) patchAssistantMessage(assistant);
  const user = proto(core.UserMessageComponent);
  if (user) patchUserMessage(user);
}
