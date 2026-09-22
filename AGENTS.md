# pi-minimalist — Agent Notes

Compact, one-line tool and thinking rows for Pi's interactive transcript.

**Pi's install is never modified.** Everything is done from inside the extension
process, either through Pi's public extension API or by wrapping Pi's real
component prototypes at load time. There is no patch script; an earlier version
rewrote Pi's compiled bundle with perl and is gone.

```
✓ read src/a.ts
• bash [⏱ 3s] go test ./...
✓ mcp atlassian_search @ atlassian
✓ think weighing the options
✓ read ×2, edit ×1 · ✗ bash ×1        ← a folded run
```

---

## 1. What it does

| Feature | Default | Setting |
| --- | --- | --- |
| One-line tool rows, output hidden until `Ctrl+O` | on | `compactToolRows` |
| Fold adjacent finished rows into one summary | off | `groupToolRuns` |
| Fold activity before the latest assistant prose into one summary | off | `foldIntermediateActivity` |
| Wait for OpenAI's final answer before folding prose | off | `foldActivityOnFinalAnswer` |
| Folded activity replacement | elapsed time | `activitySummary` |
| Left gutter bar | on | `gutter` |
| Elapsed timer on running tools | on | `timer` |
| Collapsed thinking rendered like a tool row | off | `thinkingAsToolCall` |
| Keep a running tool out of a fold | off | `keepActiveToolsExpanded` |
| Keep streaming thinking expanded | off | `keepActiveThinkingExpanded` |

Related but separate: `pi-markdown-chrome` (code-block corners and the
blockquote gutter) was extracted into its own extension. It shares no code with
this one. Do not reintroduce it here.

### Registers no tools

`registerTool()` would change a built-in's source ownership, and pi-subagents
uses that ownership to decide which tools a child runtime may have — a
re-registered `read` disappears from child allowlists. This extension therefore
only ever replaces RENDERING.

---

## 2. Configuration

All settings live under the `minimalist` key in Pi's settings.json, so `pi-env`
and any other settings tooling sees them. Pi tolerates unknown top-level keys;
the published `pi-powerline-footer` extension uses the same pattern.

```
defaults  <  ~/.pi/agent/settings.json  <  <cwd>/.pi/settings.json
```

```json
"minimalist": {
  "compactToolRows": true,
  "groupToolRuns": false,
  "foldIntermediateActivity": false,
  "foldActivityOnFinalAnswer": false,
  "activitySummary": "elapsed",
  "gutter": true,
  "timer": true,
  "thinkingAsToolCall": false,
  "keepActiveToolsExpanded": false,
  "keepActiveThinkingExpanded": false,

  "excludeTools": ["subagent"],
  "glyphStyle": "unicode",
  "glyphs": {},
  "tokens": {},
  "maxDetailChars": 4000
}
```

- `/minimalist` opens an editor built on pi-tui's `SettingsList` — the same
  component `/settings` uses, so arrow keys, hover descriptions and Enter/Space
  cycling behave identically. `/minimalist config` remains an alias.
- `/minimalist status` prints the current state.

### Which settings are discoverable, and why

The ten keys above the blank line are in the command: their effect is visible
immediately and needs no vocabulary. The two prose sub-options appear only while
`foldIntermediateActivity` is on. The five below are JSON-only: they need
exact tool names or knowledge of Pi's theme palette, and putting them in a
chooser would imply they are casual choices.

`glyphStyle` is the interesting exception — JSON-only, but it is the one setting
that decides whether the extension is USABLE rather than merely pretty. Outside
a Nerd Font the Unicode glyphs render as boxes, and rows truncate by visible
column, so a mis-measured glyph shifts the whole line. The `ascii` preset exists
for exactly that, and every ASCII glyph is one column wide.

### Writing rules

The `/minimalist` editor writes ONLY the ten basic keys inside the `minimalist`
key, so a hand-written `glyphs`/`tokens`/`excludeTools` block is never touched.
It REFUSES to write a settings.json containing comments — `JSON.stringify` would
silently delete them — and says so, applying the change for the session instead.

Settings are re-read on every `turn_start` so an external edit applies without a
restart. A value that could NOT be persisted is kept in `Config.overrides` and
re-applied after each re-read; otherwise the next turn would silently revert it
while the UI still claimed it was applied.

