/**
 * The tests that replaced patch-pi.sh's marker greps.
 *
 * The old integration test could only assert that certain strings existed inside
 * Pi's compiled bundle — it never executed a single line of the patched code. The
 * runtime patches are ordinary functions applied to Pi's REAL exported component
 * prototypes, so these tests construct those real components, render them, and
 * assert on the painted output. A broken seam now fails here instead of showing
 * up as verbose cards in a live session.
 *
 * Skipped without PI_ROOT (run-tests.sh --unit), like the other integration test.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Container } from "@earendil-works/pi-tui";
import { installBridges } from "../src/bridge.ts";
import { Config } from "../src/config.ts";
import { patchAssistantMessage, patchToolExecution, patchUserMessage } from "../src/core-patch.ts";
import { RunGrouping } from "../src/run-grouping.ts";
import { fakeTimers } from "./test-support.ts";

const PI_ROOT = process.env.PI_ROOT;

function plain(line: string): string {
  // eslint-disable-next-line no-control-regex
  return line.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
}

/** Load Pi's real components + theme, exactly as the bundle would expose them. */
async function loadPi() {
  const components = await import(`${PI_ROOT}/dist/modes/interactive/components/index.js`);
  const { getMarkdownTheme, initTheme } = await import(`${PI_ROOT}/dist/modes/interactive/theme/theme.js`);
  const { withBuiltInRenderers } = await import(`${PI_ROOT}/dist/core/tools/renderers/index.js`);
  initTheme("dark", false);
  // Pi passes getMarkdownThemeWithSettings() into every message component; a
  // stub object would miss bold/italic/underline and throw inside pi-tui.
  const markdownTheme = { ...getMarkdownTheme(), codeBlockIndent: "\u2502 " };
  return { components, withBuiltInRenderers, markdownTheme };
}

/** Config + grouping for one test, on top of the production defaults. */
function state(settings: Partial<ConstructorParameters<typeof Config>[0]> = {}) {
  const config = new Config(settings);
  return { config, grouping: new RunGrouping(config) };
}

function fakeUi() {
  return { requestRender() {}, invalidate() {} };
}

// Real messages get their timestamp from separate API calls, so it is unique; ids rely on that.
let clock = Date.now();
function assistantMessage(content: unknown[], stopReason = "stop") {
  return { role: "assistant", content, stopReason, timestamp: ++clock };
}

