import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BRIDGE_SYMBOLS } from "../src/bridge.ts";
import { BUILT_INS } from "../src/tools.ts";

const PI_ROOT = process.env.PI_ROOT;
const EXTENSION = new URL("../index.ts", import.meta.url).pathname;
const EXTENSION_DIR = new URL("..", import.meta.url).pathname;

describe("installed Pi integration", { skip: PI_ROOT ? false : "PI_ROOT not set" }, () => {
  it("loads without taking ownership of built-in tools", async () => {
    const { loadExtensions } = await import(`${PI_ROOT}/dist/core/extensions/loader.js`);
    const loaded = await loadExtensions([EXTENSION], EXTENSION_DIR);

    assert.deepEqual(loaded.errors, []);
    assert.deepEqual([...loaded.extensions[0].tools.keys()], []);
    const bridge = (globalThis as any)[Symbol.for(BRIDGE_SYMBOLS.bridge)];
    const renderer = bridge.toolRenderer;
    assert.equal(typeof renderer, "object");
    assert.equal(renderer.handles("mcp"), true);
    assert.equal(renderer.handles("mcpScript"), true);
    assert.equal(renderer.handles("mcp__atlassian"), true);
    assert.equal(typeof bridge.thinkingPreview, "function");
  });

  it("opens settings by default, keeps config as alias, and reports status without a TUI", async () => {
    const { loadExtensions } = await import(`${PI_ROOT}/dist/core/extensions/loader.js`);
    const loaded = await loadExtensions([EXTENSION], EXTENSION_DIR);
    assert.deepEqual(loaded.errors, []);
    const command = loaded.extensions[0].commands.get("minimalist");
    assert.ok(command);
    assert.match(command.description, /Open pi-minimalist settings/);
    const { initTheme } = await import(`${PI_ROOT}/dist/modes/interactive/theme/theme.js`);
    initTheme("dark", false);

    const notices: [string, string][] = [];
    const screens: { render(width: number): string[] }[] = [];
    const ctx = {
      hasUI: true,
      mode: "tui",
      ui: {
        notify: (message: string, level: string) => notices.push([message, level]),
        custom: async (factory: (tui: unknown, theme: unknown, keys: unknown, done: () => void) => { render(width: number): string[] }) => {
          screens.push(factory(undefined, undefined, undefined, () => {}));
        },
      },
    };

    await command.handler("", ctx as never);
    await command.handler("config", ctx as never);
    assert.equal(screens.length, 2);
    assert.match(screens[0].render(80).at(-1)!, /Changes apply live · Ctrl\+O reveals tool output/);
    assert.deepEqual(notices, []);

    await command.handler("status", ctx as never);
    assert.equal(screens.length, 2);
    assert.match(notices.at(-1)![0], /pi-minimalist\n/);
    assert.match(notices.at(-1)![0], /\/minimalist\s+change these/);

    ctx.hasUI = false;
    ctx.mode = "print";
    await command.handler("", ctx as never);
    await command.handler("config", ctx as never);
    await command.handler("status", ctx as never);
    assert.equal(screens.length, 2, "never open the custom TUI in print mode");
    assert.equal(notices.at(-1)![1], "info", "status remains available without a TUI");

    ctx.hasUI = true;
    ctx.mode = "rpc";
    await command.handler("", ctx as never);
    assert.equal(screens.length, 2, "RPC has UI notifications but no custom TUI");
  });

  it("keeps the built-in name list aligned with Pi", async () => {
    const tools = await import(`${PI_ROOT}/dist/core/tools/index.js`);
    for (const name of BUILT_INS) {
      const factory = `create${name[0].toUpperCase()}${name.slice(1)}ToolDefinition`;
      assert.equal(typeof tools[factory], "function", `Pi no longer exports ${factory}`);
    }
  });

  it("keeps every seam the runtime wrappers depend on", async () => {
    // These are the exact prototype methods src/core-patch.ts wraps; if a Pi release renames one, this fails
    // with its name instead of the feature silently disappearing.
    const components = await import(`${PI_ROOT}/dist/modes/interactive/components/index.js`);

    for (const method of [
      "getCallRenderer",
      "getResultRenderer",
      "hasRendererDefinition",
      "getRenderShell",
      "createResultFallback",
      "updateDisplay",
    ]) {
      assert.equal(
        typeof (components.ToolExecutionComponent.prototype as any)[method],
        "function",
        `ToolExecutionComponent.${method} disappeared`,
      );
    }
    for (const method of ["updateContent", "render", "handleMouse"]) {
      assert.equal(
        typeof (components.AssistantMessageComponent.prototype as any)[method],
        "function",
        `AssistantMessageComponent.${method} disappeared`,
      );
    }
    assert.equal(
      typeof (components.UserMessageComponent.prototype as any).rebuild,
      "function",
      "UserMessageComponent.rebuild disappeared",
    );
    const message = { content: [{ type: "thinking", thinking: "reasoning" }], stopReason: "stop" };
    const assistant = new components.AssistantMessageComponent(message);
    assert.equal(assistant.lastMessage, message, "live thinking switches rebuild from the original message");
    const tool = new components.ToolExecutionComponent(
      "seam", "seam-1", {}, {}, undefined, { requestRender() {} }, process.cwd(),
    );
    assert.ok(
      [tool.contentTextRegion, tool.contentBox, tool.selfRenderContainer].includes(tool.children[1]),
      "one known shell must follow the leading spacer",
    );
    assert.ok(tool.contentBox && tool.selfRenderContainer && tool.rendererState);
    assert.ok("callRendererComponent" in tool && "resultRendererComponent" in tool);

    // Structural signals the thinking wrapper matches on (see core-patch.ts:
    // instanceof is unreliable because the bundle inlines its own pi-tui copy).
    const { MouseRegion, Markdown, Spacer, Text, getMarkdownTheme } = {
      ...(await import(`${PI_ROOT}/node_modules/@earendil-works/pi-tui/dist/index.js`)),
      ...(await import(`${PI_ROOT}/dist/modes/interactive/theme/theme.js`)),
    } as any;
    const region = new MouseRegion(new Text("x", 0, 0), () => undefined);
    assert.equal(typeof region.onMouse, "function", "MouseRegion.onMouse is the run marker");
    assert.notEqual(region.child, undefined, "MouseRegion.child must stay reassignable");
    assert.equal(new Text("x", 0, 0).theme, undefined, "collapsed runs are detected by having no theme");
    assert.notEqual(
      new Markdown("x", 0, 0, getMarkdownTheme()).theme,
      undefined,
      "expanded runs are detected (and recolored) through Markdown.theme",
    );
    assert.equal(typeof new Spacer(1).setLines, "function", "leading spacer is detected by setLines");
  });
});
