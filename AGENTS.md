# pi-minimalist — Agent Notes

One home for all Pi UI simplification. Compact tools (including quiet mode),
thinking preview, one folder, one patch script. Formerly the `compact-tool-renderer` extension (deleted after the merge —
do not recreate it).

## Features

### 0. Required settings

`~/.pi/agent/settings.json` keeps `"defaultTools": ["read", "bash", "edit", "write"]`
as Pi's enabled-tool policy. The extension's render-only bridge recognizes all
seven native names (`read/bash/edit/write/grep/find/ls`) but only renders tools
Pi actually enables and invokes.

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

`/quiet` toggles low-noise run folding. A consecutive completed run composed
only of `read/edit/write/grep/find/ls/bash/toolcall/think` becomes one final summary
line, e.g. `✓ read ×2, edit ×1`; every other row in that run renders zero lines.
Rendererless MCP/third-party calls all use the `toolcall` category. Completed,
collapsed thinking blocks share this run and summarize as `think ×N`.
Queued/running calls, expanded thinking/tools, and assistant prose break a run
and stay visible. Failed completed calls remain in their run: successful counts
stay green and failures become a trailing red group, e.g. `✓ read ×2 · ✗ bash ×1`.
Summary tool names use normal `success` green; counts/separators use dim
`toolTitle`. Tool and aggregate gutters use the same green `success` token as
their action text, even when visible tail was a `think` preview. `/quiet` persists its state in
`~/.pi/agent/pi-minimalist.json`;
that user preference is intentionally outside this nested jj repo. The state is process-global so `/reload` keeps existing rows connected
to the new command handler. No core patch is involved.

### 2. Collapsed thinking preview

Normally hidden thinking blocks (`Ctrl+T`) show `✓ think <preview>` on one
line (non-italic; `think` in `thinkingText` purple, preview in `toolTitle`), instead
of the bare "Thinking..." label. While the assistant message streams, Pi
forces that thinking open with native italic all-purple Markdown and no outer
gutter; when streaming ends it returns to the saved visibility override/default collapsed
preview. Pi exposes message-level streaming only: thought can remain open if
that message streams text after thought. Explicit expansion after completion
still persists. Expanded view keeps Pi's native italic markdown.

## Files

