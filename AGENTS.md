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
✓ mcp atlassian_search @ atlassian
✓ mcpScript await tools.search(...)
✓ toolcall goland__execute_tool
```

Collapsed view hides tool output. `Ctrl+O` / `Cmd+O` expands the original
output. Each collapsed call is exactly one terminal line: long paths/commands
truncate using the real viewport width instead of wrapping.

`/quiet` toggles low-noise run folding. A consecutive completed run composed
only of `read/edit/write/grep/find/ls/bash/toolcall/think` becomes one final summary
line, e.g. `✓ read ×2, edit ×1`; every other row in that run renders zero lines.
The MCP adapter's `mcp`, `mcpScript`, and namespace proxy (`mcp__<server>`)
tools are compacted even though they ship native renderers; expansion still
delegates to those native renderers.
Rendererless third-party calls use the same `toolcall` quiet category. Completed,
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

Bridge symbols registered by the extension. `src/bridge.ts` is their SINGLE
SOURCE OF TRUTH (`BRIDGE_SYMBOLS`): `patch-pi.sh` writes the matching reads into
Pi's bundle, and `test/integration.test.ts` iterates `BRIDGE_SYMBOLS` to assert
the bundle contains every one of them, so a typo or a forgotten patch fails the
test run instead of silently disabling a feature.

- `Symbol.for("pi.defaultToolRenderer")` → `{ renderShell: "self", renderCall, renderResult }`
- `Symbol.for("pi.thinkingPreview")` → `(text, theme, pad, isStreaming) => Component`
- `Symbol.for("pi.thinkingMarkdownTheme")` → all-purple theme for expanded thinking
- `Symbol.for("pi.minimalist.quietMode") → shared `/quiet` state, retained across `/reload`
- `pi.minimalist.quietThinking` / `pi.minimalist.quietProse` → core chronology hooks for unified quiet runs
- `pi.minimalist.quietSpacer` → removes leading ToolExecution spacer from hidden quiet rows
- `pi.minimalist.quietMessageSpacer` → removes leading assistant spacer from hidden quiet thinking rows

### Renderer details

The bridge gives the compact renderer priority for native built-ins plus the
MCP adapter's `mcp`, `mcpScript`, and `mcp__<server>` tools. Expanded output delegates to each tool's
original renderer. Tools without any renderer reach the same compact code
through core's fallback and use the `toolcall` label.

Every action label uses `success` green (mutating tools were once warning orange;
orange already means "highlighted prose", and the action word is a label, not a
warning). Paths, commands, and concrete tool names use `toolTitle`. Status glyphs are all `success` green except failures: queued caret
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

Only the self-contained CLI bundle is patched:

```text
/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/chunks/<current chunk>.js
```

`patch-pi.sh` finds the current chunk by content; hashes change between Pi
releases. It deliberately leaves SDK/unbundled components and pi-tui pristine.
Those files are not loaded by the `pi` command, and mirroring every edit there
previously doubled the upgrade surface while testing the wrong runtime.

Three bridge groups remain:

1. **Tool renderer** — route selected built-ins and rendererless third-party
   tools through `pi.defaultToolRenderer`, without re-registering built-ins and
   losing their native ownership.
2. **Quiet spacer** — let a quiet-hidden tool row suppress its parent
   `Spacer(1)`.
3. **Thinking** — compact preview, streaming visibility, quiet ordering/spacer,
   and the all-purple expanded Markdown theme.

### Markdown chrome without a patch

`src/markdown-chrome.ts` gets `╭ <lang>` / `│` / `╰` code blocks and the `▌`
blockquote gutter with **no core patch**:

- `MarkdownTheme.codeBlockBorder` / `.quoteBorder` are `(text) => string` and
  receive the *literal* frame text, so they can **rewrite** glyphs, not merely
  recolor them. Both are built as `theme.fg(token, text)`, so intercepting
  `Theme.fg` is enough.
- The vertical edge is the public `codeBlockIndent` field, fed by settings
  `markdown.codeBlockIndent` (`"│ "`).
- pi-tui emits `` ``` `` for **both** a closing fence and a bare opening fence,
  so the wrapper tracks parity across each synchronous open/close pair.
- The live theme object is wrapped **in place**. Passing an instance to
  `ui.setTheme()` would set the theme name to `<in-memory>`, disabling `/theme`
  and custom-theme file watching. Re-applied on `session_start`/`turn_start`
  because `/theme` installs a fresh Theme; the install is idempotent per object.

Known cosmetic gap vs the old patch: core builds `codeBlockIndent` straight from
settings, so the edge cannot be themed and renders in the default foreground
while the corners use `mdCodeBlockBorder`. Hardcoding an SGR escape in settings
would color it but would not follow a theme switch, so it is left plain.

### Upgrade warning

A Pi upgrade overwrites the patched bundle. Symptom: built-ins and MCP tools
return to verbose cards, and thinking blocks show the bare "Thinking..." label.
Markdown chrome is unaffected — it needs no patch.

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

The dependency direction is strictly one way, so no module needs to know about a
layer above it:

```text
index.ts            wiring: shared QuietMode, bridges, /quiet command
  └─ bridge.ts      symbol table + installation
       ├─ tool-renderer.ts   feature 1  ─┐
       └─ thinking.ts        feature 2  ─┬─ quiet-mode.ts ─┐
                                        └─ tools.ts       │
                                                          │
            row.ts   (data model + the ONLY painter) ─────┘
            components.ts   (renders painted rows; theme-agnostic)