describe("runtime core patches against real Pi components", { skip: PI_ROOT ? false : "PI_ROOT not set" }, () => {
  it("compacts a built-in tool row without touching its definition", async () => {
    const { components, withBuiltInRenderers } = await loadPi();
    installBridges(state());
    patchToolExecution(components.ToolExecutionComponent.prototype);

    // Exactly what interactive-mode passes: built-in renderers merged in.
    const definition = withBuiltInRenderers("read", undefined);
    const row = new components.ToolExecutionComponent(
      "read",
      "call-1",
      { path: "src/a.ts" },
      {},
      definition,
      fakeUi(),
      process.cwd(),
    );
    row.updateResult({ content: [{ type: "text", text: "file body" }], details: {} });

    const lines = row.render(80).map(plain).map((line: string) => line.trimEnd());
    // One blank separator + one compact line, and no tool output.
    assert.deepEqual(lines, ["", " ▌ ✓ read src/a.ts"]);
    // Render-only: the native definition still owns execution and its renderers.
    assert.equal(definition.renderCall !== undefined, true);
    assert.equal(row.toolDefinition, definition);
  });

  it("compacts a rendererless third-party tool (no definition at all)", async () => {
    const { components } = await loadPi();
    installBridges(state());
    patchToolExecution(components.ToolExecutionComponent.prototype);

    const row = new components.ToolExecutionComponent(
      "goland__execute_tool",
      "call-2",
      { command: "x" },
      {},
      undefined, // late-registered / unknown to the UI lookup
      fakeUi(),
      process.cwd(),
    );
    row.updateResult({ content: [{ type: "text", text: "ide output" }], details: {} });

    const lines = row.render(80).map(plain).map((line: string) => line.trimEnd());
    // Blacklist default: it compacts, and the generic extractor surfaces the
    // most identifying argument so the row beats a bare tool name.
    assert.deepEqual(lines, ["", " ▌ ✓ goland__execute_tool x"]);
    // Pi's verbose card would have dumped the args JSON and the output.
    assert.ok(!lines.join("\n").includes("ide output"));
  });

  it("keeps native rendering ONLY for excluded tools", async () => {
    const { components, withBuiltInRenderers } = await loadPi();
    // Blacklist semantics: exclusion is the only exemption, so it is now
    // explicit configuration rather than the old implicit "has its own
    // renderer?" rule that silently exempted every third-party tool.
    installBridges(state({ excludeTools: ["powershell"] }));
    patchToolExecution(components.ToolExecutionComponent.prototype);

    const row = new components.ToolExecutionComponent(
      "powershell",
      "call-3",
      { command: "Get-Date" },
      {},
      withBuiltInRenderers("powershell", undefined),
      fakeUi(),
      process.cwd(),
    );
    const text = row.render(80).map(plain).join("\n");
    // Native shell renderer prints its prompt prefix; ours never would.
    assert.ok(text.includes("PS>"), text);
    assert.ok(!text.includes("▌ ✓ powershell"), text);
  });

  it("compacts a tool that ships its own renderer when it is not excluded", async () => {
    const { components, withBuiltInRenderers, markdownTheme } = await loadPi();
    installBridges(state({ excludeTools: [] }));
    patchToolExecution(components.ToolExecutionComponent.prototype);
    void markdownTheme;

    const row = new components.ToolExecutionComponent(
      "powershell",
      "call-3b",
      { command: "Get-Date" },
      {},
      withBuiltInRenderers("powershell", undefined),
      fakeUi(),
      process.cwd(),
    );
    const text = row.render(80).map(plain).join("\n");
    assert.ok(text.includes("▌ › powershell Get-Date"), text);
    assert.ok(!text.includes("PS>"), text);
  });

  it("expands a built-in row through its ORIGINAL renderer", async () => {
    const { components, withBuiltInRenderers } = await loadPi();
    installBridges(state());
    patchToolExecution(components.ToolExecutionComponent.prototype);

    const row = new components.ToolExecutionComponent(
      "read",
      "call-4",
      { path: "src/a.ts" },
      {},
      withBuiltInRenderers("read", undefined),
      fakeUi(),
      process.cwd(),
    );
    row.updateResult({
      content: [{ type: "text", text: "hello" }],
      details: { path: "src/a.ts", content: "hello", truncated: false },
    });
    row.setExpanded(true);

    const text = row.render(80).map(plain).join("\n");
    assert.ok(text.includes("✓ read src/a.ts"), text);
    assert.ok(text.includes("hello"), text);
  });

  it("renders zero lines for a quiet-hidden row, spacer included", async () => {
    const { components, withBuiltInRenderers } = await loadPi();
    installBridges(state({ groupToolRuns: true }));
    patchToolExecution(components.ToolExecutionComponent.prototype);

    const rows = ["a", "b"].map((id, index) => {
      const row = new components.ToolExecutionComponent(
        "read",
        id,
        { path: `src/${index}.ts` },
        {},
        withBuiltInRenderers("read", undefined),
        fakeUi(),
        process.cwd(),
      );
      row.updateResult({ content: [{ type: "text", text: "x" }], details: {} });
      return row;
    });
    // Render once so both rows register with quiet mode, then again to fold.
    for (const row of rows) row.render(80);

    assert.deepEqual(rows[0].render(80), [], "hidden row must emit no lines at all");
    const tail = rows[1].render(80).map(plain).map((line: string) => line.trimEnd());
    assert.deepEqual(tail, ["", " ▌ ✓ read ×2"]);
  });

  it("restores exact native thinking rendering and switches existing messages live", async () => {
    const { components, markdownTheme } = await loadPi();
    // Capture the actual native methods BEFORE installing the thinking patch.
    // Compare ANSI output too: off must restore colors, padding and Markdown,
    // not merely remove the gutter from our own renderer.
    const nativeUpdate = components.AssistantMessageComponent.prototype.updateContent;
    const nativeRender = components.AssistantMessageComponent.prototype.render;
    class NativeAssistant extends components.AssistantMessageComponent {
      constructor(...args: any[]) { super(...args); }
      updateContent(message: unknown, streaming = this.isStreaming) {
        nativeUpdate.call(this, message, streaming);
      }
      render(width: number) { return nativeRender.call(this, width); }
    }
    patchAssistantMessage(components.AssistantMessageComponent.prototype);

    for (const initiallyCompact of [false, true]) {
      for (const hidden of [false, true]) {
        for (const streaming of [false, true]) {
          const shared = state({ thinkingAsToolCall: initiallyCompact });
          installBridges(shared);
          const message = assistantMessage([
            { type: "thinking", thinking: "# Heading\n\n**reasoning** with `code`" },
            { type: "text", text: "visible prose" },
            { type: "thinking", thinking: "second thought" },
          ]);
          const args = [message, hidden, markdownTheme, "Native thinking label", 3, []];
          const native = new NativeAssistant(...args);
          const row = new components.AssistantMessageComponent(...args);
          native.updateContent(message, streaming);
          row.updateContent(message, streaming);
          for (const compact of [initiallyCompact, !initiallyCompact, initiallyCompact]) {
            shared.config.set("thinkingAsToolCall", compact);
            for (const width of [32, 100]) {
              const actual = row.render(width);
              if (!compact) {
                assert.deepEqual(actual, native.render(width), `native: hidden=${hidden}, streaming=${streaming}`);
              } else if (hidden) {
                assert.match(actual.map(plain).join("\n"), /▌ [✓•] think/);
                assert.ok(!actual.map(plain).join("\n").includes("Native thinking label"));
              }
            }
          }
          // Click expansion must still work after swapping renderers.
          shared.config.set("thinkingAsToolCall", false);
          row.render(80);
          const region = row.contentContainer.children.find((child: any) => typeof child.onMouse === "function");
          region.onMouse({ type: "click", button: "left" });
          assert.equal(row.thinkingVisibilityOverrides.get(0), !hidden);
          shared.config.set("thinkingAsToolCall", true);
          row.render(80);
          shared.config.set("thinkingAsToolCall", false);
          row.render(80);
          assert.equal(row.thinkingVisibilityOverrides.get(0), !hidden, "live toggles preserve click overrides");
          row.setHideThinkingBlock(false);
          native.setHideThinkingBlock(false);
          assert.deepEqual(row.render(80), native.render(80), "Ctrl+T expansion remains native");
        }
      }
    }
  });

  it("keeps streaming expansion independent from compact thinking", async () => {
    const { components, markdownTheme } = await loadPi();
    installBridges(state({ thinkingAsToolCall: false, keepActiveThinkingExpanded: true }));
    patchAssistantMessage(components.AssistantMessageComponent.prototype);
    const message = assistantMessage([{ type: "thinking", thinking: "full reasoning" }]);
    const row = new components.AssistantMessageComponent(message, true, markdownTheme, "Thinking...", 1, []);
    row.updateContent(message, true);
    const streaming = row.render(80).map(plain).join("\n");
    assert.match(streaming, /full reasoning/);
    assert.doesNotMatch(streaming, /▌|[✓•] think/);
    row.updateContent(message, false);
    const done = row.render(80).map(plain).join("\n");
    assert.match(done, /Thinking\.\.\./);
    assert.doesNotMatch(done, /▌|✓ think|full reasoning/);
    assert.equal(row.hideThinkingBlock, true);
  });

  it("restores native thinking rows and spacers when switching off grouped previews", async () => {
    const { components, markdownTheme } = await loadPi();
    const shared = state({ groupToolRuns: true });
    installBridges(shared);
    patchAssistantMessage(components.AssistantMessageComponent.prototype);
    const rows = ["one", "two"].map((thinking) => new components.AssistantMessageComponent(
      assistantMessage([{ type: "thinking", thinking }]), true, markdownTheme, "Thinking...", 1, [],
    ));
    const render = () => rows.flatMap((row) => row.render(80)).map(plain).map((line: string) => line.trimEnd());
    const native = render();
    assert.deepEqual(native, ["", " Thinking...", "", " Thinking..."]);
    shared.config.set("thinkingAsToolCall", true);
    assert.deepEqual(render(), ["", " ▌ ✓ think ×2"]);
    shared.config.set("thinkingAsToolCall", false);
    assert.deepEqual(render(), native);
  });

  it("lets native thinking host an independently enabled activity summary", async () => {
    const { components, markdownTheme } = await loadPi();
    const shared = state({ foldIntermediateActivity: true, activitySummary: "tools" });
    shared.grouping.agentStarted(0);
    installBridges(shared);
    patchAssistantMessage(components.AssistantMessageComponent.prototype);
    const make = (content: unknown[], reason = "toolUse") => new components.AssistantMessageComponent(
      assistantMessage(content, reason), true, markdownTheme, "Thinking...", 1, [],
    );
    const progress = make([{ type: "text", text: "progress" }]);
    const thinking = make([{ type: "thinking", thinking: "reasoning" }]);
    const final = make([{ type: "text", text: "final" }], "stop");
    for (const compact of [false, true, false]) {
      shared.config.set("thinkingAsToolCall", compact);
      assert.deepEqual(progress.render(80), []);
      assert.deepEqual(thinking.render(80).map(plain).map((line: string) => line.trimEnd()), ["", " ▌ ✓ think ×1"]);
      assert.match(final.render(80).map(plain).join("\n"), /final/);
    }
    shared.config.set("foldIntermediateActivity", false);
    assert.match(progress.render(80).map(plain).join("\n"), /progress/);
    assert.deepEqual(thinking.render(80).map(plain).map((line: string) => line.trimEnd()), ["", " Thinking..."]);
  });

  it("shows a compact preview instead of the bare Thinking... label", async () => {
    const { components, markdownTheme } = await loadPi();
    installBridges(state({ thinkingAsToolCall: true }));
    patchAssistantMessage(components.AssistantMessageComponent.prototype);

    const message = assistantMessage([{ type: "thinking", thinking: "The user wants a preview" }]);
    const component = new components.AssistantMessageComponent(
      message,
      true, // hideThinkingBlock
      markdownTheme,
      "Thinking...",
      1,
      [],
    );

    const text = component.render(80).map(plain).join("\n");
    assert.ok(text.includes("✓ think The user wants a preview"), text);
    assert.ok(!text.includes("Thinking..."), text);
  });

  it("keeps a STREAMING compact thinking block collapsed by default", async () => {
    const { components, markdownTheme } = await loadPi();
    installBridges(state({ thinkingAsToolCall: true }));
    patchAssistantMessage(components.AssistantMessageComponent.prototype);

    const message = assistantMessage([{ type: "thinking", thinking: "partial reasoning" }]);
    const component = new components.AssistantMessageComponent(message, true, markdownTheme, "Thinking...", 1, []);

    component.updateContent(message, true);
    const streaming = component.render(80).map(plain).join("\n");
    // The compact preview already shows the newest text, so the default no
    // longer force-expands a streaming block (it used to, before the setting
    // existed). The running glyph marks it as still going.
    assert.ok(streaming.includes("• think partial reasoning"), streaming);

    component.updateContent(message, false);
    const done = component.render(80).map(plain).join("\n");
    assert.ok(done.includes("✓ think partial reasoning"), done);
    assert.equal(component.hideThinkingBlock, true);
  });

  it("expands a STREAMING thinking block when configured, restoring the override after", async () => {
    const { components, markdownTheme } = await loadPi();
    installBridges(state({ thinkingAsToolCall: true, keepActiveThinkingExpanded: true }));
    patchAssistantMessage(components.AssistantMessageComponent.prototype);

    const message = assistantMessage([{ type: "thinking", thinking: "partial reasoning" }]);
    const component = new components.AssistantMessageComponent(message, true, markdownTheme, "Thinking...", 1, []);

    component.updateContent(message, true);
    const streaming = component.render(80).map(plain).join("\n");
    assert.ok(streaming.includes("partial reasoning"), streaming);
    assert.ok(!streaming.includes("think partial reasoning"), "configured streaming must not collapse");

    component.updateContent(message, false);
    const done = component.render(80).map(plain).join("\n");
    assert.ok(done.includes("✓ think partial reasoning"), done);
    // The user's own hide setting survived the temporary streaming override.
    assert.equal(component.hideThinkingBlock, true);
  });

  it("recolors expanded thinking to a single purple hue when compact thinking is enabled", async () => {
    const { components, markdownTheme } = await loadPi();
    installBridges(state({ thinkingAsToolCall: true }));
    patchAssistantMessage(components.AssistantMessageComponent.prototype);

    const message = assistantMessage([{ type: "thinking", thinking: "# Heading\n\nplain text" }]);
    const component = new components.AssistantMessageComponent(
      message,
      false, // expanded
      markdownTheme,
      "Thinking...",
      1,
      [],
    );

    const colors = (lines: string[]) =>
      new Set(lines.flatMap((line) => [...line.matchAll(/\x1b\[[0-9;]*m/g)].map((match) => match[0])));
    const rendered = component.render(80);
    const heading = rendered.find((line: string) => plain(line).includes("Heading")) ?? "";
    const body = rendered.find((line: string) => plain(line).includes("plain text")) ?? "";
    // The all-purple theme means the heading carries no color the body lacks.
    const extra = [...colors([heading])].filter((code) => !colors([body]).has(code) && code !== "\x1b[1m");
    assert.deepEqual(extra, [], `heading kept token colors: ${JSON.stringify(heading)}`);
  });

  it("keeps thinking and prose in transcript order for quiet folding", async () => {
    const { components, markdownTheme } = await loadPi();
    installBridges(state({ groupToolRuns: true, thinkingAsToolCall: true }));
    patchAssistantMessage(components.AssistantMessageComponent.prototype);

    const message = assistantMessage([
      { type: "thinking", thinking: "first" },
      { type: "text", text: "visible prose" },
      { type: "thinking", thinking: "second" },
    ]);
    const component = new components.AssistantMessageComponent(message, true, markdownTheme, "Thinking...", 1, []);
    component.render(80);

    // Prose between two thinking runs must break the run, so neither folds away.
    const text = component.render(80).map(plain).join("\n");
    assert.ok(text.includes("think first"), text);
    assert.ok(text.includes("visible prose"), text);
    assert.ok(text.includes("think second"), text);
  });

  it("folds commentary as soon as OpenAI's final answer starts streaming", async () => {
    const { components, markdownTheme } = await loadPi();
    const shared = state({ foldIntermediateActivity: true, foldActivityOnFinalAnswer: true });
    shared.grouping.agentStarted(0);
    installBridges(shared);
    patchAssistantMessage(components.AssistantMessageComponent.prototype);

    const prose = (text: string, phase: "commentary" | "final_answer", stopReason: string, lead: unknown[] = []) =>
      new components.AssistantMessageComponent(
        assistantMessage([...lead, { type: "text", text, textSignature: JSON.stringify({ v: 1, phase }) }], stopReason),
        true,
        markdownTheme,
        "Thinking...",
        1,
        [],
      );
    // A thinking block is activity; a cycle of prose alone is never folded.
    const first = prose("first progress note", "commentary", "toolUse", [{ type: "thinking", thinking: "thought" }]);
    const second = prose("second progress note", "commentary", "toolUse");
    assert.ok(first.render(80).map(plain).join("\n").includes("first progress note"));
    assert.ok(second.render(80).map(plain).join("\n").includes("second progress note"));

    // Pi sets stopReason=stop on response.output_item.added, before the first
    // final-answer text delta. A non-empty first delta is enough to create the
    // Markdown child and fold every earlier prose component on the same repaint.
    const finalMessage = assistantMessage([{ type: "text", text: "final answer starts" }], "stop");
    const final = new components.AssistantMessageComponent(finalMessage, true, markdownTheme, "Thinking...", 1, []);
    final.updateContent(finalMessage, true);

    assert.deepEqual(first.render(80), []);
    const proseSummary = second.render(80).map(plain).map((line: string) => line.trimEnd());
    assert.equal(proseSummary.length, 2, `summary must have exactly one leading spacer: ${proseSummary}`);
    assert.equal(proseSummary[0], "");
    assert.match(proseSummary[1], /Worked for/);

    const combined = [first, second, final].flatMap((item) => item.render(80)).map(plain).join("\n");
    assert.ok(!combined.includes("first progress note"), combined);
    assert.ok(!combined.includes("second progress note"), combined);
    assert.ok(combined.includes("Worked for"), combined);
    assert.ok(combined.includes("final answer starts"), combined);
  });

  it("keeps exactly one blank separator before a tool-hosted activity summary", async () => {
    const { components, markdownTheme, withBuiltInRenderers } = await loadPi();
    const shared = state({ foldIntermediateActivity: true, activitySummary: "tools" });
    shared.grouping.agentStarted(0);
    installBridges(shared);
    patchAssistantMessage(components.AssistantMessageComponent.prototype);
    patchToolExecution(components.ToolExecutionComponent.prototype);

    const commentary = assistantMessage([{ type: "text", text: "progress" }], "toolUse");
    const prose = new components.AssistantMessageComponent(commentary, true, markdownTheme, "Thinking...", 1, []);
    const tool = new components.ToolExecutionComponent(
      "read",
      "summary-anchor",
      { path: "a.ts" },
      {},
      withBuiltInRenderers("read", undefined),
      fakeUi(),
      process.cwd(),
    );
    tool.updateResult({ content: [{ type: "text", text: "ok" }], details: {} });
    tool.render(80); // register before the final prose arrives

    const finalMessage = assistantMessage([{ type: "text", text: "final" }], "stop");
    const final = new components.AssistantMessageComponent(finalMessage, true, markdownTheme, "Thinking...", 1, []);
    final.updateContent(finalMessage, true);

    assert.deepEqual(prose.render(80), []);
    const summary = tool.render(80).map(plain).map((line: string) => line.trimEnd());
    assert.deepEqual(summary, ["", " ▌ ✓ read ×1"], "summary must have exactly one blank separator");
  });

  it("removes interstitial spacers left by fully hidden mixed assistant messages", async () => {
    const { components, markdownTheme, withBuiltInRenderers } = await loadPi();
    const shared = state({ foldIntermediateActivity: true, activitySummary: "tools" });
    shared.grouping.agentStarted(0);
    installBridges(shared);
    patchAssistantMessage(components.AssistantMessageComponent.prototype);
    patchToolExecution(components.ToolExecutionComponent.prototype);

    const mixed = (thinking: string, text: string) =>
      new components.AssistantMessageComponent(
        assistantMessage([{ type: "thinking", thinking }, { type: "text", text }], "toolUse"),
        true,
        markdownTheme,
        "Thinking...",
        1,
        [],
      );
    const hidden = [mixed("thought one", "progress one"), mixed("thought two", "progress two")];
    const tool = new components.ToolExecutionComponent(
      "read",
      "mixed-summary-anchor",
      { path: "a.ts" },
      {},
      withBuiltInRenderers("read", undefined),
      fakeUi(),
      process.cwd(),
    );
    tool.updateResult({ content: [{ type: "text", text: "ok" }], details: {} });
    tool.render(80);
    const finalMessage = assistantMessage([{ type: "text", text: "final" }], "stop");
    const final = new components.AssistantMessageComponent(finalMessage, true, markdownTheme, "Thinking...", 1, []);
    final.updateContent(finalMessage, true);

    for (const row of hidden) assert.deepEqual(row.render(80), [], "hidden message must not retain an inner spacer");
    assert.deepEqual(
      tool.render(80).map(plain).map((line: string) => line.trimEnd()),
      ["", " ▌ ✓ think ×2, read ×1"],
    );
  });

  it("preserves each historical interaction's final prose during session replay", async () => {
    const { components, markdownTheme } = await loadPi();
    installBridges(state({ foldIntermediateActivity: true }));
    patchAssistantMessage(components.AssistantMessageComponent.prototype);

    const prose = (text: string, phase: "commentary" | "final_answer", stopReason: string, lead: unknown[] = []) =>
      new components.AssistantMessageComponent(
        assistantMessage([...lead, { type: "text", text, textSignature: JSON.stringify({ v: 1, phase }) }], stopReason),
        true,
        markdownTheme,
        "Thinking...",
        1,
        [],
      );
    const thought = [{ type: "thinking", thinking: "thought" }];
    // No agentStarted(): replay only emits finalized historical messages.
    const rows = [
      prose("old progress one", "commentary", "toolUse", thought),
      prose("FINAL ONE", "final_answer", "stop"),
      prose("old progress two", "commentary", "toolUse", thought),
      prose("FINAL TWO", "final_answer", "stop"),
    ];
    const text = rows.flatMap((row) => row.render(80)).map(plain).join("\n");

    assert.ok(!text.includes("old progress one"), text);
    assert.ok(!text.includes("old progress two"), text);
    assert.ok(text.includes("FINAL ONE"), text);
    assert.ok(text.includes("FINAL TWO"), text);
    assert.equal(text.match(/Worked for/g)?.length, 2, text);
  });

  for (const activitySummary of ["elapsed", "tools"] as const) {
    it(`leaves a prose-only cycle fully visible with normal spacing (${activitySummary})`, async () => {
      const { components, markdownTheme } = await loadPi();
      const shared = state({ foldIntermediateActivity: true, activitySummary });
      shared.grouping.agentStarted(0);
      installBridges(shared);
      patchAssistantMessage(components.AssistantMessageComponent.prototype);

      const prose = (text: string, stopReason: string) =>
        new components.AssistantMessageComponent(
          assistantMessage([{ type: "text", text }], stopReason), true, markdownTheme, "Thinking...", 1, [],
        );
      const rows = [prose("note one", "stop"), prose("note two", "stop"), prose("note three", "stop")];
      const lines = rows.map((row) => row.render(80).map(plain).map((line: string) => line.trimEnd()));

      assert.deepEqual(lines, [["", " note one"], ["", " note two"], ["", " note three"]]);
      assert.ok(!lines.flat().join("\n").includes("Worked for"));
    });
  }

  it("still folds a mixed cycle, and keeps an earlier prose-only interaction open during replay", async () => {
    const { components, markdownTheme } = await loadPi();
    installBridges(state({ foldIntermediateActivity: true }));
    patchAssistantMessage(components.AssistantMessageComponent.prototype);

    const prose = (text: string, phase: "commentary" | "final_answer", stopReason: string, lead: unknown[] = []) =>
      new components.AssistantMessageComponent(
        assistantMessage([...lead, { type: "text", text, textSignature: JSON.stringify({ v: 1, phase }) }], stopReason),
        true,
        markdownTheme,
        "Thinking...",
        1,
        [],
      );
    // No agentStarted(): replay. Interaction one is prose only; interaction two has thinking.
    const rows = [
      prose("quiet one", "commentary", "toolUse"),
      prose("FINAL ONE", "final_answer", "stop"),
      prose("busy two", "commentary", "toolUse", [{ type: "thinking", thinking: "thought" }]),
      prose("FINAL TWO", "final_answer", "stop"),
    ];
    const text = rows.flatMap((row) => row.render(80)).map(plain).join("\n");

    assert.ok(text.includes("quiet one"), text);
    assert.ok(text.includes("FINAL ONE"), text);
    assert.ok(!text.includes("busy two"), text);
    assert.ok(text.includes("FINAL TWO"), text);
    assert.equal(text.match(/Worked for/g)?.length, 1, text);
  });

  it("folds thinking together with adjacent tool rows under /quiet", async () => {
    // REGRESSION: decorateThinking passed `!hidden` to the quietThinking bridge,
    // which negates it into `expanded` itself. The double negation made COLLAPSED
    // thinking non-foldable, so every thinking row split the run in two and a
    // transcript rendered as "think / read ×2 / think / bash" instead of one
    // summary. Expanded thinking got the mirror-image bug: it became foldable and
    // swallowed whole runs of visible tool rows into a single summary line.
    const { components, markdownTheme, withBuiltInRenderers } = await loadPi();
    installBridges(state({ groupToolRuns: true, thinkingAsToolCall: true }));
    patchToolExecution(components.ToolExecutionComponent.prototype);
    patchAssistantMessage(components.AssistantMessageComponent.prototype);

    const thinkingMessage = (text: string) =>
      new components.AssistantMessageComponent(
        assistantMessage([{ type: "thinking", thinking: text }, { type: "toolCall" }]),
        true, // collapsed
        markdownTheme,
        "Thinking...",
        1,
        [],
      );
    const toolRow = (name: string, id: string, args: object) => {
      const row = new components.ToolExecutionComponent(
        name,
        id,
        args,
        {},
        withBuiltInRenderers(name, undefined),
        fakeUi(),
        process.cwd(),
      );
      row.updateResult({ content: [{ type: "text", text: "out" }], details: {} });
      return row;
    };

    const rows = [
      thinkingMessage("first thought"),
      toolRow("read", "r1", { path: "a.ts" }),
      toolRow("read", "r2", { path: "b.ts" }),
      thinkingMessage("second thought"),
      toolRow("bash", "b1", { command: "ls" }),
    ];
    // First pass registers every row with quiet mode; second folds the run.
    for (const row of rows) row.render(80);
    const visible = rows
      .flatMap((row) => row.render(80))
      .map(plain)
      .map((line: string) => line.trimEnd())
      .filter((line: string) => line !== "");

    assert.deepEqual(visible, [" ▌ ✓ think ×2, read ×2, bash ×1"]);
  });

  describe("a folded run never jumps over something visible", () => {
    async function chronology(setup: (grouping: RunGrouping) => void, between: "subagent" | "user" | "cycle") {
      const { components, markdownTheme, withBuiltInRenderers } = await loadPi();
      const shared = state({ groupToolRuns: true, thinkingAsToolCall: true, excludeTools: ["subagent"] });
      installBridges(shared);
      patchToolExecution(components.ToolExecutionComponent.prototype);
      patchAssistantMessage(components.AssistantMessageComponent.prototype);
      patchUserMessage(components.UserMessageComponent.prototype);
      const think = (text: string) =>
        new components.AssistantMessageComponent(
          assistantMessage([{ type: "thinking", thinking: text }, { type: "toolCall" }]),
          true, markdownTheme, "Thinking...", 1, [],
        );
      const items: any[] = [think("A")];
      if (between === "subagent") {
        const card = new components.ToolExecutionComponent(
          "subagent", "sub-1", { task: "x" }, {}, undefined, fakeUi(), process.cwd(),
        );
        card.updateResult({ content: [{ type: "text", text: "card body" }], details: {} });
        items.push(card);
      } else if (between === "user") {
        items.push(new components.UserMessageComponent("a user prompt", markdownTheme));
      } else {
        setup(shared.grouping);
      }
      items.push(think("B"));
      for (const item of items) item.render(80);
      return items
        .flatMap((item) => item.render(80))
        .map(plain)
        .map((line: string) => line.trimEnd())
        .filter((line: string) => line !== "");
    }

    it("does not fold across an excluded tool card, and keeps the order", async () => {
      const lines = await chronology(() => {}, "subagent");
      assert.ok(!lines.some((l: string) => l.includes("×2")), lines.join("\n"));
      const marks = lines.map((l: string, i: number) => (l.includes("✓ think") ? "think" : l.includes("card body") || l.includes("subagent") ? "card" : "")).filter(Boolean);
      assert.deepEqual(marks.filter((m: string, i: number, a: string[]) => m !== a[i - 1]), ["think", "card", "think"], lines.join("\n"));
    });

    it("does not fold across a user message", async () => {
      const lines = await chronology(() => {}, "user");
      assert.ok(!lines.some((l: string) => l.includes("×2")), lines.join("\n"));
      assert.equal(lines.filter((l: string) => l.includes("✓ think")).length, 2, lines.join("\n"));
    });

    it("does not fold across an agent cycle boundary", async () => {
      const lines = await chronology((grouping) => { grouping.agentStarted(); grouping.agentSettled(); grouping.agentStarted(); }, "cycle");
      assert.ok(!lines.some((l: string) => l.includes("×2")), lines.join("\n"));
    });
  });

  /** A chat like Pi's, built from messages. Calling it again is a REBUILD: new components, same data. */
  async function transcriptOf(messages: any[], tools: string[]) {
    const { components, markdownTheme, withBuiltInRenderers } = await loadPi();
    return () => {
      const items: unknown[] = [];
      messages.forEach((message, index) => {
        items.push(new components.AssistantMessageComponent(message, true, markdownTheme, "Thinking...", 1, []));
        if (!tools[index]) return;
        const row = new components.ToolExecutionComponent(
          "read", tools[index], { path: `${tools[index]}.ts` }, {}, withBuiltInRenderers("read", undefined), fakeUi(),
          process.cwd(),
        );
        row.updateResult({ content: [{ type: "text", text: "out" }], details: {} });
        items.push(row);
      });
      return chatOf(...items);
    };
  }

  it("keeps the run count right when Pi rebuilds the chat from its messages", async () => {
    // REGRESSION: thinking ids came from the component instance. Pi builds NEW
    // components on every rebuild (Ctrl+T, tree navigation...), so the dropped
    // components left ghost thinking entries that were counted in the summary.
    const { components } = await loadPi();
    installBridges(state({ groupToolRuns: true, thinkingAsToolCall: true }));
    patchToolExecution(components.ToolExecutionComponent.prototype);
    patchAssistantMessage(components.AssistantMessageComponent.prototype);
    const messages = [1, 2, 3].map((n) => ({
      ...assistantMessage([{ type: "thinking", thinking: `thought ${n}` }, { type: "toolCall" }]),
      timestamp: 1000 + n,
    }));
    const build = await transcriptOf(messages, ["r1", "r2"]);
    const shown = (chat: ReturnType<typeof chatOf>) => {
      chat.lines();
      return chat.lines().filter(Boolean);
    };

    assert.deepEqual(shown(build()), [" ▌ ✓ think ×3, read ×2"]);
    assert.deepEqual(shown(build()), [" ▌ ✓ think ×3, read ×2"], "after one rebuild");
    const third = build();
    assert.deepEqual(shown(third), [" ▌ ✓ think ×3, read ×2"], "after two rebuilds");
  });

  it("does not append a new barrier for the same user message on every rebuild", async () => {
    // REGRESSION: barrier ids came from a per-component counter. Every chat rebuild
    // appended fresh barriers at the END, which cut rows added later into a second summary.
    const { components, markdownTheme, withBuiltInRenderers } = await loadPi();
    const shared = state({ groupToolRuns: true, thinkingAsToolCall: true });
    installBridges(shared);
    patchToolExecution(components.ToolExecutionComponent.prototype);
    patchAssistantMessage(components.AssistantMessageComponent.prototype);
    patchUserMessage(components.UserMessageComponent.prototype);
    const turn = (n: number) => {
      const message = {
        ...assistantMessage([{ type: "thinking", thinking: `thought ${n}` }, { type: "toolCall" }]),
        timestamp: 4000 + n,
      };
      const row = new components.ToolExecutionComponent(
        "read", `u${n}`, { path: `${n}.ts` }, {}, withBuiltInRenderers("read", undefined), fakeUi(), process.cwd(),
      );
      row.updateResult({ content: [{ type: "text", text: "out" }], details: {} });
      return [new components.AssistantMessageComponent(message, true, markdownTheme, "Thinking...", 1, []), row];
    };
    const build = (turns: number[]) =>
      chatOf(new components.UserMessageComponent("same prompt", markdownTheme), ...turns.flatMap(turn));
    const shown = (chat: ReturnType<typeof chatOf>) => {
      chat.lines();
      return chat.lines().filter(Boolean).filter((line: string) => !line.includes("same prompt"));
    };

    shown(build([1]));
    shown(build([1]));
    const entries = (shared.grouping as any).entries.length;
    // The third build is a rebuild that also adds a row: it must join the same run.
    assert.deepEqual(shown(build([1, 2])), [" ▌ ✓ read ×2, think ×2"]);
    assert.equal((shared.grouping as any).entries.length, entries + 2, "one user barrier, not one per rebuild");
  });

  it("does not count an empty thinking block, before or after a rebuild", async () => {
    // Pi draws nothing for a thinking block with no text, so it must not be counted.
    const { components } = await loadPi();
    installBridges(state({ groupToolRuns: true, thinkingAsToolCall: true }));
    patchToolExecution(components.ToolExecutionComponent.prototype);
    patchAssistantMessage(components.AssistantMessageComponent.prototype);
    const messages = [
      { ...assistantMessage([{ type: "thinking", thinking: "  " }, { type: "toolCall" }]), timestamp: 2001 },
      { ...assistantMessage([{ type: "thinking", thinking: "" }, { type: "thinking", thinking: "real" }, { type: "toolCall" }]), timestamp: 2002 },
    ];
    const build = await transcriptOf(messages, ["e1", "e2"]);
    for (const pass of ["first build", "rebuild"]) {
      const chat = build();
      chat.lines();
      assert.deepEqual(chat.lines().filter(Boolean), [" ▌ ✓ read ×2, think ×1"], pass);
    }
  });

  it("keeps rebuilt prose and an opened run on the same entries", async () => {
    const { components } = await loadPi();
    const shared = state({ foldIntermediateActivity: true });
    installBridges(shared);
    patchToolExecution(components.ToolExecutionComponent.prototype);
    patchAssistantMessage(components.AssistantMessageComponent.prototype);
    const messages = [
      { ...assistantMessage([{ type: "thinking", thinking: "plan" }, { type: "text", text: "first" }, { type: "toolCall" }], "toolUse"), timestamp: 3001 },
      { ...assistantMessage([{ type: "text", text: "final answer" }]), timestamp: 3002 },
    ];
    const build = await transcriptOf(messages, ["p1"]);
    const first = build();
    first.lines();
    const before = first.lines().filter(Boolean);
    const second = build();
    second.lines();
    assert.deepEqual(second.lines().filter(Boolean), before);
    assert.ok(before.some((line) => line.includes("final answer")));
  });

  it("opens a clicked run summary instead of expanding only its last row", async () => {
    // REGRESSION: the summary is drawn by the run's LAST row and the others draw
    // zero lines, so Pi's MouseRegion click expanded only that last tool.
    const { components, withBuiltInRenderers } = await loadPi();
    installBridges(state({ groupToolRuns: true }));
    patchToolExecution(components.ToolExecutionComponent.prototype);

    const rows = ["a.ts", "b.ts"].map((path, index) => {
      const row = new components.ToolExecutionComponent(
        "read", `click-${index}`, { path }, {}, withBuiltInRenderers("read", undefined), fakeUi(), process.cwd(),
      );
      row.updateResult({ content: [{ type: "text", text: "out" }], details: {} });
      return row;
    });
    const visible = () =>
      rows.flatMap((row) => row.render(80)).map(plain).map((line: string) => line.trimEnd()).filter(Boolean);
    visible(); // first pass registers both rows
    assert.deepEqual(visible(), [" ▌ ✓ read ×2"]);

    const at = (y: number, height: number) =>
      ({ type: "click", button: "left", x: 5, y, screenX: 5, screenY: y, width: 80, height }) as const;
    assert.equal(rows[1].handleMouse(at(1, 2))?.handled, true);
    assert.equal(rows[1].expanded, false, "the click must not reach Pi's expand toggle");
    // The opened run keeps a header above its first row: spacer, header, ONE blank, row.
    const header = "   ▾ Expanded · click to fold"; // blank padding, no gutter bar
    assert.deepEqual(visible(), [header, " ▌ ✓ read a.ts", " ▌ ✓ read b.ts"]);
    assert.deepEqual(rows[0].render(80).map(plain).map((line: string) => line.trimEnd()), ["", header, "", " ▌ ✓ read a.ts"]);
    assert.deepEqual(rows[1].render(80).map(plain).map((line: string) => line.trimEnd()), ["", " ▌ ✓ read b.ts"]);

    // The blank line below the header is not ours: Pi's own click applies, and
    // it expands the row (y=2 is the blank, below the spacer at 0 and the header at 1).
    rows[0].handleMouse(at(2, 4));
    assert.equal(rows[0].expanded, true, "Pi's own toggle took the blank-line click");
    assert.equal(visible()[0], header, "...and the run did not fold back");
    rows[0].handleMouse(at(2, 4)); // collapse it again
    assert.equal(rows[0].expanded, false);
    // A member row keeps Pi's own click: expand exactly the one clicked (y=3 is row a).
    rows[0].handleMouse(at(3, 4));
    assert.equal(rows[0].expanded, true, "Pi expands the clicked member");
    assert.equal(rows[1].expanded, false);
    rows[0].handleMouse(at(3, 4)); // collapse it again
    assert.equal(rows[0].expanded, false);
    visible();

    // The header is the first line of OUR component, whatever sits above it:
    // clicking it (y=1 here, after the spacer) folds the run back.
    assert.equal(rows[0].handleMouse(at(1, 4))?.handled, true);
    assert.deepEqual(visible(), [" ▌ ✓ read ×2"]);
    // ...and the folded summary opens again.
    assert.equal(rows[1].handleMouse(at(1, 2))?.handled, true);
    assert.deepEqual(visible(), [header, " ▌ ✓ read a.ts", " ▌ ✓ read b.ts"]);
  });

  /**
   * A transcript container like Pi's chat: its Container.handleMouse walks the
   * REAL mouse layout recorded by render(), so `y` is verified end to end
   * (chat -> AssistantMessage -> contentContainer -> host), not computed by hand.
   */
  function chatOf(...items: unknown[]) {
    const chat = new Container();
    for (const item of items) chat.addChild(item as never);
    const lines = () => chat.render(80).map(plain).map((line: string) => line.trimEnd());
    const click = (y: number) =>
      chat.handleMouse({
        type: "click", button: "left", x: 5, y, screenX: 5, screenY: y, width: 80, height: chat.render(80).length,
      } as never) as { handled?: boolean } | undefined;
    return { lines, click };
  }

  it("opens a prose-hosted 'Worked for' summary by click, and folds it back by its header", async () => {
    const { components, markdownTheme } = await loadPi();
    const shared = state({ foldIntermediateActivity: true });
    shared.grouping.agentStarted(0);
    installBridges(shared);
    patchAssistantMessage(components.AssistantMessageComponent.prototype);

    const prose = (text: string, stopReason: string, lead: unknown[] = []) =>
      new components.AssistantMessageComponent(
        assistantMessage([...lead, { type: "text", text }], stopReason), true, markdownTheme, "Thinking...", 1, [],
      );
    const first = prose("first note", "toolUse", [{ type: "thinking", thinking: "thought" }]);
    const second = prose("second note", "toolUse");
    const final = prose("final answer", "stop");
    const chat = chatOf(first, second, final);

    chat.lines(); // first pass registers every message
    const folded = chat.lines();
    assert.equal(folded.length, 4, folded.join("\n"));
    assert.deepEqual(folded.slice(0, 1), [""]);
    assert.match(folded[1], /▌ Worked for/);
    assert.deepEqual(folded.slice(2), ["", " final answer"]);

    // The summary is the second message's only line (row 1); row 0 is its blank.
    assert.equal(chat.click(1)?.handled, true, "clicking the summary opens the run");
    const opened = chat.lines();
    assert.equal(opened[0], "");
    assert.match(opened[1], /^ {3}▾ Expanded · click to fold/);
    assert.equal(opened[2], "", "exactly one blank line between header and the first prose");
    assert.match(opened[3], /Thinking\.\.\./); // the lead message starts with native thinking
    assert.ok(opened.join("\n").includes("first note"), opened.join("\n"));
    assert.ok(opened.join("\n").includes("second note"), opened.join("\n"));
    assert.ok(!opened.join("\n").includes("▌ Worked for"), "no second summary");

    // Body text is not clickable: it must neither be handled nor change the fold.
    assert.equal(chat.click(opened.findIndex((line: string) => line.includes("first note"))), undefined);
    assert.equal(chat.click(opened.findIndex((line: string) => line.includes("second note"))), undefined);
    assert.deepEqual(chat.lines(), opened);

    // The blank line under the header is not ours: the click goes to Pi's own
    // thinking toggle (this message starts with thinking) and the run stays open.
    chat.click(2);
    assert.match(chat.lines()[1], /^ {3}▾ Expanded · click to fold/);
    chat.click(2); // toggle the thinking back
    assert.deepEqual(chat.lines(), opened);

    // The header is the first line of its host, whatever sits above it.
    assert.equal(chat.click(1)?.handled, true, "clicking the header folds the run back");
    assert.deepEqual(chat.lines(), folded);
    assert.equal(chat.click(1)?.handled, true, "the summary opens again");
    assert.deepEqual(chat.lines(), opened);
  });

  it("opens a summary hosted by native (non-compact) thinking, and leaves its own toggle alone", async () => {
    const { components, markdownTheme } = await loadPi();
    const shared = state({ foldIntermediateActivity: true, thinkingAsToolCall: false });
    shared.grouping.agentStarted(0);
    installBridges(shared);
    patchAssistantMessage(components.AssistantMessageComponent.prototype);

    const message = (content: unknown[], stopReason: string) =>
      new components.AssistantMessageComponent(assistantMessage(content, stopReason), true, markdownTheme, "Thinking...", 1, []);
    const lead = message([{ type: "text", text: "lead note" }], "toolUse");
    const thinking = message([{ type: "thinking", thinking: "ponder" }, { type: "toolCall" }], "toolUse");
    const final = message([{ type: "text", text: "final answer" }], "stop");
    const chat = chatOf(lead, thinking, final);

    chat.lines();
    const folded = chat.lines();
    assert.match(folded.join("\n"), /Worked for/);
    const row = folded.findIndex((line: string) => line.includes("Worked for"));

    assert.equal(chat.click(row)?.handled, true, "the native-thinking host takes the click");
    const opened = chat.lines();
    assert.match(opened.join("\n"), / {3}▾ Expanded · click to fold\n\n lead note/);
    assert.ok(opened.join("\n").includes("lead note"), opened.join("\n"));
    assert.ok(opened.join("\n").includes("Thinking..."), opened.join("\n"));

    // Below the header, a click on the native thinking row is still Pi's own toggle.
    const label = opened.findIndex((line: string) => line.includes("Thinking..."));
    assert.equal(chat.click(label)?.handled, true);
    assert.ok(chat.lines().join("\n").includes("ponder"), "Pi's thinking toggle expanded it");

    const header = chat.lines().findIndex((line: string) => line.includes("▾ Expanded"));
    assert.equal(chat.click(header)?.handled, true, "the header folds the run back");
    assert.match(chat.lines().join("\n"), /▌ Worked for/);
  });

  it("keeps an opened run's header above a compact thinking head, collapsed or Ctrl+T-expanded", async () => {
    const { components, markdownTheme } = await loadPi();
    const shared = state({ foldIntermediateActivity: true, thinkingAsToolCall: true });
    shared.grouping.agentStarted(0);
    installBridges(shared);
    patchAssistantMessage(components.AssistantMessageComponent.prototype);

    const message = (content: unknown[], stopReason: string) =>
      new components.AssistantMessageComponent(assistantMessage(content, stopReason), true, markdownTheme, "Thinking...", 1, []);
    const thinking = message([{ type: "thinking", thinking: "ponder deeply" }], "toolUse");
    const second = message([{ type: "text", text: "second note" }], "toolUse");
    const final = message([{ type: "text", text: "final answer" }], "stop");
    const chat = chatOf(thinking, second, final);

    chat.lines();
    const folded = chat.lines();
    const row = folded.findIndex((line: string) => line.includes("Worked for"));
    assert.equal(chat.click(row)?.handled, true, "the summary opens the run");

    const order = (lines: string[]) => lines.filter((line) => /Expanded|think|ponder|second note/.test(line));
    const opened = chat.lines();
    assert.match(order(opened)[0], /▾ Expanded/);
    assert.match(order(opened)[1], /think/);
    assert.equal(opened[opened.findIndex((l: string) => l.includes("▾ Expanded")) + 1], "", "one blank under the header");

    // Ctrl+T on the thinking row (Pi's own toggle, below the header line).
    const toggle = opened.findIndex((line: string) => line.includes("think"));
    assert.equal(chat.click(toggle)?.handled, true, "Pi toggles the thinking row");
    const expanded = chat.lines();
    const seq = order(expanded);
    assert.match(seq[0], /▾ Expanded/, expanded.join("\n"));
    assert.match(seq[1], /ponder deeply/, expanded.join("\n"));
    assert.match(seq[2], /second note/);
    assert.equal(expanded.filter((line: string) => line.includes("▾ Expanded")).length, 1);

    // A click on the expanded text is not ours: Pi collapses it again, header stays on top.
    const text = expanded.findIndex((line: string) => line.includes("ponder deeply"));
    assert.equal(chat.click(text)?.handled, true);
    const back = order(chat.lines());
    assert.match(back[0], /▾ Expanded/);
    assert.match(back[1], /think/);

    // Expand again, then the header folds the whole run back.
    chat.click(chat.lines().findIndex((line: string) => line.includes("think")));
    const header = chat.lines().findIndex((line: string) => line.includes("▾ Expanded"));
    assert.equal(chat.click(header)?.handled, true, "the header folds the run back");
    assert.match(chat.lines().join("\n"), /▌ Worked for/);
  });

  it("lets EXPANDED thinking break a quiet run instead of folding it", async () => {
    // The other half of the same inversion: expanded thinking must stay visible
    // and act as a run boundary, never fold neighbouring tool rows away.
    const { components, markdownTheme, withBuiltInRenderers } = await loadPi();
    installBridges(state({ groupToolRuns: true, thinkingAsToolCall: true }));
    patchToolExecution(components.ToolExecutionComponent.prototype);
    patchAssistantMessage(components.AssistantMessageComponent.prototype);

    const expandedThinking = new components.AssistantMessageComponent(
      assistantMessage([{ type: "thinking", thinking: "visible reasoning" }, { type: "toolCall" }]),
      false, // expanded
      markdownTheme,
      "Thinking...",
      1,
      [],
    );
    const row = new components.ToolExecutionComponent(
      "read",
      "solo",
      { path: "a.ts" },
      {},
      withBuiltInRenderers("read", undefined),
      fakeUi(),
      process.cwd(),
    );
    row.updateResult({ content: [{ type: "text", text: "out" }], details: {} });

    for (const item of [expandedThinking, row]) item.render(80);
    const text = [expandedThinking, row].flatMap((item) => item.render(80)).map(plain).join("\n");

    assert.ok(text.includes("visible reasoning"), text);
    // A lone foldable row is left alone, and thinking was never counted into it.
    assert.ok(text.includes("✓ read a.ts"), text);
    assert.ok(!text.includes("think ×1"), `expanded thinking must not fold: ${text}`);
  });

  it("switches an existing built-in row between compact and native shells in both directions", async () => {
    const { components, withBuiltInRenderers } = await loadPi();
    const shared = state();
    installBridges(shared);
    patchToolExecution(components.ToolExecutionComponent.prototype);
    const definition = withBuiltInRenderers("read", undefined);
    const makeRow = (id: string) => {
      const row = new components.ToolExecutionComponent(
        "read", id, { path: "src/a.ts" }, {}, definition, fakeUi(), process.cwd(),
      );
      row.updateResult({
        content: [{ type: "text", text: "file body" }],
        details: { path: "src/a.ts", content: "file body", truncated: false },
      });
      row.setExpanded(true);
      return row;
    };
    const row = makeRow("live-read");
    const compact = row.render(80).map(plain);
    assert.ok(compact.join("\n").includes("▌ ✓ read src/a.ts"));
    assert.ok(compact.join("\n").includes("file body"), "expanded content must survive");

    shared.config.set("compactToolRows", false);
    const nativeRow = makeRow("native-read");
    assert.deepEqual(row.render(80).map(plain), nativeRow.render(80).map(plain));
    assert.ok(!row.render(80).map(plain).join("\n").includes("▌ ✓ read"));
    assert.equal(row.expanded, true);

    shared.config.set("compactToolRows", true);
    assert.deepEqual(row.render(80).map(plain), compact);
    assert.deepEqual(nativeRow.render(80).map(plain), compact, "a row first built native must also switch live");
    assert.equal(row.expanded, true);
    assert.equal(row.children.length, 2, "swapping shells must not retain detached containers");
  });

  it("switches rendererless rows through Pi's fallback, including excludeTools", async () => {
    const { components } = await loadPi();
    const shared = state({ excludeTools: [] });
    installBridges(shared);
    patchToolExecution(components.ToolExecutionComponent.prototype);
    const row = new components.ToolExecutionComponent(
      "mystery_tool", "live-fallback", { command: "run" }, {}, undefined, fakeUi(), process.cwd(),
    );
    row.updateResult({ content: [{ type: "text", text: "raw result" }], details: {} });
    assert.ok(row.render(80).map(plain).join("\n").includes("▌ ✓ mystery_tool run"));

    shared.config.set("excludeTools", ["mystery_tool"]);
    const native = row.render(80).map(plain).join("\n");
    assert.ok(native.includes("raw result"), native);
    assert.ok(!native.includes("▌ ✓ mystery_tool"), native);
    assert.equal(row.children[1], row.contentTextRegion);

    shared.config.set("excludeTools", []);
    assert.ok(row.render(80).map(plain).join("\n").includes("▌ ✓ mystery_tool run"));
    shared.config.set("compactToolRows", false);
    assert.ok(row.render(80).map(plain).join("\n").includes("raw result"));
    assert.equal(row.children.length, 2);
  });

  it("rebuilds the renderer when ownership changes but a native self shell stays attached", async () => {
    const { components } = await loadPi();
    const shared = state({ excludeTools: [] });
    installBridges(shared);
    patchToolExecution(components.ToolExecutionComponent.prototype);
    const firstNativeComponents: unknown[] = [];
    const firstNativeResults: unknown[] = [];
    const definition = {
      renderShell: "self",
      renderCall: (_args: unknown, _theme: unknown, context: { lastComponent?: unknown }) => {
        firstNativeComponents.push(context.lastComponent);
        return { render: () => ["native self call"], invalidate() {} };
      },
      renderResult: (_result: unknown, _options: unknown, _theme: unknown, context: { lastComponent?: unknown }) => {
        firstNativeResults.push(context.lastComponent);
        return { render: () => ["native self result"], invalidate() {} };
      },
    };
    const row = new components.ToolExecutionComponent(
      "custom_self", "live-self", { command: "run" }, {}, definition, fakeUi(), process.cwd(),
    );
    row.updateResult({ content: [{ type: "text", text: "raw result" }], details: {} });
    assert.ok(row.render(80).map(plain).join("\n").includes("▌ ✓ custom_self run"));

    shared.config.set("excludeTools", ["custom_self"]);
    assert.deepEqual(row.render(80).map(plain), ["", "native self call", "native self result"]);
    assert.equal(row.children[1], row.selfRenderContainer);
    shared.config.set("excludeTools", []);
    assert.ok(row.render(80).map(plain).join("\n").includes("▌ ✓ custom_self run"));
    shared.config.set("excludeTools", ["custom_self"]);
    assert.deepEqual(row.render(80).map(plain), ["", "native self call", "native self result"]);
    assert.deepEqual(firstNativeComponents, [undefined, undefined], "native call cache must not reuse a compact row");
    assert.deepEqual(firstNativeResults, [undefined, undefined], "native result cache must not reuse a compact row");
    assert.equal(row.children.length, 2);
  });

  it("keeps image children after switching shells", async () => {
    const { components, withBuiltInRenderers } = await loadPi();
    const { getCapabilities, setCapabilities } = await import(`${PI_ROOT}/node_modules/@earendil-works/pi-tui/dist/index.js`);
    const caps = getCapabilities();
    setCapabilities({ ...caps, images: "iterm2" });
    try {
      const shared = state();
      installBridges(shared);
      patchToolExecution(components.ToolExecutionComponent.prototype);
      const row = new components.ToolExecutionComponent(
        "read", "live-image", { path: "tiny.png" }, {},
        withBuiltInRenderers("read", undefined), fakeUi(), process.cwd(),
      );
      row.updateResult({
        content: [{ type: "image", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9N+xNioAAAAASUVORK5CYII=" }],
        details: {},
      });
      for (const compact of [true, false, true]) {
        shared.config.set("compactToolRows", compact);
        const lines = row.render(80).join("\n");
        assert.ok(lines.includes("\x1b]1337;File="), "the image remains visible after switching shells");
        assert.equal(row.imageComponents.length, 1);
        assert.equal(row.children[2], row.imageSpacers[0]);
        assert.equal(row.children[3], row.imageComponents[0]);
      }
    } finally {
      setCapabilities(caps);
    }
  });

  it("stops a running compact row's ticker when switching to Pi's renderer", async () => {
    const { components, withBuiltInRenderers } = await loadPi();
    const shared = state();
    const timers = fakeTimers();
    installBridges({ ...shared, timers });
    patchToolExecution(components.ToolExecutionComponent.prototype);
    const row = new components.ToolExecutionComponent(
      "read", "live-timer", { path: "src/a.ts" }, {},
      withBuiltInRenderers("read", undefined), fakeUi(), process.cwd(),
    );
    row.markExecutionStarted();
    assert.equal(timers.pending(), 1);
    shared.config.set("compactToolRows", false);
    row.render(80);
    assert.equal(timers.pending(), 0);
    shared.config.set("compactToolRows", true);
    row.render(80);
    assert.equal(timers.pending(), 1, "the new compact row owns exactly one ticker");
    row.updateResult({ content: [{ type: "text", text: "done" }], details: {} });
    assert.equal(timers.pending(), 0);
  });

  it("obeys the master switch even for a tool with no renderer", async () => {
    // REGRESSION: claims() also returned our renderer when a tool had no
    // renderer of its own. Load-bearing under the old whitelist; with a
    // blacklist it silently OVERRODE the user, so `compactToolRows: false` and an
    // excluded rendererless tool were both compacted anyway. Caught by an
    // end-to-end check against the real bundle, not by the unit tests.
    const { components } = await loadPi();
    installBridges(state({ compactToolRows: false }));
    patchToolExecution(components.ToolExecutionComponent.prototype);

    const row = new components.ToolExecutionComponent(
      "goland__execute_tool",
      "master-off",
      { command: "run" },
      {},
      undefined, // no renderer at all
      fakeUi(),
      process.cwd(),
    );
    row.updateResult({ content: [{ type: "text", text: "ide output" }], details: {} });

    const text = row.render(80).map(plain).join("\n");
    assert.ok(!text.includes("▌ ✓ goland__execute_tool"), `master switch ignored: ${text}`);
    // Pi's own fallback rendering shows the output instead.
    assert.ok(text.includes("ide output"), text);
  });

  it("leaves an excluded rendererless tool to Pi", async () => {
    const { components } = await loadPi();
    installBridges(state({ excludeTools: ["mystery_tool"] }));
    patchToolExecution(components.ToolExecutionComponent.prototype);

    const row = new components.ToolExecutionComponent(
      "mystery_tool",
      "excluded-rendererless",
      { path: "x" },
      {},
      undefined,
      fakeUi(),
      process.cwd(),
    );
    row.updateResult({ content: [{ type: "text", text: "raw" }], details: {} });
    const text = row.render(80).map(plain).join("\n");
    assert.ok(!text.includes("▌ ✓ mystery_tool"), text);
  });

  it("is idempotent, so /reload never stacks wrappers", async () => {
    const { components, withBuiltInRenderers } = await loadPi();
    installBridges(state());
    for (let i = 0; i < 3; i++) patchToolExecution(components.ToolExecutionComponent.prototype);

    const row = new components.ToolExecutionComponent(
      "read",
      "call-idem",
      { path: "src/a.ts" },
      {},
      withBuiltInRenderers("read", undefined),
      fakeUi(),
      process.cwd(),
    );
    row.updateResult({ content: [{ type: "text", text: "x" }], details: {} });
    assert.deepEqual(
      row.render(80).map(plain).map((line: string) => line.trimEnd()),
      ["", " ▌ ✓ read src/a.ts"],
    );
  });
});