- `index.ts` — wiring only: installs the core bridges.
- `src/` — all behavior, heavily commented (user is not a TS expert). See Layout.
- `test/*.test.ts` — deterministic UI tests (`node --test`). See Validation.
- `run-tests.sh` — test + typecheck runner (symlinks Pi's packages locally).
- `tsconfig.json` — typecheck-only config (never emits).
- `patch-pi.sh` — idempotent script re-applying all core bridges after a Pi update.
- `node_modules/` — gitignored symlinks created by `run-tests.sh`.

- `AGENTS.md` — this file.

Global Pi setting loads the entry file explicitly:

```json
"extensions/pi-minimalist/index.ts"
```

Do not use the directory form or a leading `+`. This folder is its own
colocated jj/git repo; Pi's resource scanner skips nested `.git` directories.
An explicit file path bypasses scanning and loads the extension reliably.

## Architecture

Pi supports per-tool `renderCall`, `renderResult`, `renderShell`, but has no
public global/default renderer API and no thinking-renderer hook. Both features
therefore use the same two-layer pattern:

1. **Normal extension code** does everything possible via public API.
2. **Small local Pi core bridges** (patch-pi.sh) make core consult
   process-global symbols; ALL styling/behavior lives in this folder so
   `/reload` refreshes it without touching core.

Bridge symbols registered by the extension:

- `Symbol.for("pi.defaultToolRenderer")` → `{ renderShell: "self", renderCall, renderResult }`
- `Symbol.for("pi.thinkingPreview")` → `(text, theme, pad, isStreaming) => Component`
- `Symbol.for("pi.thinkingMarkdownTheme")` → all-purple theme for expanded thinking
- `Symbol.for("pi.minimalist.quietMode") → shared `/quiet` state, retained across `/reload`
- `pi.minimalist.quietThinking` / `pi.minimalist.quietProse` → core chronology hooks for unified quiet runs

### Renderer details

Renderer priority: tool's explicit renderer → global compact fallback →
Pi native fallback. MCP tools with no renderer get one compact borderless
line prefixed with `toolcall`.

Every action label uses `success` green via `actionColor()` (mutating tools were
once warning orange; orange already means "highlighted prose", and the action
word is a label, not a warning). Paths, commands, and concrete tool names use
`toolTitle`. Status glyphs are all `success` green except failures: queued caret
`›`, running dot `•`, completed `✓`, failed `✗` = `error`. "Finished" keys off
`!context.isPartial`, not `executionStarted`: session replay (restart with
history) never calls `markExecutionStarted()`, so keying off it made every
historical tool show as queued after a restart.

Elapsed seconds `[⏱ Ns]` in success green sit immediately after the action word
(e.g. `bash [⏱ 3s] go test ./...`). Tool rows have NO background highlight while
executing (removed at user request — the timer already signals activity); only
the streaming thinking preview keeps a `toolPendingBg` row.
`CompactLine.startTicker()` fires once per second calling `context.invalidate()`
so the timer advances even for silent commands with no streaming output. Plain
`ui.requestRender()` would only repaint the cached line (elapsed is baked into the
text during updateDisplay → renderCall); invalidate re-runs updateDisplay, which
recomputes it. The async ticker is safe — the documented recursion bug was
synchronous invalidate DURING render. The ticker stops at the terminal state and
is `unref()`d so it never holds the process open (`components.test.ts` fails if a
finished row leaves an interval registered).

## Local Pi Core Bridges

Patched into both installed runtime forms (the bundle is what `pi` executes;
the unbundled files are patched for consistency):

```text
/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/tool-execution.js
/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/assistant-message.js
/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui/dist/components/markdown.js
/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/chunks/chunk-JVUZSMYM.js
```

The script patches exactly these bridges:

1. `getCallRenderer()` / `getResultRenderer()` / `getRenderShell()` — when
   global `handles(name)` is true, override rendering only and pass the native
   result renderer through for expanded output; built-in definitions remain
   native (required by pi-subagents host-tool discovery).
2. `createCallFallback()` — ask the global renderer first for tools with no
   native renderer, else Pi native fallback.
3. `createResultFallback()` — same generic fallback; returning `undefined`
   delegates to Pi native text output.
4. `getRenderContext()` — expose `ui: this.ui` so the elapsed timer can repaint live.
5. `assistant-message.js` — collapsed thinking blocks call
   `globalThis[Symbol.for("pi.thinkingPreview")]` (falls back to the native
   "Thinking..." label when unregistered).
6. `assistant-message.js` — normally hidden thinking expands during message
   streaming, and `pi.thinkingMarkdownTheme` replaces expanded thinking token
   colors with purple. No outer thinking gutter is applied.
7. `pi-tui/components/markdown.js` — replace the blockquote prefix `│` with
   half-block `▌`; `signal.json` maps `mdQuoteBorder` to white `text`.
8. `pi-tui/components/markdown.js` — replace raw code fences with `╭ <lang>`
   (or `╭ code`), blue-gray `│ ` on every code line, and closing `╰`.
   `signal.json` maps `mdCodeBlockBorder` to blue-gray `toolDetails`.

### Upgrade warning

A Pi upgrade overwrites the patched core files. Symptom: built-ins and
MCP/third-party tools return to verbose cards, thinking blocks
show the bare "Thinking..." label, and markdown blockquotes return to a thin
gutter.

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
```

hand-apply the same edits, then update the script's perl patterns.

## Reload Semantics

- After changing any Pi core bridge: fully quit and restart Pi once.
  `/reload` cannot reload already-cached core modules.
- After that, edits to `index.ts` and `src/` are hot-reloadable with `/reload`.
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

The render-only bridge therefore recognizes a static native-name list and Pi
simply never invokes it for disabled tools. Do not reintroduce `pi.registerTool`
for built-in names: that changes their source ownership to extension-owned and
pi-subagents removes them from child host tool allowlists.

### Do not invalidate synchronously inside renderers

Never call `context.invalidate()` from `renderCall` or `renderResult`. An
earlier version did this and recursively re-entered rendering. Pi caught the
exception and silently displayed its verbose fallback. Read
`context.executionStarted`, `context.isPartial`, `context.isError` instead.

### Preserve original execution and expanded rendering

Built-in definitions must stay untouched. Core passes the native result
renderer into the global render-only bridge; `renderResult` delegates to it for
expanded output, preserving syntax highlighting and edit diffs. Collapsed
output returns `EmptyComponent`.

### Core's fallback path never passes lastComponent

`createCallFallback()` / `createResultFallback()` call
`getRenderContext(undefined)`, so `context.lastComponent` is ALWAYS undefined for
rendererless MCP/third-party tools. Caching the row only on `lastComponent` made
every repaint allocate a new `CompactLine` and start another 1s ticker while
clearing none — an exponential interval leak that froze the UI on long-running
MCP calls, and left a permanent 1Hz repaint per finished call. The row is
therefore cached in `context.state.callLine` (`state` is core's `rendererState`:
one object per tool call, stable across renders). Regression test: "reuses one row
and one ticker when core passes no lastComponent".

### Theme tokens and keybinding actions are typed unions

`ThemeLike.fg`/`bg` take `ThemeColor`/`ThemeBg`, and `KeybindingLookup.matches`
takes `Keybinding`. A mistyped token would otherwise throw at runtime (core
catches it and shows the verbose card), and a mistyped action name would silently
never match, turning a key into a dead key. Both are now compile errors.
Method-shorthand syntax is required so Pi's `Theme` and `KeybindingsManager`
remain assignable under `strictFunctionTypes`.

### notify() has no "success" level

`ctx.ui.notify(message, type?)` accepts only `info | warning | error`. Passing
`"success"` typechecked as `any` for a long time and was caught by
`./run-tests.sh --typecheck`.

### Avoid duplicate renderer packages

`pi-collapse-tools` was removed because it re-registers built-ins. Re-enabling
it can recreate the same pi-subagents host-tool ownership failure even though
pi-minimalist's core bridge wins the visible rendering.

## Layout

`index.ts` is WIRING ONLY (bridge installation). All
behavior lives in `src/`, so it can be unit tested without an extension
runtime:

| File | Contents |
| --- | --- |
| `src/components.ts` | `CompactLine`, `EmptyComponent`, `GutteredComponent`, gutters, `ThemeLike`, injectable `Timers` |
| `src/tool-rows.ts` | pure row text: `callText`, `statusGlyph`, `colorAction`, `rowText`, `BUILT_INS` |
| `src/tool-renderer.ts` | feature 1: `createToolRenderer()` factory |
| `src/quiet-mode.ts` | `/quiet` state, whitelist, and low-noise run summaries |
| `src/quiet-state.ts` | reads/writes persistent `~/.pi/agent/pi-minimalist.json` preference |
| `src/thinking-preview.ts` | feature 2: `createThinkingPreview()` factory |
| `test/test-support.ts` | deterministic doubles (fake theme/clock/timers, context builder) |
| `test/*.test.ts` | the tests |

Why factories instead of module-level singletons: tests drive the exact
production renderer with an injected clock and interval, so the elapsed timer is
verifiable without sleeping and a leaked ticker fails the run.

Why no `package.json`: this folder is a nested jj/git repo loaded by explicit
path (`"extensions/pi-minimalist/index.ts"`). Adding a manifest risks changing
how Pi discovers it, so `tsconfig.json` uses `module: esnext` +
`moduleResolution: bundler` instead of `nodenext`.

## Validation

### Automated tests

```bash
./run-tests.sh              # unit + core-bridge integration
./run-tests.sh --unit       # unit only, skips anything needing Pi's install
./run-tests.sh --typecheck  # tsc --noEmit, strict
```

`node --test` with native TypeScript type-stripping — no test framework, no new
dependency. The script symlinks `pi-tui`, `pi-coding-agent`, and `@types/node`
from Pi's install into a gitignored local `node_modules/` (Pi's own tree is never
modified), and exports `PI_ROOT` for the integration test.

