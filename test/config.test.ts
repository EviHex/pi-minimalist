import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { BASIC_KEYS, Config, DEFAULTS, DEFAULT_BASIC, PRESETS } from "../src/config.ts";
import {
  agentDir,
  customSeed,
  hasComments,
  loadSettings,
  saveBasicSettings,
  stripJsonComments,
} from "../src/config-file.ts";

/** Isolated fake agent dir + project dir, so no test touches real settings. */
function sandbox(): { env: NodeJS.ProcessEnv; cwd: string; settingsPath: string } {
  const root = mkdtempSync(join(tmpdir(), "pi-minimalist-config-"));
  const agent = join(root, "agent");
  const cwd = join(root, "project");
  mkdirSync(agent, { recursive: true });
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  return {
    env: { PI_CODING_AGENT_DIR: agent } as NodeJS.ProcessEnv,
    cwd,
    settingsPath: join(agent, "settings.json"),
  };
}

describe("agentDir", () => {
  it("honours PI_CODING_AGENT_DIR", () => {
    // Hardcoding ~/.pi/agent would write settings where Pi never reads them back.
    assert.equal(agentDir({ PI_CODING_AGENT_DIR: "/custom/dir" } as NodeJS.ProcessEnv), "/custom/dir");
  });

  it("falls back to ~/.pi/agent", () => {
    assert.match(agentDir({} as NodeJS.ProcessEnv), /\.pi\/agent$/);
  });
});

describe("stripJsonComments", () => {
  it("removes line and block comments", () => {
    assert.equal(JSON.parse(stripJsonComments('{"a":1 /* keep out */, "b":2 // trailing\n}')).b, 2);
  });

  it("leaves // inside strings alone", () => {
    // The subtle case: a URL or a path must not start a comment.
    const parsed = JSON.parse(stripJsonComments('{"url":"https://example.com//x"}'));
    assert.equal(parsed.url, "https://example.com//x");
  });

  it("keeps comment markers after an escaped quote inside a string", () => {
    const parsed = JSON.parse(stripJsonComments('{"a":"say \\"hi\\" // not a comment", "b":2 // real\n}'));
    assert.equal(parsed.a, 'say "hi" // not a comment');
    assert.equal(parsed.b, 2);
  });

  it("detects comments without altering comment-free files", () => {
    assert.equal(hasComments('{"url":"https://a//b"}'), false);
    assert.equal(hasComments('{"a":1} // note'), true);
  });
});

describe("loadSettings", () => {
  it("returns defaults when nothing is configured", () => {
    const { env } = sandbox();
    assert.deepEqual(loadSettings(env), { ...DEFAULTS, preset: "full" });
    assert.equal(loadSettings(env).groupToolRuns, true, "consecutive calls combine by default");
  });

  it("preserves an explicit preference to keep tool calls separate", () => {
    const { env, settingsPath } = sandbox();
    writeFileSync(settingsPath, JSON.stringify({ minimalist: { groupToolRuns: false } }));
    assert.equal(loadSettings(env).groupToolRuns, false);
  });

  it("reads global settings and ignores project-local minimalist blocks", () => {
    const { env, cwd, settingsPath } = sandbox();
    writeFileSync(settingsPath, JSON.stringify({ minimalist: { gutter: false, timer: false } }));
    const project = join(cwd, ".pi", "settings.json");
    const original = JSON.stringify({ minimalist: { timer: true, groupToolRuns: false } });
    writeFileSync(project, original);

    const settings = loadSettings(env);
    assert.equal(settings.gutter, false);
    assert.equal(settings.timer, false, "project does not override global");
    assert.equal(settings.groupToolRuns, true, "project-only values do not apply");
    assert.equal(readFileSync(project, "utf8"), original, "project settings are not migrated or deleted");
  });

  it("survives malformed JSON and ignores wrongly-typed fields", () => {
    const { env, settingsPath } = sandbox();
    writeFileSync(settingsPath, "{ this is not json");
    assert.deepEqual(loadSettings(env), { ...DEFAULTS, preset: "full" }, "a syntax error must never break the UI");

    // One bad value must not discard the whole block: this file is hand-edited.
    writeFileSync(settingsPath, JSON.stringify({ minimalist: { gutter: "yes", timer: false } }));
    const settings = loadSettings(env);
    assert.equal(settings.gutter, true, "bad type falls back to the default");
    assert.equal(settings.timer, false, "good value in the same block still applies");
  });

  it("accepts the prose summary enum and rejects unknown values", () => {
    const { env, settingsPath } = sandbox();
    writeFileSync(settingsPath, JSON.stringify({ minimalist: { activitySummary: "tools" } }));
    assert.equal(loadSettings(env).activitySummary, "tools");

    writeFileSync(settingsPath, JSON.stringify({ minimalist: { activitySummary: "verbose" } }));
    assert.equal(loadSettings(env).activitySummary, "elapsed");
  });

  it("accepts a settings.json containing comments", () => {
    const { env, settingsPath } = sandbox();
    writeFileSync(settingsPath, '{\n  // my preference\n  "minimalist": { "gutter": false }\n}');
    assert.equal(loadSettings(env).gutter, false);
  });
});