`config-file.ts` re-implements Pi's `getAgentDir()` in two lines rather than
importing it, because importing pulls in the package's whole module graph (~17MB)
and would make `./run-tests.sh --unit` require a full Pi install.
`test/integration.test.ts` asserts the copy agrees with Pi.

---

## 3. How it hooks into Pi

Pi supports per-tool `renderCall`, `renderResult` and `renderShell`, but has no
public default-renderer API and no thinking-renderer hook. So there are two
layers:

1. **Ordinary extension code** does everything the public API can express.
2. **Runtime prototype wrappers** (`core-patch.ts`) make Pi's own components
   consult process-global slots that this extension fills.

### Why layer 2 is legitimate

Pi's bundled CLI loads extensions through jiti with
`virtualModules: VIRTUAL_MODULES` (`core/extensions/loader.ts`; the bundle sets
`isBundledNode = true`). Those virtual modules are the bundle's OWN live module
namespaces. When this extension imports `@earendil-works/pi-coding-agent` it
therefore receives the very same class objects the running TUI instantiates — not
a second copy from `dist/`.

`ToolExecutionComponent` and `AssistantMessageComponent` are public exports, and
every seam involved is a `prototype` method. Wrapping them:

- cannot be silently reverted by a Pi upgrade (nothing on disk is touched);
- needs no chunk-hash discovery, marker greps or per-release regexes;
- is ordinary TypeScript, unit-tested against the real components.

Extensions bind BEFORE `renderInitialMessages()` (`interactive-mode.ts`:
"Initialize extensions first so resources are shown before messages"), so
replayed history is already compact on startup.

### The two wrappers

**`patchToolExecution`** wraps `getCallRenderer`, `getResultRenderer`,
`hasRendererDefinition` and `getRenderShell`. Native tool definitions keep their
schema, `execute()` and source ownership; only rendering is replaced.

**`patchAssistantMessage`** wraps `updateContent`: compact thinking preview,
streaming visibility, single-hue expanded Markdown, run-grouping chronology, and
the message spacer.

### Bridge slots

`bridge.ts` owns `BRIDGE_SYMBOLS`, the single source of truth for the names. The
wrappers read them at CALL time, so `/reload` swaps behavior without re-wrapping,
and an unloaded extension degrades to Pi's native rendering.

`config` and `grouping` are also kept in slots so they survive `/reload`:
existing transcript rows close over them and resolve their appearance at render
time, so replacing an instance would strand every row on stale state.

---

## 4. Invariants — do not "fix" these

Each of these was a real bug. The test that guards it is named.

### Pass `hidden` through to the grouping bridge, never `!hidden`

`bridge.ts` negates it into `expanded` itself. Negating in `core-patch.ts` too
inverted all folding: expanded thinking became foldable and swallowed whole runs
of visible tool rows, while collapsed thinking stopped folding and split every
run in two. The old bundle's call site (`...,this.isStreaming,hidden)`) is the
ground truth. → `core-patch.test.ts`, "folds thinking together with adjacent tool
rows", "lets EXPANDED thinking break a quiet run".

### `handles()` is the ONLY authority on claiming

`claims()` in `core-patch.ts` must not also claim "any tool with no renderer of
its own". Under the old whitelist that fallback was load-bearing; with a
blacklist it silently OVERRODE the user, so `compactToolRows: false` and an
excluded rendererless tool were both compacted anyway. → `core-patch.test.ts`,
"obeys the master switch even for a tool with no renderer".

### Recognize components structurally, never by class or name

The thinking wrapper finds a thinking run by `MouseRegion`'s `onMouse` + `child`
fields, a collapsed run by the ABSENCE of a `theme` field, and the leading spacer
by `setLines`.

- `instanceof` FAILS against the real bundle: it inlines its own copy of pi-tui,
  so the bundle's `MouseRegion` is a different class object than the one an
  `import` resolves to. Verified empirically — the collapsed-preview check failed
  against a pristine bundle until the checks became structural.
- `constructor.name` depends on the minifier preserving inferred names for
  `var MouseRegion = class {}`.

→ `integration.test.ts`, "keeps every seam the runtime wrappers depend on".

### "Finished" keys off `!isPartial`, not `executionStarted`

