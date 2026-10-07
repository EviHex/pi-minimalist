import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { BASIC_KEYS, Config, DEFAULTS } from "../src/config.ts";
import { FIELDS, argumentCompletions, createConfigScreen, items, summary } from "../src/config-ui.ts";

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
  selectItem(): void {}
}

function screen(config: Config, onChange = (_k: string, _v: unknown) => {}, onClose = () => {}) {
  createConfigScreen({
    SettingsList: FakeSettingsList as never,
    theme: { hint: (text: string) => text } as never,
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
    for (const item of rendered.filter((item) => !["preset", "activitySummary", "glyphStyle"].includes(item.id))) {
      assert.deepEqual(item.values, ["on", "off"]);
    }
  });

  it("offers Unicode and ASCII while keeping custom glyph overrides", () => {
    const config = new Config({ ...DEFAULTS, glyphs: { done: "OK" } });
    const symbols = items(config.all()).find((item) => item.id === "glyphStyle");
    assert.deepEqual(symbols?.values, ["Unicode", "ASCII"]);
    assert.equal(symbols?.currentValue, "Unicode");
    screen(config).onChange("glyphStyle", "ASCII");
    assert.equal(config.get("glyphStyle"), "ascii");
    assert.equal(config.glyphs().done, "OK");
    assert.equal(config.glyphs().failed, "x");
    screen(config).onChange("glyphStyle", "Unicode");
    assert.equal(config.get("glyphStyle"), "unicode");
  });

  it("indents prose subsettings under their master setting", () => {
    const dependent = FIELDS.filter((field) => field.activityOption);
    assert.equal(dependent.length, 2);
    for (const field of dependent) assert.match(field.label, /^  \S/, field.key);
    assert.doesNotMatch(FIELDS.find((field) => field.key === "foldIntermediateActivity")!.label, /^\s/);
  });

  it("shows prose options only while prose folding is active", () => {
    assert.equal(items(DEFAULTS).some((item) => item.id === "foldActivityOnFinalAnswer"), false);
    const rendered = items({ ...DEFAULTS, foldIntermediateActivity: true, activitySummary: "tools" });
    const byId = new Map(rendered.map((item) => [item.id, item]));
    assert.equal(byId.get("foldActivityOnFinalAnswer")?.currentValue, "off");
    assert.equal(byId.get("activitySummary")?.currentValue, "tools used");
    assert.deepEqual(byId.get("activitySummary")?.values, ["elapsed time", "tools used"]);
  });

  it("shows every visible row without scrolling", () => {
    const list = screen(new Config(DEFAULTS));
    assert.equal(list.maxVisible, list.items.length);
  });

  it("shows a live-change and output hint under the settings list", () => {
    const component = createConfigScreen({
      SettingsList: FakeSettingsList as never,
      theme: { hint: (text: string) => text } as never,
      config: new Config(DEFAULTS),
      onChange: () => {},
      onClose: () => {},
    });
    assert.match(component.render(80).at(-1)!, /Changes apply live · Ctrl\+O reveals tool output/);
    assert.ok(visibleWidth(component.render(20).at(-1)!) <= 20);
  });
});