describe("saveBasicSettings", () => {
  it("writes only the minimalist key and preserves everything else", () => {
    const { env, settingsPath } = sandbox();
    writeFileSync(settingsPath, JSON.stringify({ theme: "dark", extensions: ["a"] }, null, 2));

    assert.deepEqual(saveBasicSettings({ groupToolRuns: true }, env), { ok: true });
    const written = JSON.parse(readFileSync(settingsPath, "utf8"));
    assert.equal(written.theme, "dark", "unrelated keys survive");
    assert.deepEqual(written.extensions, ["a"]);
    assert.deepEqual(written.minimalist, { preset: "full", groupToolRuns: true }, "first write pins the fresh preset, then only its key");
    assert.equal(loadSettings(env).groupToolRuns, true, "the custom agent dir is read back");
  });

  it("never writes advanced keys, so a hand-edited glyph map survives", () => {
    const { env, settingsPath } = sandbox();
    writeFileSync(settingsPath, JSON.stringify({ minimalist: {
      glyphs: { done: "OK" }, excludeTools: ["x"], glyphStyle: "ascii", groupToolRuns: true,
    } }));

    saveBasicSettings({ timer: false }, env);
    const written = JSON.parse(readFileSync(settingsPath, "utf8"));
    assert.deepEqual(written.minimalist.glyphs, { done: "OK" }, "glyphs are JSON-only and untouched");
    assert.deepEqual(written.minimalist.excludeTools, ["x"]);
    assert.equal(written.minimalist.timer, false);
    assert.equal(written.minimalist.groupToolRuns, true, "unrelated basic value remains unchanged");
    assert.equal(written.minimalist.glyphStyle, "ascii", "Symbols remains unchanged");
  });

  it("writes excludeTools from the picker and leaves the glyph map alone", () => {
    const { env, settingsPath } = sandbox();
    writeFileSync(settingsPath, JSON.stringify({ minimalist: { glyphs: { done: "OK" }, excludeTools: ["x"], timer: false } }));

    assert.deepEqual(saveBasicSettings({ excludeTools: ["subagent"] }, env), { ok: true });
    const written = JSON.parse(readFileSync(settingsPath, "utf8"));
    assert.deepEqual(written.minimalist.excludeTools, ["subagent"]);
    assert.deepEqual(written.minimalist.glyphs, { done: "OK" });
    assert.equal(written.minimalist.timer, false);
    assert.deepEqual(loadSettings(env).excludeTools, ["subagent"]);

    assert.deepEqual(saveBasicSettings({ excludeTools: [] }, env), { ok: true });
    assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")).minimalist.excludeTools, [], "an empty list is written, not dropped");
  });

  it("refuses malformed global settings rather than overwriting them", () => {
    const { env, settingsPath } = sandbox();
    for (const original of ['{"minimalist":', '{"minimalist": false}']) {
      writeFileSync(settingsPath, original);
      const result = saveBasicSettings({ timer: false }, env);
      assert.equal(result.ok, false);
      assert.equal(result.ok ? undefined : result.reason, "unparsable");
      assert.equal(readFileSync(settingsPath, "utf8"), original);
    }
  });

  it("REFUSES to write a file with comments instead of deleting them", () => {
    const { env, settingsPath } = sandbox();
    const original = '{\n  // keep me\n  "theme": "dark"\n}';
    writeFileSync(settingsPath, original);

    const result = saveBasicSettings({ timer: false }, env);
    assert.deepEqual(
      { ok: result.ok, reason: result.ok ? undefined : result.reason },
      { ok: false, reason: "comments" },
    );
    // JSON.stringify would silently destroy the comment, which is worse than
    // asking the user to edit one line by hand.
    assert.equal(readFileSync(settingsPath, "utf8"), original, "file must be untouched");
  });
});