Session replay never calls `markExecutionStarted()`, so keying off it showed the
queued caret for every historical tool call after a restart. → 
`tool-renderer.test.ts`, "shows ✓ for replayed history".

### Never call `context.invalidate()` synchronously inside a renderer

It re-enters rendering; Pi catches the exception and silently shows its verbose
fallback. Read `context.isPartial` / `isError` / `expanded` instead. The 1s
ticker is safe because it fires asynchronously.

### Cache the row in `context.state`, not on `lastComponent`

Core's FALLBACK path calls `getRenderContext(undefined)`, so `lastComponent` is
always undefined there. Caching only on it allocated a fresh row per repaint,
each starting another 1s ticker while clearing none — an interval leak that froze
the UI. → `tool-renderer.test.ts`, "reuses one row and one ticker when core
passes no lastComponent".

### A folded running row needs its own summary group

Running rows fold by default. Counting only success and failure meant a folded
running row was counted nowhere and vanished from the transcript until it
finished. → `row.test.ts`, "counts a still-running row instead of dropping it".

### OpenAI final-answer folding starts from `stopReason`, then confirms with `textSignature`

OpenAI Responses labels message items `commentary` or `final_answer`. Pi preserves
the finalized phase inside the text block's JSON `textSignature`, but only writes
that signature at `text_end`. For immediate folding, the streaming path therefore
uses Pi's `stopReason === "stop"`, which Pi sets on
`response.output_item.added` before the first final-answer text delta; the later
`final_answer` signature is the stable confirmation. → `core-patch.test.ts`,
"folds commentary as soon as OpenAI's final answer starts streaming".

### Session replay rebuilds interaction boundaries from finalized answers

Replayed history emits no `agent_start` / `agent_settled` events. Without a
fallback, every old message lands in cycle 0 and activity folding preserves only
the final prose of the entire session. A newly observed, non-streaming
`final_answer` or `stopReason === "stop"` closes the replay cycle AFTER assigning
that answer, so every historical user interaction keeps its own final prose. →
`core-patch.test.ts`, "preserves each historical interaction's final prose during
session replay".

### No generic tool-row spacer bridge

A compact row uses `renderShell: "self"`, and core's self-shell branch returns
ZERO lines when the row draws nothing — its separator included. An earlier
`quietSpacer` bridge was compensating for a problem core already handles. →
`core-patch.test.ts`, "renders zero lines for a quiet-hidden row, spacer included".

The one narrow exception is a VISIBLE folded-activity summary. Its host varies:
a tool self-shell supplies one separator, a simple assistant summary supplies
none after folding, and a hidden mixed thinking/prose message can leave several
interstitial spacers. The `activitySummaryRow` / `activityMessageView` bridges
let the render wrappers normalize every host to EXACTLY one leading blank while
fully hidden messages return zero lines. → `core-patch.test.ts`, "keeps exactly
one blank separator before a tool-hosted activity summary", "removes interstitial
spacers left by fully hidden mixed assistant messages", and "folds commentary as
soon as OpenAI's final answer starts streaming".

### Do not call runtime actions during extension load

`pi.getActiveTools()` and friends throw "Extension runtime not initialized".
Tool discovery therefore happens on `session_start` / `turn_start`.

### `notify()` has no "success" level

Only `info | warning | error`. Passing `"success"` typechecks as `any`.

---

## 5. Layout

Dependencies point one way, so no module needs to know about a layer above it.

```
index.ts                 wiring only: shared state, bridges, /minimalist
  ├─ config-file.ts      settings.json I/O, migration
  ├─ config-ui.ts        /minimalist screen and status summary
  └─ bridge.ts           symbol table + installation
       ├─ core-patch.ts  prototype wrappers
       ├─ tool-renderer.ts  ─┐
       └─ thinking.ts       ─┴─ run-grouping.ts ─┐
                                                 │
             row.ts        data model + the ONLY painter ─┘
             components.ts renders painted rows; theme-agnostic
             tools.ts      tool vocabulary
             config.ts     schema + live settings
```

