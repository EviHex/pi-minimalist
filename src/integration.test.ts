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
import { describe, it } from "node:test";

const PI_ROOT = process.env.PI_ROOT;
const EXTENSION = new URL("../index.ts", import.meta.url).pathname;
const EXTENSION_DIR = new URL("..", import.meta.url).pathname;

/** Strip ANSI so assertions read the visible text, not the machine's palette. */
function plain(line: string): string {
  // eslint-disable-next-line no-control-regex
  return line.replace(/\x1b\[[0-9;]*m/g, "");
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
});