describe("Config", () => {
  it("resolves glyph presets with per-glyph overrides", () => {
    const config = new Config({ ...DEFAULTS, glyphStyle: "ascii", glyphs: { done: "OK" } });
    const glyphs = config.glyphs();
    assert.equal(glyphs.done, "OK", "explicit override wins");
    assert.equal(glyphs.failed, "x", "rest comes from the preset");
    // Every ASCII glyph must be single-width or rows misalign.
    for (const [key, value] of Object.entries(new Config({ ...DEFAULTS, glyphStyle: "ascii" }).glyphs())) {
      assert.ok(value.length <= 1, `${key} must be at most one column, got ${JSON.stringify(value)}`);
    }
  });

  it("treats the exclusion list as the only exemption", () => {
    assert.equal(new Config(DEFAULTS).compacts("subagent"), true);
    assert.equal(new Config(DEFAULTS).compacts("read"), true);
    assert.equal(new Config({ ...DEFAULTS, excludeTools: ["subagent"] }).compacts("subagent"), false);
    assert.equal(new Config({ ...DEFAULTS, compactToolRows: false }).compacts("read"), false);
  });

  it("clears previous session overrides after a successful reset", () => {
    const config = new Config(DEFAULTS);
    config.setSessionOverride("groupToolRuns", true);
    config.setSessionOverride("glyphStyle", "ascii");
    for (const key of BASIC_KEYS) {
      config.set(key, DEFAULT_BASIC[key]);
      config.clearSessionOverride(key);
    }
    config.replace(DEFAULTS);
    assert.equal(config.get("groupToolRuns"), DEFAULT_BASIC.groupToolRuns);
    assert.equal(config.get("glyphStyle"), "unicode");
  });

  it("keeps session overrides across a settings re-read", () => {
    // REGRESSION: settings are re-read every turn so external edits apply
    // without a restart. A change that could not be persisted was therefore
    // reverted on the next turn, while the UI still said it had been applied.
    const config = new Config(DEFAULTS);
    config.setSessionOverride("groupToolRuns", true);
    config.replace({ ...DEFAULTS, gutter: false });

    assert.equal(config.get("groupToolRuns"), true, "override survives the re-read");
    assert.equal(config.get("gutter"), false, "fresh file values still apply");

    config.clearSessionOverride("groupToolRuns");
    config.replace(DEFAULTS);
    assert.equal(config.get("groupToolRuns"), DEFAULT_BASIC.groupToolRuns, "cleared override yields to the file");
  });
});

describe("presets", () => {
  const user = { ...DEFAULTS, groupToolRuns: false, gutter: false, excludeTools: ["x"] };

  it("layer user keys < preset look keys", () => {
    const off = new Config({ ...user, preset: "off" });
    assert.equal(off.get("compactToolRows"), false);
    assert.equal(off.get("groupToolRuns"), false);
    assert.equal(off.get("gutter"), false);
    assert.deepEqual(off.get("excludeTools"), ["x"]);
    assert.equal(new Config({ ...user, preset: "lite" }).get("groupToolRuns"), false);
    assert.equal(new Config({ ...user, preset: "full" }).get("thinkingAsToolCall"), true);
    const max = new Config({ ...user, preset: "max" });
    assert.equal(max.get("foldIntermediateActivity"), true);
    assert.equal(max.get("thinkingAsToolCall"), true);
    assert.equal(max.compacts("read"), true);
    assert.equal(off.compacts("read"), false);
  });

  it("an existing minimalist block without a preset key stays custom and uses the user's own keys", () => {
    const { env, settingsPath } = sandbox();
    writeFileSync(settingsPath, JSON.stringify({ minimalist: { gutter: false } }));
    const settings = loadSettings(env);
    assert.equal(settings.preset, "custom");
    assert.equal(new Config(settings).get("gutter"), false);
    assert.equal(new Config({ ...user, preset: "custom" }).get("groupToolRuns"), false);
  });

  it("a fresh install (no minimalist block, or no basic key) gets the full preset", () => {
    const { env, settingsPath } = sandbox();
    assert.equal(loadSettings(env).preset, "full");
    writeFileSync(settingsPath, JSON.stringify({ minimalist: { excludeTools: [] } }));
    assert.equal(loadSettings(env).preset, "full");
    assert.equal(new Config(loadSettings(env)).get("thinkingAsToolCall"), true);
  });

  it("the first write pins the fresh preset so the file does not turn custom", () => {
    const { env, settingsPath } = sandbox();
    assert.deepEqual(saveBasicSettings({ gutter: false }, env), { ok: true });
    assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")).minimalist, { preset: "full", gutter: false });
    assert.equal(loadSettings(env).preset, "full");
  });

  it("a preset names only the four look keys and leaves other settings alone", () => {
    const c = new Config({ ...DEFAULTS, preset: "max", gutter: false, glyphStyle: "ascii" });
    assert.equal(c.get("gutter"), false);
    assert.equal(c.get("glyphStyle"), "ascii");
    assert.equal(c.get("foldIntermediateActivity"), true);
  });

  it("the first switch to custom seeds the lite look; own look keys are kept", () => {
    const { env, settingsPath } = sandbox();
    assert.deepEqual(customSeed(env), PRESETS.lite);
    writeFileSync(settingsPath, JSON.stringify({ minimalist: { gutter: false } }));
    assert.deepEqual(customSeed(env), PRESETS.lite);
    writeFileSync(settingsPath, JSON.stringify({ minimalist: { preset: "full", groupToolRuns: true } }));
    assert.equal(customSeed(env), undefined);
  });

  it("reads a valid preset, ignores an invalid one, and saving it leaves other keys alone", () => {
    const { env, settingsPath } = sandbox();
    writeFileSync(settingsPath, JSON.stringify({ minimalist: { preset: "bogus", gutter: false } }));
    assert.equal(loadSettings(env).preset, "custom");
    assert.deepEqual(saveBasicSettings({ preset: "lite" }, env), { ok: true });
    assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")).minimalist, { preset: "lite", gutter: false });
    assert.equal(loadSettings(env).preset, "lite");
  });
});
