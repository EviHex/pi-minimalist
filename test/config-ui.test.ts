import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BASIC_KEYS, Config, DEFAULTS } from "../src/config.ts";
import { FIELDS, createConfigScreen, items, summary } from "../src/config-ui.ts";

type Item = { id: string; label: string; description?: string; currentValue: string; values?: string[] };

/**
 * Minimal stand-in for pi-tui's SettingsList, capturing what it was handed.
 *
 * Fields are assigned in the body, not declared as constructor parameter
 * properties: Node's type-stripping runs the TypeScript directly and rejects
 * that syntax (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`).
 */
class FakeSettingsList {
  static last: FakeSettingsList | undefined;
  items: Item[];
  maxVisible: number;
  theme: unknown;
  onChange: (id: string, value: string) => void;
  onCancel: () => void;

  constructor(
    items: Item[],
    maxVisible: number,
    theme: unknown,
    onChange: (id: string, value: string) => void,
    onCancel: () => void,
  ) {
    this.items = items;
    this.maxVisible = maxVisible;
    this.theme = theme;
    this.onChange = onChange;
    this.onCancel = onCancel;
    FakeSettingsList.last = this;
  }
  render(): string[] {
    return [];
  }
  invalidate(): void {}
  handleInput(): void {}
}

function screen(config: Config, onChange = (_k: string, _v: boolean) => {}, onClose = () => {}) {
  createConfigScreen({
    SettingsList: FakeSettingsList as never,
    theme: {} as never,
    config,
    onChange: onChange as never,
    onClose,
  });
  const list = FakeSettingsList.last;
  assert.ok(list, "SettingsList must be constructed");
  return list;
}

describe("config screen contents", () => {
  it("exposes exactly the command-editable keys", () => {
    // The advanced keys (glyphs, tokens, excludeTools, maxDetailChars) must stay
    // JSON-only: they need exact tool names or Pi palette knowledge, and a
    // chooser would imply they are casual choices.
    assert.deepEqual(
      FIELDS.map((field) => field.key).sort(),
      [...BASIC_KEYS].sort(),
    );
  });

  it("gives every setting a label and a hover description", () => {
    for (const field of FIELDS) {
      assert.ok(field.label.length > 0, field.key);
      // The description is the whole reason this is a screen and not a flag.
      assert.ok(field.description.length > 20, `${field.key} needs a real explanation`);
      assert.ok(!field.description.includes("_"), `${field.key} must read as prose, not a key name`);
    }
  });

  it("renders booleans as on/off rather than true/false", () => {
    const rendered = items({ ...DEFAULTS, groupToolRuns: true, timer: false });
    const byId = new Map(rendered.map((item) => [item.id, item]));
    assert.equal(byId.get("groupToolRuns")?.currentValue, "on");
    assert.equal(byId.get("timer")?.currentValue, "off");
    for (const item of rendered) assert.deepEqual(item.values, ["on", "off"]);
  });

  it("shows every row without scrolling", () => {
    assert.equal(screen(new Config(DEFAULTS)).maxVisible, FIELDS.length);
  });
});

describe("config screen behaviour", () => {
  it("applies a change to the live config immediately", () => {
    // Applied at once so the transcript behind the overlay re-renders while the
    // user is still choosing — seeing the effect is the point of the screen.
    const config = new Config(DEFAULTS);
    const list = screen(config);
    assert.equal(config.get("gutter"), true);

    list.onChange("gutter", "off");
    assert.equal(config.get("gutter"), false);
  });

  it("reports the changed key and value to its caller", () => {
    const changes: [string, boolean][] = [];
    const list = screen(new Config(DEFAULTS), (key, value) => changes.push([key, value]));

    list.onChange("groupToolRuns", "on");
    list.onChange("timer", "off");
    assert.deepEqual(changes, [["groupToolRuns", true], ["timer", false]]);
  });

  it("ignores unknown ids instead of writing junk into settings", () => {
    const config = new Config(DEFAULTS);
    const before = config.all();
    screen(config).onChange("not-a-setting", "on");
    assert.deepEqual(config.all(), before);
  });

  it("closes through the cancel callback", () => {
    let closed = false;
    screen(new Config(DEFAULTS), undefined, () => {
      closed = true;
    }).onCancel();
    assert.equal(closed, true);
  });
});

describe("summary", () => {
  it("lists every setting with its state and where to find the rest", () => {
    const text = summary({ ...DEFAULTS, groupToolRuns: true });
    for (const field of FIELDS) assert.ok(text.includes(field.label), field.key);
    assert.match(text, /Group tool runs\s+on/);
    assert.match(text, /Elapsed timer\s+on/);
    // Bare `/minimalist` should point at both the editor and the JSON-only keys.
    assert.ok(text.includes("/minimalist config"));
    assert.ok(text.includes("settings.json"));
  });
});
