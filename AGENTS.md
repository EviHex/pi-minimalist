# pi-minimalist — Agent Notes

One home for all Pi UI simplification. Three features, one folder, one patch
script. Formerly two extensions: `compact-tool-renderer` and
`footer-status-manager` (both deleted after the merge — do not recreate them).

## Features

### 1. Compact tool renderer

```text
✓ read src/a.ts
✓ bash go test ./...
✓ toolcall ask_user_question
✓ toolcall goland__execute_tool
```

Collapsed view hides tool output. `Ctrl+O` / `Cmd+O` expands the original
output. Each collapsed call is exactly one terminal line: long paths/commands
truncate using the real viewport width instead of wrapping.

### 2. Collapsed thinking preview

Hidden thinking blocks (`Ctrl+T`) show `✓ think <preview>` on one line
(non-italic; `think` in success green, preview in `toolTitle`), instead of the
bare "Thinking..." label. While the model streams thinking it shows
`• think …` with a `toolPendingBg` row highlight, flipping to `✓` on
completion. Expanded view keeps Pi's native italic markdown.

### 3. Footer status manager

Extensions advertise state via `ctx.ui.setStatus(key, text)` — polyglot,
caveman, ponytail, MCP adapters, JetBrains MCP, etc. Commands:

- `/footer` — interactive dialog (ctx.ui.custom): ↑↓/jk move, space toggles
  hidden ↔ visible (persists immediately), s/Enter/Esc closes.
- `/footer <key>` — direct toggle, no dialog. The key autocompletes: Pi
  calls the command's `getArgumentCompletions(argumentPrefix)` hook, and we
  offer every status key (hidden ones described as such).

Hidden keys persist in `hidden.json` next to `index.ts`.

## Files

- `index.ts` — the whole extension, heavily commented (user is not a TS expert).
- `patch-pi.sh` — idempotent script re-applying all core bridges after a Pi update.
- `hidden.json` — persisted hidden footer-status keys (created on first toggle).

(`/footer-statuses`, a sticky-widget variant of the viewer, was removed —
the /footer dialog already shows everything.)
- `AGENTS.md` — this file.

Global Pi setting enables this directory:

```json
"+extensions/pi-minimalist"
```

## Architecture

Pi supports per-tool `renderCall`, `renderResult`, `renderShell` and
`ctx.ui.setStatus`, but has no public global/default renderer API, no
thinking-renderer hook, and no way to list or selectively hide footer
statuses. All three features therefore use the same two-layer pattern:

1. **Normal extension code** does everything possible via public API.
2. **Small local Pi core bridges** (patch-pi.sh) make core consult
   process-global symbols; ALL styling/behavior lives in `index.ts` so
   `/reload` refreshes it without touching core.

Bridge symbols registered by the extension (the statusTap branch ALSO purges
any already-stored value via `setExtensionStatus(key, undefined)` before
returning — without that, a status set before the tap registered would only
disappear on its next update, so hiding appeared to do nothing):

- `Symbol.for("pi.defaultToolRenderer")` → `{ renderShell: "self", renderCall, renderResult }`
- `Symbol.for("pi.thinkingPreview")` → `(text, theme, pad, isStreaming) => Component`
- `Symbol.for("pi.statusTap")` → `(key, text) => boolean` (true = hide from footer)

Plus one context exposure: `ctx.ui.getExtensionStatuses()` (read-only map of
live statuses, covers ones set before this extension loaded).

### Renderer details

Renderer priority: tool's explicit renderer → global compact fallback →
Pi native fallback. MCP tools with no renderer get one compact borderless
line prefixed with `toolcall`.

Action labels are colored per category via `actionColor()`: read-only tools
(`read`, `grep`, `find`, `ls`) and generic `toolcall` use `success`; mutating
tools (`edit`, `write`) and `bash` use `warning`. Paths, commands, and
concrete tool names use `toolTitle`. Status glyphs are all `success` green
except failures: queued caret `›`, running dot `•`, completed `✓`, failed `✗`
= `error`. "Finished" keys off `!context.isPartial`, not `executionStarted`:
session replay (restart with history) never calls `markExecutionStarted()`,
so keying off it made every historical tool show as queued after a restart.
Elapsed seconds `[⏱ Ns]` in success green sit immediately after the action
word (e.g. `bash [⏱ 3s] go test ./...`). While running, the whole row gets a
`toolPendingBg` background highlight that disappears once the tool finishes,
and `CompactLine.startTicker()` fires once per second calling `context.invalidate()`
so the timer advances even for silent commands with no streaming output. Plain
`ui.requestRender()` would only repaint the cached line (elapsed is baked into the
text during updateDisplay → renderCall); invalidate re-runs updateDisplay, which
recomputes it. The async ticker is safe — the documented recursion bug was
synchronous invalidate DURING render. The ticker stops at the terminal state and
is `unref()`d so it never holds the process open. Tool rows have no background
highlight while executing (removed at user request — the timer already signals
activity).

## Local Pi Core Bridges

Patched into both installed runtime forms (the bundle is what `pi` executes;
the unbundled files are patched for consistency):

```text
/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/tool-execution.js
/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/assistant-message.js
/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js
/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/chunks/chunk-JVUZSMYM.js
```

The script patches exactly these bridges:

1. `getRenderShell()` — use the global fallback `renderShell` when a tool has
   neither `renderCall` nor `renderResult`.
2. `createCallFallback()` — ask the global renderer first, else Pi native fallback.
3. `createResultFallback()` — ask the global renderer first; returning
   `undefined` delegates to Pi native fallback.
