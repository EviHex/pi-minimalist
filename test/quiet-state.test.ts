import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { loadQuietEnabled, saveQuietEnabled } from "../src/quiet-state.ts";

describe("quiet state", () => {
  it("defaults to disabled for missing or invalid state", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-minimalist-"));
    const path = join(dir, "state.json");
    try {
      assert.equal(loadQuietEnabled(path), false);
      writeFileSync(path, "not json");
      assert.equal(loadQuietEnabled(path), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes and reloads the quiet toggle", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-minimalist-"));
    const path = join(dir, "nested", "state.json");
    try {
      saveQuietEnabled(true, path);
      assert.equal(loadQuietEnabled(path), true);
      saveQuietEnabled(false, path);
      assert.equal(loadQuietEnabled(path), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
