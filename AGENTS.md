# pi-minimalist — Agent Notes

One home for all Pi UI simplification. Compact tools (including quiet mode),
thinking preview, one folder, NO patch script. Formerly the `compact-tool-renderer` extension (deleted after the merge —
do not recreate it).

Markdown chrome (`╭ <lang>` / `│` / `╰` code blocks, `▌` blockquotes) was extracted
into the separate `pi-markdown-chrome` extension: it shares no code with these
features and goes through the public theme surface instead of a core wrapper. Do
not reintroduce it here.

**Pi's install is never modified.** The old `patch-pi.sh` (perl rewrites into
Pi's compiled bundle) is deleted; `src/core-patch.ts` wraps Pi's real component
prototypes at load time instead. See "Runtime Core Patches" below.

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
✓ goland__execute_tool
```

Collapsed view hides tool output. `Ctrl+O` / `Cmd+O` expands the original
output. Each collapsed call is exactly one terminal line: long paths/commands
truncate using the real viewport width instead of wrapping.

`/quiet` toggles low-noise run folding. A consecutive completed run of collapsed
tools/thinking becomes one final summary line, e.g.
`✓ read ×2, atlassian_search @ atlassian ×1`; every other row in that run
renders zero lines.
Every tool registered by `pi-mcp-adapter` is discovered from public
`getAllTools().sourceInfo` metadata and compacted even when it ships a native
renderer; expansion still delegates to that renderer. Stable gateway names and
`mcp__<server>` namespace proxies are recognized immediately, while configured
direct-tool names refresh on `session_start` and `turn_start`. No server/tool
whitelist is maintained.
Quiet summaries preserve real names: rendererless calls use their registered
name and MCP namespace proxies use `<operation> @ <server>`. Completed, collapsed
thinking blocks share this run and summarize as `think ×N`.
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

- `index.ts` — wiring only: installs the core bridges + runtime patches.
- `src/` — all behavior, heavily commented (user is not a TS expert). See Layout.
- `test/*.test.ts` — deterministic UI tests (`node --test`). See Validation.
- `run-tests.sh` — test + typecheck runner (symlinks Pi's packages locally).
- `tsconfig.json` — typecheck-only config (never emits).
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
2. **Runtime prototype wrappers** (`src/core-patch.ts`) make core consult
   process-global symbols; ALL styling/behavior lives in this folder so
   `/reload` refreshes it without touching core.

Layer 2 used to be perl rewrites into Pi's compiled bundle. It no longer touches
disk at all — see "Runtime Core Patches".

Bridge symbols registered by the extension. `src/bridge.ts` is their SINGLE
SOURCE OF TRUTH (`BRIDGE_SYMBOLS`); `src/core-patch.ts` reads them at call time,
and `test/integration.test.ts` asserts the shipped bundle contains NONE of them
(a marker there means a stale patched bundle is masking the real wrappers).

- `Symbol.for("pi.defaultToolRenderer")` → `{ renderShell: "self", renderCall, renderResult }`
- `Symbol.for("pi.thinkingPreview")` → `(text, theme, pad, isStreaming) => Component`
- `Symbol.for("pi.thinkingMarkdownTheme")` → all-purple theme for expanded thinking
- `Symbol.for("pi.minimalist.quietMode")` → shared `/quiet` state, retained across `/reload`
- `pi.minimalist.quietThinking` / `pi.minimalist.quietProse` → chronology hooks for unified quiet runs
- `pi.minimalist.quietMessageSpacer` → removes leading assistant spacer from hidden quiet thinking rows

There is deliberately no tool-row spacer symbol. A compact row uses
`renderShell: "self"`, and core's self-shell branch emits its separator inline
and returns ZERO lines when the row draws nothing — spacer included. The old
`quietSpacer` bridge was compensating for a problem core already handles.

### Renderer details

The bridge gives the compact renderer priority for native built-ins plus every
tool whose source metadata identifies `pi-mcp-adapter`. Expanded output delegates to each tool's
original renderer. Tools without any renderer reach the same compact code
through core's fallback and use their registered tool name.

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

## Runtime Core Patches

**Nothing in Pi's install is modified.** `src/core-patch.ts` wraps Pi's real
component prototypes when the extension loads.

### Why this works

Pi's bundled CLI loads extensions through jiti with
`virtualModules: VIRTUAL_MODULES` (`core/extensions/loader.ts`; the bundle sets
`isBundledNode = true`). Those virtual modules are the bundle's OWN live module
namespaces. So when this extension imports `@earendil-works/pi-coding-agent`, it
receives the very same class objects the running TUI instantiates — not a second
copy from `dist/`.

`ToolExecutionComponent` and `AssistantMessageComponent` are public exports, and
every seam the old patch script rewrote is a `prototype` method. Wrapping those
prototypes produces exactly the old behavior, and:

- a Pi upgrade cannot silently revert it (nothing on disk is touched);
- no chunk-hash discovery, marker greps, `node --check`, or per-release regexes;
- the wrappers are ordinary TypeScript, unit-tested against the real components.

Extensions bind BEFORE `renderInitialMessages()` (`interactive-mode.ts`: "Initialize
extensions first so resources are shown before messages"), so replayed history is
already compact on startup.

### The two patches

1. **Tool renderer** (`patchToolExecution`) — wraps `getCallRenderer`,
   `getResultRenderer`, `hasRendererDefinition`, `getRenderShell`. Routes
   selected built-ins and rendererless third-party/MCP tools through
   `pi.defaultToolRenderer` without re-registering built-ins and losing their
   native ownership. Late-registered tools (`toolDefinition === undefined`) are
   covered by the same condition, so the old `createCallFallback` /
   `createResultFallback` rewrites are gone.
2. **Thinking** (`patchAssistantMessage`) — wraps `updateContent`: compact
   preview, streaming visibility, all-purple expanded Markdown, quiet ordering,
   and the message spacer. Five bundle rewrites became one wrapper.

### Bridge argument polarity

`quietThinking` takes `hidden`, and `bridge.ts` negates it into `expanded`
itself. `decorateThinking` must therefore pass `hidden` straight through.
Passing `!hidden` type-checks fine and inverts all of quiet mode:

- collapsed thinking became non-foldable, so every thinking row split a run in
  two (`think / read ×2 / think / bash` instead of one summary);
- expanded thinking became foldable and swallowed whole runs of visible tool
  rows into a single summary line.

Two tests in `test/core-patch.test.ts` cover both halves, and the old bundle's
call site (`...,this.isStreaming,hidden)`) is the ground truth for the polarity.

### Recognizing components structurally, never by class

The thinking wrapper finds each thinking run by looking for `MouseRegion`
(`onMouse` + `child`), a collapsed run by the ABSENCE of a `theme` field, an
expanded run by its presence, and the leading spacer by `setLines`.

Do NOT "fix" these into `instanceof` or `constructor.name`:

- `instanceof` FAILS against the real bundle. The bundle inlines its own copy of
  pi-tui, so the bundle's `MouseRegion` is a different class object than the one
  an `import` resolves to. This was verified empirically — the collapsed-preview
  check failed against a pristine bundle until the checks became structural.
- `constructor.name` depends on the minifier preserving inferred class names for
  `var MouseRegion = class {}`.

Field names are part of these classes' runtime behavior, so they are the stable
signal. `test/integration.test.ts` asserts each one still holds.

### Upgrade behavior

A Pi upgrade needs NO action. If a future release renames a wrapped method or a
structural field, `./run-tests.sh` fails naming it, and the affected feature
degrades to Pi's native rendering instead of crashing (each class and slot is
optional). Restart Pi once after upgrading, as usual.

## Reload Semantics

- After changing `src/core-patch.ts`: fully quit and restart Pi once. The
  prototype wrappers are applied once per process (`PATCHED` marker), so a
  `/reload` cannot replace an already-installed wrapper.
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
rendererless MCP/third-party tools. Late-registered tools can also arrive with
`toolDefinition === undefined` even though execution succeeds; the core bridge
makes its global fallback count as a renderer definition so those calls do not
bypass both methods and leak Pi's verbose `formatToolExecution()` card. Caching the row only on `lastComponent` made
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
that it registers zero tools (the pi-subagents ownership contract), asserts the
shipped bundle contains NO bridge markers (a marker means a stale patched bundle
is masking the real wrappers), and asserts every prototype method and structural
field the wrappers depend on still exists. It skips itself when `PI_ROOT` is unset.

`test/core-patch.test.ts` is what replaced the old marker greps: it applies the
real wrappers to Pi's REAL exported component prototypes, constructs those
components, renders them, and asserts the painted output — built-in rows,
rendererless third-party rows, unclaimed tools keeping native rendering, expanded
delegation, quiet folding to zero lines, thinking preview, streaming expansion,
all-purple recoloring, and wrapper idempotence. The old test could only check that
strings existed in a compiled file; this one executes them.

What automated tests still cannot cover: real terminal escape output, actual
keybinding delivery (Ctrl+O / Ctrl+T), and MCP adapter interplay. Those remain
manual interactive checks below.

Fast startup/syntax check:

```bash
pi --list-models >/dev/null
```

Interactive checks after restart/reload:

1. Read a file: expect one line `✓ read path`, no output, no blank row after it.
   Bash rows truncate the command at 100 chars while collapsed; when expanded
   (Ctrl+O) the call line shows the full command (viewport width still applies).
2. Read a very long path in a narrow terminal: expect one line ending in `…`, never wrapping.
3. Run several tools consecutively: expect one-line rows, each preceded by a single blank line.
4. Run `mcp`, `mcpScript`, and an `mcp__<server>` namespace proxy: expect
   compact `✓ mcp <operation> @ <server>` rows; enable `/quiet` and expect
   consecutive calls to retain actual operation names and counts.
5. Run an unrendered IDE tool: expect `✓ tool_name`.
6. Run bash: while running, expect `• bash [⏱ Ns] <cmd>` with NO row background;
   the elapsed counter advances once per second even for silent commands.
7. Press `Ctrl+O` / `Cmd+O`: expect full original output.
8. Trigger an error: expect red `✗`.
9. Toggle thinking collapsed (`Ctrl+T`): expect `• think …` (highlighted) while
   streaming, `✓ think <preview>` when done.
## Scope

Keep implementation small. No config format, package.json, runtime dependency,
or abstraction layer unless a real requirement appears. This extension uses only
Pi's installed packages and the Node standard library — including for tests
(`node --test`, no framework).

When adding or changing a renderer, add or update its test in the same commit:
the UI has repeatedly regressed silently, and these tests exist to name the
broken behavior instead of showing a large snapshot diff.