```

| File | Contents |
| --- | --- |
| `src/bridge.ts` | `BRIDGE_SYMBOLS` (single source of truth) + `installBridges()` |
| `src/row.ts` | `Row` data model, `ThemeLike`, gutters, and the ONLY painter: `labeledRow`, `summaryRow` |
| `src/components.ts` | `CompactLine`, `EmptyComponent`, `GutteredComponent`, injectable `Timers`. Theme-agnostic |
| `src/tools.ts` | tool vocabulary: `BUILT_INS`, `isBuiltIn`, `compact`, `describeTool` |
| `src/tool-renderer.ts` | feature 1: `createToolRenderer()`, plus everything derived from a render context (`statusGlyph`, `timerBadge`, `RenderState`) |
| `src/thinking.ts` | feature 2: `createThinkingPreview()` + `allPurpleThinkingTheme()` |
| `src/quiet-mode.ts` | `/quiet` state, whitelist, run folding, and `rowFor()` |
| `src/quiet-state.ts` | reads/writes persistent `~/.pi/agent/pi-minimalist.json` preference |
| `src/markdown-chrome.ts` | code-block/blockquote glyphs via `Theme.fg`; no core patch |
| `test/test-support.ts` | deterministic doubles (fake theme/clock/timers, context builder) |
| `test/*.test.ts` | the tests |

### Three rules that keep this structure honest

**1. Describe rows as data; paint them exactly once.** `describeTool()` returns
`{ label, details }` SEPARATELY and `summarize()` returns `Count[]`, never joined
strings. `row.ts` is the only module that calls `theme.fg`/`theme.bg` for a row.
An earlier version built `"read src/a.ts"` and then split it on the first space to
recolor the action word (same for `"read ×2, edit ×1"`, split back apart on `", "`),
which silently assumed no label ever contains a space. Do not reintroduce
build-then-reparse.

**2. One encoding for "what should this row draw".** `CompactLine.setRow()` takes
a single `() => Row | null` resolver; `null` means zero lines. Quiet mode's
tri-state translation lives ONLY in `QuietMode.rowFor()`, which both features
call. There were once two encodings (`QuietView` and a separate `QuietText`) with
the conversion written out in each feature, so every change to quiet semantics
had to be made twice.

**3. Resolve at render time, not at construction.** The resolver runs on every
`render()`, which is why `/quiet` re-folds existing transcript history with no
core rebuild: `notify()` triggers a repaint and every row re-reads shared state.

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

`test/row-shape.test.ts` guards the invariants of the row/paint split with a
cell-accurate terminal model (one `(glyph, activeColor)` pair per visible
column): separator spaces stay uncolored, segments do not bleed into each other,
an absent segment emits no empty color span, and no built-in row can become
multiline. That model is what verified the refactor to the current structure —
compared against the previous renderer over 1284 rendered outputs (every tool ×
UI state × expanded × width, quiet folds, thinking, real Pi theme), it found zero
differences in painted cells.

`test/integration.test.ts` loads the extension through Pi's real loader, checks
that it registers zero tools (the pi-subagents ownership contract), and verifies
all bridge markers in the **actual CLI bundle**. It deliberately does not import
unbundled component copies. It skips itself when `PI_ROOT` is unset.

It also asserts that pi-tui stays pristine while the theme-side markdown chrome
still renders `╭`/`│`/`╰`/`▌`.

What automated tests still cannot cover: real terminal escape output, actual
keybinding delivery (Ctrl+O / Ctrl+T), and MCP adapter interplay. Those remain
manual interactive checks below.

Fast startup/syntax check:

```bash
pi --list-models >/dev/null
```

Patch script self-check (also syntax-checks the discovered bundle; idempotent):

```bash
~/.pi/agent/extensions/pi-minimalist/patch-pi.sh
```

Interactive checks after restart/reload:

1. Read a file: expect one line `✓ read path`, no output, no blank row after it.
   Bash rows truncate the command at 100 chars while collapsed; when expanded
   (Ctrl+O) the call line shows the full command (viewport width still applies).
2. Read a very long path in a narrow terminal: expect one line ending in `…`, never wrapping.
3. Run several tools consecutively: expect one-line rows, each preceded by a single blank line.
4. Run `mcp`, `mcpScript`, and an `mcp__<server>` namespace proxy: expect
   compact `✓ mcp <operation> @ <server>` rows; enable `/quiet` and expect
   consecutive calls to fold into `toolcall ×N`.
5. Run an unrendered IDE tool: expect `✓ toolcall tool_name`.
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

