import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";
import { BRIDGE_SYMBOLS } from "../src/bridge.ts";
import { BUILT_INS } from "../src/tools.ts";

const PI_ROOT = process.env.PI_ROOT;
const EXTENSION = new URL("../index.ts", import.meta.url).pathname;
const EXTENSION_DIR = new URL("..", import.meta.url).pathname;

function plain(line: string): string {
  // eslint-disable-next-line no-control-regex
  return line.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
}

function bundleSource(): string {
  const directory = `${PI_ROOT}/dist/bundle/chunks`;
  const files = readdirSync(directory).filter((file) => file.startsWith("chunk-") && file.endsWith(".js"));
  const matches = files
    .map((file) => readFileSync(`${directory}/${file}`, "utf8"))
    .filter((source) => source.includes("createCallFallback()"));
  assert.equal(matches.length, 1, "expected one bundle chunk containing ToolExecutionComponent");
  return matches[0];
}

describe("installed Pi integration", { skip: PI_ROOT ? false : "PI_ROOT not set" }, () => {
  it("loads without taking ownership of built-in tools", async () => {
    const { loadExtensions } = await import(`${PI_ROOT}/dist/core/extensions/loader.js`);
    const loaded = await loadExtensions([EXTENSION], EXTENSION_DIR);

    assert.deepEqual(loaded.errors, []);
    assert.deepEqual([...loaded.extensions[0].tools.keys()], []);
    const renderer = (globalThis as any)[Symbol.for("pi.defaultToolRenderer")];
    assert.equal(typeof renderer, "object");
    assert.equal(renderer.handles("mcp"), true);
    assert.equal(renderer.handles("mcpScript"), true);
    assert.equal(typeof (globalThis as any)[Symbol.for("pi.thinkingPreview")], "function");
  });

  it("keeps the built-in name list aligned with Pi", async () => {
    const tools = await import(`${PI_ROOT}/dist/core/tools/index.js`);
    for (const name of BUILT_INS) {
      const factory = `create${name[0].toUpperCase()}${name.slice(1)}ToolDefinition`;
      assert.equal(typeof tools[factory], "function", `Pi no longer exports ${factory}`);
    }
  });

  it("contains every declared bridge in the actual CLI bundle", () => {
    // Driven by BRIDGE_SYMBOLS itself, so adding a bridge without patching the
    // bundle (or misspelling either side) fails here instead of silently
    // disabling the feature.
    const source = bundleSource();
    for (const [name, marker] of Object.entries(BRIDGE_SYMBOLS)) {
      // quietMode is extension-internal state shared across /reload; core never
      // reads it, so it is deliberately absent from the bundle.
      if (name === "quietMode") continue;
      assert.ok(source.includes(marker), `bundle is missing ${marker}; run ./patch-pi.sh`);
    }
  });

  it("renders markdown chrome while pi-tui stays pristine", async () => {
    const { Markdown } = await import(
      `${PI_ROOT}/node_modules/@earendil-works/pi-tui/dist/components/markdown.js`
    );
    const { getMarkdownTheme, initTheme } = await import(
      `${PI_ROOT}/dist/modes/interactive/theme/theme.js`
    );
    const { installMarkdownChrome } = await import(`${EXTENSION_DIR}/src/markdown-chrome.ts`);

    initTheme("dark", false);
    const live = (globalThis as any)[Symbol.for("@earendil-works/pi-coding-agent:theme")];
    installMarkdownChrome(live);
    const theme = { ...getMarkdownTheme(), codeBlockIndent: "│ " };
    const render = (source: string) =>
      new Markdown(source, 0, 0, theme).render(80).map(plain).map((line: string) => line.trimEnd());

    assert.deepEqual(render("```ts\nconst x = 1;\n```"), ["╭ ts", "│ const x = 1;", "╰"]);
    assert.deepEqual(render("```\nplain\n```"), ["╭ code", "│ plain", "╰"]);
    assert.deepEqual(render("> quoted"), ["▌ quoted"]);

    const source = readFileSync(
      `${PI_ROOT}/node_modules/@earendil-works/pi-tui/dist/components/markdown.js`,
      "utf8",
    );
    assert.ok(source.includes('codeBlockIndent ?? "  "'));
    assert.ok(source.includes('quoteBorder("│ ")'));
    assert.ok(!source.includes("╭"));
  });
});