| File | Contents |
| --- | --- |
| `src/config.ts` | setting schema, defaults, `Config` (no filesystem access) |
| `src/config-file.ts` | settings.json paths, load/merge/save, comment handling, migration |
| `src/config-ui.ts` | `/minimalist` field list + `SettingsList` wiring |
| `src/bridge.ts` | `BRIDGE_SYMBOLS`, `sharedState()`, `installBridges()` |
| `src/core-patch.ts` | the two runtime prototype wrappers |
| `src/row.ts` | `Row`/`RunSummary` model and `Painter`, the only thing that colors text |
| `src/components.ts` | `CompactLine`, `EmptyComponent`, `GutteredComponent`, injectable `Timers` |
| `src/tools.ts` | `BUILT_INS`, `describeTool`, `summaryName`, detail extraction |
| `src/tool-renderer.ts` | feature 1, plus everything derived from a render context |
| `src/thinking.ts` | feature 2: preview + single-hue expanded Markdown theme |
| `src/run-grouping.ts` | tool-run grouping, prose folding, agent-cycle timing, and summaries |
| `test/test-support.ts` | deterministic doubles (fake theme/clock/timers, `testConfig`) |

### Four rules that keep this structure honest

**1. Describe rows as data; paint them exactly once.** `describeTool()` returns
`{ label, details }` separately and grouping returns `Count[]`, never joined
strings. `Painter` is the only thing that calls `theme.fg`/`theme.bg`. An earlier
version built `"read src/a.ts"` and split it on the first space to recolor the
action word, silently assuming no label contains a space. Do not reintroduce
build-then-reparse.

**2. Bind theme and settings once, in a `Painter`.** There used to be a
module-level mutable config in `row.ts` with `config = defaultConfig()` defaults
on four functions, which made painting depend on load order and let one test leak
settings into the next.

**3. One encoding for "what should this row draw".** `CompactLine.setRow()` takes
a single `(width) => Row | null` resolver; `null` means zero lines. The tri-state
translation lives ONLY in `RunGrouping.rowFor()`, which both features call. There
were once two encodings with the conversion written out in each feature, so every
change to fold semantics had to be made twice.

**4. Resolve at render time, not at construction.** The resolver runs on every
`render()`, which is why a config toggle re-folds existing history with no
rebuild, and why detail truncation can follow the real terminal width.
`RunGrouping` caches its fold maps per state/config revision: rebuilding them in
every row makes one repaint O(n²), amplified by each running tool's 1s ticker. →
`run-grouping.test.ts`, "computes fold views once per state revision".

### Truncation width is dynamic

`CompactLine` truncates at the real viewport width, ANSI- and wide-character
aware, so a single-field detail like `bash`'s command needs no character cap. An
earlier fixed cap of 100 discarded ~89 usable columns on a 200-column terminal.

COMPOSED details still need a per-field budget: `grep`/`find` render
`/pattern/ in path`, and without one a long regex pushed the path — usually the
part you wanted — off the end of the row. The budget is derived from the width
passed to `render()`. `maxDetailChars` remains only as a sanity cap so a
multi-megabyte heredoc is not whitespace-collapsed, colored and measured on every
repaint.

### Claiming is a blacklist

Every tool is compacted unless named in `excludeTools`. The old rule
("built-ins + MCP, plus anything with no renderer of its own") silently exempted
every third-party tool that shipped a renderer: `subagent` stayed a full card and
nothing in the UI explained why. `subagent` is now excluded by NAME, because its
own renderer shows a run id, state and a `ctrl+o` hint that one line cannot
carry. `renderResult` still delegates to a native renderer, so `Ctrl+O` on a
compacted third-party tool shows that tool's own expanded output.

---

## 6. Validation

```bash
./run-tests.sh              # unit + integration against the installed Pi
./run-tests.sh --unit       # unit only, needs no Pi install
./run-tests.sh --typecheck   # tsc --noEmit, strict
```

`node --test` with native TypeScript type-stripping — no framework, no
dependency. The script symlinks `pi-tui`, `pi-coding-agent` and `@types/node`
from Pi's install into a gitignored local `node_modules/` (Pi's own tree is never
modified) and exports `PI_ROOT`.

Tests call the REAL exported code and `component.render(width)`; they never
re-implement row layout. Theme tokens are asserted through a fake theme that
emits `<success>✓</success>`, so no assertion depends on the active palette. Use
`plainTheme()` for width assertions — `fakeTheme()` markup occupies real columns.

