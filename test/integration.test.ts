/**
 * Integration test: does the REAL core render bridge reach our renderer?
 *
 * Unit tests call our renderer directly, so they cannot catch a broken or
 * reverted patch-pi.sh bridge, nor the pi-subagents regression (built-ins must
 * stay natively owned). This test therefore uses:
 *   - the real ToolExecutionComponent from Pi's installed core,
 *   - the real native tool definition (createReadToolDefinition),
 *   - the real extension entry point, loaded through Pi's extension loader.
 *
 * PI_ROOT is resolved by run-tests.sh; without it the whole file skips rather
 * than failing, so the deterministic unit tests still run anywhere.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { BUILT_INS } from "../src/tool-rows.ts";

const PI_ROOT = process.env.PI_ROOT;
const EXTENSION = new URL("../index.ts", import.meta.url).pathname;
const EXTENSION_DIR = new URL("..", import.meta.url).pathname;

/** Strip ANSI so assertions read the visible text, not the machine's palette. */
function plain(line: string): string {
  // eslint-disable-next-line no-control-regex
  return line.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
}

describe("core bridge integration", { skip: PI_ROOT ? false : "PI_ROOT not set" }, () => {
  it("routes native built-ins through the extension renderer, keeping native ownership", async () => {
    const { loadExtensions } = await import(`${PI_ROOT}/dist/core/extensions/loader.js`);
    const { createReadToolDefinition } = await import(`${PI_ROOT}/dist/core/tools/read.js`);
    const { ToolExecutionComponent } = await import(
      `${PI_ROOT}/dist/modes/interactive/components/tool-execution.js`
    );
    const { initTheme } = await import(`${PI_ROOT}/dist/modes/interactive/theme/theme.js`);

    initTheme("dark", false);

    const loaded = await loadExtensions([EXTENSION], EXTENSION_DIR);
    assert.deepEqual(loaded.errors, [], "the extension must load cleanly");

    // The pi-subagents contract: children only receive read/bash/write if those
    // names stay natively owned, i.e. if this extension registers NO tools.
    assert.deepEqual(
      [...loaded.extensions[0].tools.keys()],
      [],
      "registering built-ins would strip them from subagent tool allowlists",
    );

    // The bridge core consults. handles() drives render-only overrides.
    const bridge = (globalThis as any)[Symbol.for("pi.defaultToolRenderer")];
    assert.ok(bridge, "the extension must install the global renderer");
    assert.equal(bridge.handles("read"), true);
    assert.equal(bridge.handles("mcp"), false);

    // Thinking gets its own all-purple Markdown theme; no outer gutter wrapper.
    assert.equal(typeof (globalThis as any)[Symbol.for("pi.thinkingPreview")], "function");
    assert.equal(typeof (globalThis as any)[Symbol.for("pi.thinkingMarkdownTheme")], "function");
    assert.equal((globalThis as any)[Symbol.for("pi.contentWrap")], undefined);

    const native = createReadToolDefinition("/tmp");
    assert.equal(native.name, "read", "the native definition must remain intact");
    assert.equal(typeof native.execute, "function", "native execution must be preserved");

    const component = new ToolExecutionComponent(
      "read",
      "call-1",
      { path: "/tmp/example.ts", offset: 1, limit: 5 },
      undefined,
      native, // real native definition: renderers, schema, execute
      { requestRender() {} }, // minimal TUI stub
      "/tmp",
    );
    component.markExecutionStarted();
    component.setArgsComplete();
    component.updateResult({ content: [{ type: "text", text: "one\ntwo" }], isError: false }, false);

    const collapsed = (component.render(100) as string[]).map(plain);
    // Core emits a leading spacer row; the tool itself must be ONE line.
    assert.deepEqual(
      collapsed.filter((line: string) => line.trim() !== ""),
      [" ▌ ✓ read /tmp/example.ts:1-5"],
      "collapsed built-in must be one compact row through the real bridge",
    );

    component.setExpanded(true);
    const expanded = (component.render(100) as string[]).map((line: string) => plain(line).trimEnd());
    assert.equal(expanded[1], " ▌ ✓ read /tmp/example.ts:1-5");
    assert.ok(
      expanded.some((line: string) => line === " ▌ one") &&
        expanded.some((line: string) => line === " ▌ two"),
      `expanded native output must be guttered, got ${JSON.stringify(expanded)}`,
    );
    assert.ok(
      expanded.every((line: string) => line === "" || line.startsWith(" ▌")),
      `every expanded line must carry the gutter, got ${JSON.stringify(expanded)}`,
    );
  });

  it("removes leading spacers from hidden quiet tool rows", async () => {
    const { loadExtensions } = await import(`${PI_ROOT}/dist/core/extensions/loader.js`);
    const { createReadToolDefinition } = await import(`${PI_ROOT}/dist/core/tools/read.js`);
    const { ToolExecutionComponent } = await import(
      `${PI_ROOT}/dist/modes/interactive/components/tool-execution.js`
    );
    const { initTheme } = await import(`${PI_ROOT}/dist/modes/interactive/theme/theme.js`);
    initTheme("dark", false);
    const loaded = await loadExtensions([EXTENSION], EXTENSION_DIR);
    assert.deepEqual(loaded.errors, []);

    const quiet = (globalThis as any)[Symbol.for("pi.minimalist.quietMode")];
    quiet.setEnabled(true);
    quiet.observeProse({}, 0); // isolate this run from earlier integration entries
    try {
      const native = createReadToolDefinition("/tmp");
      const complete = (name: string, id: string) => {
        const component = new ToolExecutionComponent(name, id, { path: "/tmp/a.ts" }, undefined, native, { requestRender() {} }, "/tmp");
        component.markExecutionStarted();
        component.setArgsComplete();
        component.updateResult({ content: [{ type: "text", text: "ok" }], isError: false }, false);
        return component;
      };
      const hidden = complete("read", "quiet-hidden");
      const tail = complete("edit", "quiet-tail");

      assert.deepEqual(hidden.render(80), [], "hidden row must not retain its parent Spacer");
      assert.ok(tail.render(80).map(plain).some((line: string) => line.includes("read ×1, edit ×1")));
    } finally {
      quiet.setEnabled(false);
    }
  });

  it("still finds every BUILT_INS name among Pi's own built-in tools", async () => {
    // If Pi renames or drops a built-in, that tool silently reverts to the
    // verbose card. Cross-check our list against core's tool factories.
    const tools = await import(`${PI_ROOT}/dist/core/tools/index.js`);
    const exported = Object.keys(tools);

    for (const name of BUILT_INS) {
      const factory = `create${name[0].toUpperCase()}${name.slice(1)}ToolDefinition`;
      assert.ok(
        exported.includes(factory),
        `BUILT_INS lists "${name}" but core exports no ${factory}`,
      );
    }
  });

  it("expands streaming thinking, then restores collapsed thinking", async () => {
    const { loadExtensions } = await import(`${PI_ROOT}/dist/core/extensions/loader.js`);
    const { AssistantMessageComponent } = await import(
      `${PI_ROOT}/dist/modes/interactive/components/assistant-message.js`
    );
    const { initTheme } = await import(`${PI_ROOT}/dist/modes/interactive/theme/theme.js`);

    initTheme("dark", false);
    const loaded = await loadExtensions([EXTENSION], EXTENSION_DIR);
    assert.deepEqual(loaded.errors, []);

    const message = { role: "assistant", content: [{ type: "thinking", thinking: "live thought text" }] };
    const component = new AssistantMessageComponent(undefined, true);
    component.updateContent(message, true);
    const streaming = component.render(80).map(plain);
    assert.ok(streaming.some((line: string) => line.includes("live thought text")));
    assert.ok(!streaming.some((line: string) => line.includes("✓ think")));

    component.updateContent(message, false);
    const finished = component.render(80).map(plain);
    assert.ok(finished.some((line: string) => line.includes("✓ think live thought text")));
  });

  it("folds completed collapsed thinking previews through the real core bridge", async () => {
    const { loadExtensions } = await import(`${PI_ROOT}/dist/core/extensions/loader.js`);
    const { AssistantMessageComponent } = await import(
      `${PI_ROOT}/dist/modes/interactive/components/assistant-message.js`
    );
    const { initTheme } = await import(`${PI_ROOT}/dist/modes/interactive/theme/theme.js`);

    initTheme("dark", false);
    const loaded = await loadExtensions([EXTENSION], EXTENSION_DIR);
    assert.deepEqual(loaded.errors, []);
    const quiet = (globalThis as any)[Symbol.for("pi.minimalist.quietMode")];
    quiet.setEnabled(true);
    try {
      // This shared process-global registry may contain earlier integration
      // entries. Add a real boundary so this assertion isolates its own run.
      quiet.observeProse({}, 0);
      const message = (thinking: string) => ({ role: "assistant", content: [{ type: "thinking", thinking }] });
      const first = new AssistantMessageComponent(message("first thought"), true);
      const last = new AssistantMessageComponent(message("second thought"), true);

      assert.deepEqual(first.render(80).map(plain), [], "hidden thinking must not retain its message Spacer");
      assert.ok(last.render(80).map(plain).some((line: string) => line.includes("✓ think ×2")));
    } finally {
      quiet.setEnabled(false);
    }
  });

  it("renders code blocks with compact corners instead of raw fences", async () => {
    const { Markdown } = await import(`${PI_ROOT}/node_modules/@earendil-works/pi-tui/dist/components/markdown.js`);
    const { getMarkdownTheme, initTheme } = await import(`${PI_ROOT}/dist/modes/interactive/theme/theme.js`);
    initTheme("dark", false);

    const render = (source: string) => new Markdown(source, 0, 0, getMarkdownTheme()).render(80)
      .map(plain).map((line: string) => line.trimEnd());
    assert.deepEqual(render("```ts\nconst x = 1;\n```"), ["╭ ts", "│ const x = 1;", "╰"]);
    assert.deepEqual(render("```\nplain\n```"), ["╭ code", "│ plain", "╰"]);
  });

  it("applies the unbundled thinking bridge in the installed Pi", () => {
    // patch-pi.sh edits compiled files that a Pi upgrade overwrites, and only
    // the renderer bridge is observable through the rendering test above. Check
    // the thinking bridge in the UNBUNDLED file (the bundle chunk filename is a
    // build hash and would make this test brittle); patch-pi.sh keeps both forms
    // in sync, so a missing marker here means the patch needs re-running.
    const source = readFileSync(
      `${PI_ROOT}/dist/modes/interactive/components/assistant-message.js`,
      "utf-8",
    );
    assert.ok(
      source.includes('Symbol.for("pi.thinkingPreview")') &&
        source.includes("const hidden = this.isStreaming ? false :") &&
        source.includes('Symbol.for("pi.minimalist.quietThinking")') &&
        source.includes('Symbol.for("pi.minimalist.quietProse")') &&
        source.includes("this.isStreaming, this, runIndex") &&
        source.includes('Symbol.for("pi.thinkingMarkdownTheme")') &&
        source.includes("thinkingMarkdownTheme, {"),
      "assistant-message.js is missing the quiet thinking bridge — run ./patch-pi.sh and restart Pi",
    );
  });
});
