import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FooterStatuses, FooterToggleDialog, memoryStore } from "./footer.ts";
import { fakeTheme, plain } from "./test-support.ts";

const theme = fakeTheme();

/** Keybinding stub: only the actions the dialog consults. */
const keybindings = {
  matches: (keyData: string, action: string) =>
    (action === "tui.select.up" && keyData === "\x1b[A") ||
    (action === "tui.select.down" && keyData === "\x1b[B") ||
    (action === "tui.select.cancel" && keyData === "\x1b") ||
    (action === "tui.select.confirm" && keyData === "\r"),
};

describe("FooterStatuses", () => {
  it("records statuses from the tap and swallows hidden keys", () => {
    const statuses = new FooterStatuses(memoryStore(["ponytail"]));

    assert.equal(statuses.tap("polyglot", "中文"), false, "visible status must reach the footer");
    assert.equal(statuses.tap("ponytail", "full"), true, "hidden status must be swallowed");
    assert.deepEqual(statuses.entries(), [["polyglot", "中文"], ["ponytail", "full"]]);
  });

  it("drops cleared statuses from the viewer", () => {
    const statuses = new FooterStatuses(memoryStore());
    statuses.tap("mcp", "4 servers");
    statuses.tap("mcp", undefined);
    assert.deepEqual(statuses.entries(), []);
    assert.equal(statuses.has("mcp"), false);
  });

  it("merges statuses set before the tap registered", () => {
    const statuses = new FooterStatuses(memoryStore());
    statuses.tap("caveman", "on");
    statuses.attachUi({ getExtensionStatuses: () => new Map([["jetbrains", "goland"]]) });

    assert.deepEqual(statuses.keys().sort(), ["caveman", "jetbrains"]);
  });

  it("persists hidden keys on every toggle", () => {
    const store = memoryStore();
    const statuses = new FooterStatuses(store);

    assert.equal(statuses.toggle("polyglot"), true);
    assert.deepEqual(store.read(), ["polyglot"]);

    assert.equal(statuses.toggle("polyglot"), false);
    assert.deepEqual(store.read(), []);

    statuses.setHidden("caveman", true);
    assert.deepEqual(store.read(), ["caveman"]);
  });

  it("restores hidden keys from the store on construction", () => {
    const statuses = new FooterStatuses(memoryStore(["a", "b"]));
    assert.equal(statuses.isHidden("a"), true);
    assert.equal(statuses.isHidden("c"), false);
  });
});

describe("FooterToggleDialog", () => {
  function dialog(hidden: string[] = []) {
    const statuses = new FooterStatuses(memoryStore(hidden));
    statuses.tap("caveman", "on");
    statuses.tap("polyglot", "中文");
    const entries = statuses.entries();
    let closed = 0;
    const component = new FooterToggleDialog(entries, theme, keybindings, statuses, () => closed++);
    return { component, statuses, closed: () => closed };
  }

  it("renders a header, one row per status, and a hint", () => {
    const { component } = dialog(["polyglot"]);
    const lines = component.render().map(plain);

    assert.equal(lines.length, 4);
    assert.equal(lines[0], "*extension footer statuses*");
    assert.equal(lines[1], "→ ✓ caveman → on");
    assert.equal(lines[2], "  ✗ polyglot → 中文");
    assert.match(lines[3], /space toggle/);
  });

  it("moves the cursor with arrows and vi keys, clamped at both ends", () => {
    const { component } = dialog();

    assert.equal(component.selectedIndex(), 0);
    component.handleInput("\x1b[A");
    assert.equal(component.selectedIndex(), 0, "must clamp at the top");

    component.handleInput("j");
    assert.equal(component.selectedIndex(), 1);
    component.handleInput("\x1b[B");
    assert.equal(component.selectedIndex(), 1, "must clamp at the bottom");
    component.handleInput("k");
    assert.equal(component.selectedIndex(), 0);
  });

  it("toggles the selected status with space and persists it", () => {
    const { component, statuses } = dialog();

    component.handleInput(" ");
    assert.equal(statuses.isHidden("caveman"), true);
    assert.equal(plain(component.render()[1]), "→ ✗ caveman → on");

    component.handleInput(" ");
    assert.equal(statuses.isHidden("caveman"), false);
  });

  it("closes on Esc, Enter, and s, and consumes every key", () => {
    for (const key of ["\x1b", "\r", "s", "\n"]) {
      const { component, closed } = dialog();
      assert.equal(component.handleInput(key), true);
      assert.equal(closed(), 1, `key ${JSON.stringify(key)} must close the dialog`);
    }
    const { component } = dialog();
    assert.equal(component.handleInput("q"), true, "unhandled keys must still be consumed");
  });
});