describe("presets in the config screen", () => {
  it("puts the Preset row first and cycles all five presets", () => {
    const first = items(DEFAULTS)[0];
    assert.equal(first.id, "preset");
    assert.equal(first.currentValue, "custom");
    assert.deepEqual(first.values, ["off", "lite", "full", "max", "custom"]);
  });

  it("switching preset keeps the user's own keys and shows the preset's look keys", () => {
    const config = new Config({ ...DEFAULTS, groupToolRuns: true, gutter: false });
    const changes: [string, unknown][] = [];
    screen(config, (k, v) => changes.push([k, v])).onChange("preset", "lite");
    assert.deepEqual(changes, [["preset", "lite"]]);
    assert.equal(config.get("groupToolRuns"), false);
    assert.equal(config.get("gutter"), false, "not a look key: the user's value stays");
    screen(config).onChange("preset", "custom");
    assert.equal(config.get("groupToolRuns"), true);
  });

  it("greys only the four look rows under a preset: activating one changes nothing", () => {
    const config = new Config({ ...DEFAULTS, preset: "lite", groupToolRuns: true, timer: false });
    const changes: unknown[] = [];
    const list = screen(config, (k, v) => changes.push([k, v]));
    const group = list.items.find((item) => item.id === "groupToolRuns")!;
    assert.deepEqual(group.values, [group.currentValue]);
    assert.match(group.description ?? "", /Set by the 'lite' preset.*custom/);
    list.onChange("groupToolRuns", group.currentValue);
    assert.deepEqual(changes, []);
    assert.equal(config.get("groupToolRuns"), false);
    for (const id of ["timer", "gutter", "glyphStyle", "keepActiveToolsExpanded"]) {
      assert.ok(list.items.find((item) => item.id === id)!.values!.length > 1, id);
    }
    list.onChange("timer", "on");
    assert.deepEqual(changes, [["timer", true]]);
  });

  it("shows the generic footer, with no Restore defaults row", () => {
    const component = createConfigScreen({
      SettingsList: FakeSettingsList as never,
      theme: { hint: (text: string) => text } as never,
      config: new Config({ ...DEFAULTS, preset: "full" }),
      onChange: () => {},
      onClose: () => {},
    });
    assert.match(component.render(200).at(-1)!, /Changes apply live/);
    assert.equal(FakeSettingsList.last!.items.some((item) => /restore/i.test(item.label)), false);
  });

  it("status marks preset-controlled rows", () => {
    assert.match(summary(new Config({ ...DEFAULTS, preset: "lite" }).all()), /Preset\s+lite\n[^\n]*\(from preset\)/);
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

  it("reports boolean and summary changes to its caller", () => {
    const changes: [string, unknown][] = [];
    const list = screen(new Config({ ...DEFAULTS, foldIntermediateActivity: true }), (key, value) =>
      changes.push([key, value]),
    );

    list.onChange("groupToolRuns", "on");
    list.onChange("activitySummary", "tools used");
    assert.deepEqual(changes, [["groupToolRuns", true], ["activitySummary", "tools"]]);
  });

  it("adds dependent rows immediately when prose folding turns on", () => {
    const config = new Config(DEFAULTS);
    screen(config).onChange("foldIntermediateActivity", "on");
    assert.equal(config.get("foldIntermediateActivity"), true);
    assert.ok(FakeSettingsList.last?.items.some((item) => item.id === "foldActivityOnFinalAnswer"));
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
  it("lists every visible setting with its state and where to find the rest", () => {
    const text = summary({ ...DEFAULTS, groupToolRuns: true });
    for (const field of FIELDS.filter((field) => !field.activityOption)) {
      assert.ok(text.includes(field.label), field.key);
    }
    assert.ok(!text.includes("Collapse when final answer starts"));
    assert.match(text, /Combine consecutive tool calls\s+on/);
    assert.match(text, /Elapsed timer\s+on/);
    assert.match(text, /Symbols\s+Unicode/);
    // `/minimalist status` should point at both the editor and the JSON-only keys.
    assert.ok(text.includes("/minimalist          change these"));
    assert.ok(text.includes("settings.json"));
  });
});

describe("argumentCompletions", () => {
  it("suggests `config` and `status`, filtered by prefix", () => {
    const empty = argumentCompletions("");
    assert.deepEqual(empty?.map(({ value }) => value), ["config", "status"]);
    assert.ok(empty?.every((item) => item.description), "the suggestion menu shows descriptions");

    assert.deepEqual(argumentCompletions("con")?.map(({ value }) => value), ["config"]);
    assert.deepEqual(argumentCompletions("sta")?.map(({ value }) => value), ["status"]);
    assert.equal(argumentCompletions("x"), null, "no match means no menu");
  });
});
