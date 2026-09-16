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

  it("shows a compact preview instead of the bare Thinking... label", async () => {
    const { components, markdownTheme } = await loadPi();
    installBridges(state());
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

  it("keeps a STREAMING thinking block collapsed by default", async () => {
    const { components, markdownTheme } = await loadPi();
    installBridges(state());
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
    installBridges(state({ keepActiveThinkingExpanded: true }));
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

  it("recolors expanded thinking to a single purple hue", async () => {
    const { components, markdownTheme } = await loadPi();
    installBridges(state());
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
    installBridges(state({ groupToolRuns: true }));
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

  it("folds thinking together with adjacent tool rows under /quiet", async () => {
    // REGRESSION: decorateThinking passed `!hidden` to the quietThinking bridge,
    // which negates it into `expanded` itself. The double negation made COLLAPSED
    // thinking non-foldable, so every thinking row split the run in two and a
    // transcript rendered as "think / read ×2 / think / bash" instead of one
    // summary. Expanded thinking got the mirror-image bug: it became foldable and
    // swallowed whole runs of visible tool rows into a single summary line.
    const { components, markdownTheme, withBuiltInRenderers } = await loadPi();
    installBridges(state({ groupToolRuns: true }));
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
    installBridges(state({ groupToolRuns: true }));
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