The tests call the REAL exported renderers (`createToolRenderer()` etc.) and
`component.render(width)`; they never re-implement row layout. Theme tokens are
asserted through a fake theme that emits `<success>✓</success>`, so no assertion
depends on the machine's palette or the active theme. Use `plainTheme()` for
width assertions — `fakeTheme()` markup occupies real columns.

`test/integration.test.ts` is the regression guard for the core patch: it loads
this extension through Pi's real extension loader, builds a real
`ToolExecutionComponent` around the real `createReadToolDefinition`, and asserts
both the compact/guttered rendering AND that the extension registers zero tools
(the pi-subagents ownership contract). It skips itself when `PI_ROOT` is unset.

What automated tests still cannot cover: real terminal escape output, actual
keybinding delivery (Ctrl+O / Ctrl+T), markdown code-block and blockquote
patches and MCP adapter interplay. Those remain manual interactive checks below.

Fast startup/syntax check:

```bash
pi --list-models >/dev/null
```

Core bundle syntax checks:

```bash
node --check /opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/chunks/chunk-JVUZSMYM.js
node --check /opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/tool-execution.js
node --check /opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/assistant-message.js
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
5. Run bash: while running, expect `• bash [⏱ Ns] <cmd>` with NO row background;
   the elapsed counter advances once per second even for silent commands.
6. Press `Ctrl+O` / `Cmd+O`: expect full original output.
7. Trigger an error: expect red `✗`.
8. Toggle thinking collapsed (`Ctrl+T`): expect `• think …` (highlighted) while
   streaming, `✓ think <preview>` when done.
## Scope

Keep implementation small. No config format, package.json, runtime dependency,
or abstraction layer unless a real requirement appears. This extension uses only
Pi's installed packages and the Node standard library — including for tests
(`node --test`, no framework).

When adding or changing a renderer, add or update its test in the same commit:
the UI has repeatedly regressed silently, and these tests exist to name the
broken behavior instead of showing a large snapshot diff.