4. `getRenderContext()` — expose `ui: this.ui` so the elapsed timer can repaint live.
5. `assistant-message.js` — collapsed thinking blocks call
   `globalThis[Symbol.for("pi.thinkingPreview")]` (falls back to the native
   "Thinking..." label when unregistered).
6. `interactive-mode.js` — `setExtensionStatus` consults
   `globalThis[Symbol.for("pi.statusTap")]` first (true = swallow → hidden
   from footer), and `createExtensionUIContext()` exposes
   `getExtensionStatuses: () => this.footerDataProvider.getExtensionStatuses()`.

### Upgrade warning

A Pi upgrade overwrites the patched core files. Symptom: built-ins stay
compact, but MCP/third-party tools return to verbose cards, thinking blocks
show the bare "Thinking..." label, and footer hiding stops working.

Fix: re-run the idempotent patch script after every Pi update:

```bash
~/.pi/agent/extensions/pi-minimalist/patch-pi.sh
```

Safe to run repeatedly (exact marker strings detect already-applied bridges
and skip them); syntax-checks all patched files before finishing. After
patching, fully restart Pi once.

If the script ever fails to match (Pi changed its internals), search the new
files for:

```text
getRenderShell
createCallFallback
createResultFallback
getRenderContext
thinkingVisibilityOverrides
setExtensionStatus
setStatus:(key,text)
```

hand-apply the same edits, then update the script's perl patterns.

## Reload Semantics

- After changing any Pi core bridge: fully quit and restart Pi once.
  `/reload` cannot reload already-cached core modules.
- After that, edits to `index.ts` are hot-reloadable with `/reload`.
- Reload while Pi is idle. Avoid reloading during a running tool or open
  questionnaire overlay.
- Each reload overwrites the process-global renderer slots with the newest
  versions. Do **not** clear them from `session_shutdown`: reload ordering can
  let an old shutdown hook erase the newly installed renderer, reverting MCP
  tools to boxed output. Process exit clears globalThis naturally.
- If the extension is disabled, restart Pi once to clear its globals.

## Important Gotchas

### Do not call runtime actions during extension loading

`pi.getActiveTools()` and similar action methods throw:

```text
Extension runtime not initialized. Action methods cannot be called during extension loading.
```

That is why `selectedTools()` reads CLI arguments instead.

### Register built-in overrides during extension loading

Do not move `pi.registerTool()` into `session_start`; registration there is
too late for reliable built-in replacement.

### Do not invalidate synchronously inside renderers

Never call `context.invalidate()` from `renderCall` or `renderResult`. An
earlier version did this and recursively re-entered rendering. Pi caught the
exception and silently displayed its verbose fallback. Read
`context.executionStarted`, `context.isPartial`, `context.isError` instead.

### Preserve original execution and expanded rendering

Keep `...tool`; it carries native `execute`, schema, description. Keep
delegation to `originalRenderResult` for expanded built-in output, including
syntax highlighting and edit diffs.

### Footer status tap ordering

`pi.statusTap` only sees setStatus calls made AFTER it registers. Other
extensions (MCP adapters etc.) may load first and set statuses earlier, so
`currentStatuses()` and `getArgumentCompletions` both merge the live map via
the `getExtensionStatuses` bridge (ctx.ui cached on first use + session_start).
Never call `ctx.ui.setStatus` inside the tap callback (infinite loop).

### ui.select takes plain strings

`ctx.ui.select(title, string[])` returns the exact chosen string (or
undefined on Esc). Objects as options will not work; match the returned
label back to a key via a Map (see `/footer` handler).

### Avoid duplicate renderer packages

`pi-collapse-tools` was removed from active packages because it overrides the
same built-ins. Do not enable both unless testing load-order conflicts.

## Validation

Fast startup/syntax check:

```bash
pi --list-models >/dev/null
```

Core bundle syntax checks:

```bash
node --check /opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/chunks/chunk-JVUZSMYM.js
node --check /opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/tool-execution.js
node --check /opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/assistant-message.js
node --check /opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/interactive-mode.js
```

Patch script self-check (idempotent, safe anytime):

```bash
~/.pi/agent/extensions/pi-minimalist/patch-pi.sh
```

Interactive checks after restart/reload:

1. Read a file: expect one line `✓ read path`, no output, no blank row after it.
   Bash rows truncate the command at 100 chars while collapsed; when expanded
   (Ctrl+O) the call line shows the full command (viewport width still applies).
2. Read a very long path in a narrow terminal: expect one line ending in `…`, never wrapping.
3. Run several tools consecutively: expect one-line rows, each preceded by a single blank line.
4. Run an unrendered MCP/IDE tool: expect `✓ toolcall tool_name`.
5. Run bash: while running, expect `• bash [⏱ Ns] <cmd>` with dark `toolPendingBg`
   background; the elapsed counter updates on repaints but can freeze on silent commands.
6. Press `Ctrl+O` / `Cmd+O`: expect full original output.
7. Trigger an error: expect red `✗`.
8. Toggle thinking collapsed (`Ctrl+T`): expect `• think …` (highlighted) while
   streaming, `✓ think <preview>` when done.
9. `/footer ` (trailing space) → autocomplete panel lists every status key.
10. `/footer` → select a noisy status → it disappears from the footer;
    select again → reappears.
11. Restart Pi → hidden choices survived (`hidden.json`).

## Scope

Keep implementation small. No config format, package.json, dependency,
abstraction layer, or test framework unless a real requirement appears. This
extension uses only Pi's installed packages and Node standard library.

User's powerline-footer extension (npm:pi-powerline-footer) is SEPARATE and
must keep working: this extension only taps statuses before they reach
powerline's `extension_statuses` segment; powerline's own config
(`settings.json` → `powerline`) remains the place for segment layout.