Notable suites:

- `core-patch.test.ts` — applies the real wrappers to Pi's REAL exported
  prototypes, constructs those components, renders them, and asserts the painted
  output. This replaced marker greps against a compiled file, which could only
  check that strings existed.
- `integration.test.ts` — loads the extension through Pi's real loader, asserts it
  registers zero tools, asserts the shipped bundle contains NO bridge markers (a
  marker means a stale patched bundle is masking the real wrappers), and asserts
  every prototype method and structural field the wrappers depend on still exists.
- `row-shape.test.ts` — cell-accurate terminal model, one `(glyph, activeColor)`
  pair per visible column: separator spaces stay uncolored, segments do not bleed,
  an absent segment emits no empty color span, and no row can become multiline.

Also useful, and how two real bugs were caught after the unit tests passed: run
the same transcript against a PRISTINE Pi bundle (`npm pack` the same version
into a temp dir) and diff the rendered lines. Unit tests exercise our modules;
only that exercises the artifact the `pi` command actually runs.

### What automated tests cannot cover

Real terminal escape output, actual keybinding delivery (`Ctrl+O` / `Ctrl+T`),
MCP adapter interplay, and how the glyphs look in a given font. After a restart:

1. Read a file: one line `✓ read path`, no output, no blank row after it.
2. A long path in a narrow terminal: one line ending in `…`, never wrapping.
3. Several tools in a row: one line each, one blank line before each.
4. `mcp`, `mcpScript` and an `mcp__<server>` proxy: `✓ mcp <operation> @ <server>`.
5. An unrendered IDE tool: `✓ tool_name <identifying argument>`.
6. While bash runs: `• bash [⏱ Ns] <cmd>`, no row background, counter advancing
   once per second even for a silent command.
7. `Ctrl+O`: full original output, with diffs and syntax highlighting intact.
8. An error: red `✗`.
9. `Ctrl+T`: `• think …` while streaming, `✓ think <preview>` when done. Streaming
   stays COLLAPSED by default; `keepActiveThinkingExpanded` shows it in full.
10. `/minimalist status`: one line per setting.
11. `/minimalist` (or `/minimalist config`): arrow keys, a description line for
    the hovered setting, Enter/Space cycling, a visible live-change/Ctrl+O hint —
    and the transcript behind the overlay changing as you toggle.
12. `"glyphStyle": "ascii"`: `+ bash …` with a `|` gutter, still aligned.
13. A long command with `groupToolRuns` on: counted in the summary's `•` group,
    not vanished.
14. `foldIntermediateActivity`: each new prose block folds every preceding prose,
    thinking and tool row into ONE summary; switching it off restores them all.
15. With `foldActivityOnFinalAnswer`, OpenAI commentary remains visible until the
    first final-answer text appears, then collapses immediately.
16. `activitySummary`: `Worked for 2m 7s` replaces prior tool rows rather than
    appearing after them; tool-count mode likewise emits one combined summary.

---

## 7. Reload semantics

- After changing `core-patch.ts`: fully quit and restart Pi. The wrappers are
  applied once per process (`PATCHED` marker), so `/reload` cannot replace one.
- Otherwise `/reload` is enough for `index.ts` and `src/`.
- Reload while idle; avoid it during a running tool or an open overlay.
- Each reload overwrites the bridge slots with fresh instances. Do NOT clear them
  from `session_shutdown`: reload ordering can let an old shutdown hook erase the
  newly installed bridges. Process exit clears globalThis naturally.
- If the extension is disabled, restart once to clear its globals.

## 8. Scope

No config format, package.json, runtime dependency or abstraction layer unless a
real requirement appears. Only Pi's installed packages and the Node standard
library, including for tests.

When adding or changing a renderer, add or update its test in the same commit:
this UI has regressed silently more than once, and these tests exist to name the
broken behavior instead of showing a large snapshot diff.

Why no `package.json`: this folder is a nested jj/git repo loaded by explicit path
(`"extensions/pi-minimalist/index.ts"`, no `+` prefix — Pi's resource scanner
skips nested `.git` directories, and an explicit file path bypasses scanning).
Adding a manifest risks changing how Pi discovers it, so `tsconfig.json` uses
`module: esnext` + `moduleResolution: bundler` instead of `nodenext`.
