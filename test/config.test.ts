import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Config, DEFAULTS } from "../src/config.ts";
import {
  agentDir,
  hasComments,
  loadSettings,
  migratedQuiet,
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
    // The old code hardcoded ~/.pi/agent, so anyone using this variable had
    // their /quiet preference written where it would never be read back.
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

  it("detects comments without altering comment-free files", () => {
    assert.equal(hasComments('{"url":"https://a//b"}'), false);
    assert.equal(hasComments('{"a":1} // note'), true);
  });
});

describe("loadSettings", () => {
  it("returns defaults when nothing is configured", () => {
    const { env, cwd } = sandbox();
    assert.deepEqual(loadSettings(cwd, env), DEFAULTS);
  });

  it("reads the minimalist key and lets project settings win", () => {
    const { env, cwd, settingsPath } = sandbox();
    writeFileSync(settingsPath, JSON.stringify({ minimalist: { gutter: false, timer: false } }));
    writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({ minimalist: { timer: true } }));

    const settings = loadSettings(cwd, env);
    assert.equal(settings.gutter, false, "global value applies");
    assert.equal(settings.timer, true, "project overrides global");
  });

  it("survives malformed JSON and ignores wrongly-typed fields", () => {
    const { env, cwd, settingsPath } = sandbox();
    writeFileSync(settingsPath, "{ this is not json");
    assert.deepEqual(loadSettings(cwd, env), DEFAULTS, "a syntax error must never break the UI");

    // One bad value must not discard the whole block: this file is hand-edited.
    writeFileSync(settingsPath, JSON.stringify({ minimalist: { gutter: "yes", timer: false } }));
    const settings = loadSettings(cwd, env);
    assert.equal(settings.gutter, true, "bad type falls back to the default");
    assert.equal(settings.timer, false, "good value in the same block still applies");
  });

  it("accepts the prose summary enum and rejects unknown values", () => {
    const { env, cwd, settingsPath } = sandbox();
    writeFileSync(settingsPath, JSON.stringify({ minimalist: { activitySummary: "tools" } }));
    assert.equal(loadSettings(cwd, env).activitySummary, "tools");

    writeFileSync(settingsPath, JSON.stringify({ minimalist: { activitySummary: "verbose" } }));
    assert.equal(loadSettings(cwd, env).activitySummary, "elapsed");
  });

  it("accepts a settings.json containing comments", () => {
    const { env, cwd, settingsPath } = sandbox();
    writeFileSync(settingsPath, '{\n  // my preference\n  "minimalist": { "gutter": false }\n}');
    assert.equal(loadSettings(cwd, env).gutter, false);
  });
});

describe("saveBasicSettings", () => {
  it("writes only the minimalist key and preserves everything else", () => {
    const { env, settingsPath } = sandbox();
    writeFileSync(settingsPath, JSON.stringify({ theme: "dark", extensions: ["a"] }, null, 2));

    assert.deepEqual(saveBasicSettings({ ...DEFAULTS, groupToolRuns: true }, env), { ok: true });
    const written = JSON.parse(readFileSync(settingsPath, "utf8"));
    assert.equal(written.theme, "dark", "unrelated keys survive");
    assert.deepEqual(written.extensions, ["a"]);
    assert.equal(written.minimalist.groupToolRuns, true);
  });

  it("never writes advanced keys, so a hand-edited glyph map survives", () => {
    const { env, settingsPath } = sandbox();
    writeFileSync(settingsPath, JSON.stringify({ minimalist: { glyphs: { done: "OK" }, excludeTools: ["x"] } }));

    saveBasicSettings({ ...DEFAULTS, timer: false }, env);
    const written = JSON.parse(readFileSync(settingsPath, "utf8"));
    assert.deepEqual(written.minimalist.glyphs, { done: "OK" }, "glyphs are JSON-only and untouched");
    assert.deepEqual(written.minimalist.excludeTools, ["x"]);
    assert.equal(written.minimalist.timer, false);
  });

  it("REFUSES to write a file with comments instead of deleting them", () => {
    const { env, settingsPath } = sandbox();
    const original = '{\n  // keep me\n  "theme": "dark"\n}';
    writeFileSync(settingsPath, original);

    const result = saveBasicSettings({ ...DEFAULTS, timer: false }, env);
    assert.deepEqual(
      { ok: result.ok, reason: result.ok ? undefined : result.reason },
      { ok: false, reason: "comments" },
    );
    // JSON.stringify would silently destroy the comment, which is worse than
    // asking the user to edit one line by hand.
    assert.equal(readFileSync(settingsPath, "utf8"), original, "file must be untouched");
  });
});

describe("migratedQuiet", () => {
  it("adopts the legacy /quiet preference once", () => {
    const { env } = sandbox();
    writeFileSync(join(agentDir(env), "pi-minimalist.json"), JSON.stringify({ quiet: true }));
    assert.equal(migratedQuiet(env), true);
  });

  it("never overrides an explicit setting", () => {
    const { env, settingsPath } = sandbox();
    writeFileSync(join(agentDir(env), "pi-minimalist.json"), JSON.stringify({ quiet: true }));
    writeFileSync(settingsPath, JSON.stringify({ minimalist: { groupToolRuns: false } }));
    // Otherwise a stale legacy file would resurrect a preference the user has
    // since turned off.
    assert.equal(migratedQuiet(env), undefined);
  });

  it("returns undefined with no legacy file", () => {
    assert.equal(migratedQuiet(sandbox().env), undefined);
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
    assert.equal(new Config(DEFAULTS).isExcluded("subagent"), true);
    assert.equal(new Config(DEFAULTS).isExcluded("read"), false);
    assert.equal(new Config({ ...DEFAULTS, excludeTools: [] }).isExcluded("subagent"), false);
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
    assert.equal(config.get("groupToolRuns"), false, "cleared override yields to the file");
  });
});
