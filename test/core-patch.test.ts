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
import { installBridges } from "../src/bridge.ts";
import { Config } from "../src/config.ts";
import { patchAssistantMessage, patchToolExecution } from "../src/core-patch.ts";
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

function assistantMessage(content: unknown[], stopReason = "stop") {
  return { role: "assistant", content, stopReason, timestamp: Date.now() };
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

    const prose = (text: string, phase: "commentary" | "final_answer", stopReason: string) =>
      new components.AssistantMessageComponent(
        assistantMessage([{ type: "text", text, textSignature: JSON.stringify({ v: 1, phase }) }], stopReason),
        true,
        markdownTheme,
        "Thinking...",
        1,
        [],
      );
    const first = prose("first progress note", "commentary", "toolUse");
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

    const prose = (text: string, phase: "commentary" | "final_answer", stopReason: string) =>
      new components.AssistantMessageComponent(
        assistantMessage([{ type: "text", text, textSignature: JSON.stringify({ v: 1, phase }) }], stopReason),
        true,
        markdownTheme,
        "Thinking...",
        1,
        [],
      );
    // No agentStarted(): replay only emits finalized historical messages.
    const rows = [
      prose("old progress one", "commentary", "toolUse"),
      prose("FINAL ONE", "final_answer", "stop"),
      prose("old progress two", "commentary", "toolUse"),
      prose("FINAL TWO", "final_answer", "stop"),
    ];
    const text = rows.flatMap((row) => row.render(80)).map(plain).join("\n");

    assert.ok(!text.includes("old progress one"), text);
    assert.ok(!text.includes("old progress two"), text);
    assert.ok(text.includes("FINAL ONE"), text);
    assert.ok(text.includes("FINAL TWO"), text);
    assert.equal(text.match(/Worked for/g)?.length, 2, text);
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
