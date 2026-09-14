/** Small user preference file; intentionally outside this extension's jj repo. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const QUIET_STATE_PATH = join(homedir(), ".pi", "agent", "pi-minimalist.json");

type QuietState = { quiet?: unknown };

/** Bad or missing state means the safe default: detailed tool rows. */
export function loadQuietEnabled(path = QUIET_STATE_PATH): boolean {
  try {
    return (JSON.parse(readFileSync(path, "utf8")) as QuietState).quiet === true;
  } catch {
    return false;
  }
}

export function saveQuietEnabled(enabled: boolean, path = QUIET_STATE_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ quiet: enabled }, null, 2)}\n`);
}
