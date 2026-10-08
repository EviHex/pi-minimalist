# pi-minimalist — Agent Notes

Compact, one-line tool and thinking rows for Pi's interactive transcript.

**Pi's install is never modified.** Everything runs inside the extension process,
through Pi's public extension API or by wrapping Pi's real component prototypes
at load time.

```text
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
| Preset: off, lite, full, max, custom (a layer over four look keys) | full (fresh install) / custom (existing config) | `preset` |
| One-line tool rows, output hidden until `Ctrl+O` | on | `compactToolRows` |
| Fold adjacent finished rows into one summary | on | `groupToolRuns` |
| Fold activity before the latest assistant prose into one summary | off | `foldIntermediateActivity` |
| Folded activity replacement | elapsed time | `activitySummary` |
| Left gutter bar | on | `gutter` |
| Elapsed timer on running tools | on | `timer` |
| Collapsed thinking rendered like a tool row | off | `thinkingAsToolCall` |
| Keep a running tool out of a fold | off | `keepActiveToolsExpanded` |
| Keep streaming thinking expanded | off | `keepActiveThinkingExpanded` |

`pi-markdown-chrome` (code-block corners, blockquote gutter) is a separate
extension. Do not reintroduce it here.

**Registers no tools.** `registerTool()` would change a built-in's source
ownership, and pi-subagents uses that ownership to decide which tools a child
runtime may have. This extension only ever replaces RENDERING.

---

## 2. Configuration

Settings live under the `minimalist` key in the global agent `settings.json`
(`PI_CODING_AGENT_DIR` respected). Project-local blocks are ignored. Unknown or
removed keys (for example the old `maxDetailChars`, `foldActivityOnFinalAnswer`)
are ignored, because `coerce` reads only known keys.

```json
"minimalist": {
  "preset": "custom",
  "compactToolRows": true, "groupToolRuns": true, "foldIntermediateActivity": false,
  "activitySummary": "elapsed", "gutter": true, "timer": true,
  "thinkingAsToolCall": false, "keepActiveToolsExpanded": false,
  "keepActiveThinkingExpanded": false, "glyphStyle": "unicode",

  "excludeTools": [], "glyphs": {}, "tokens": {}
}
```

`/minimalist` (alias `config`) opens an editor on pi-tui's `SettingsList`;
`/minimalist status` prints the state. The eleven keys above the blank line are
in the editor; `activitySummary` shows only while `foldIntermediateActivity` is
on. A twelfth row, "Excluded tools", opens a submenu (a second `SettingsList` with
`enableSearch`) listing every tool from `pi.getAllTools()`, read when it opens;
Enter flips a tool between `compact` and `excluded`. Names in `excludeTools` that no
loaded tool carries stay listed, so opening the picker never forgets them. `glyphs`
and `tokens` are JSON-only: they need knowledge of Pi's palette. Default symbols are plain Unicode (no Nerd
Font); `glyphStyle: "ascii"` uses one-column symbols only.

**Presets are a layer, not a write.** A preset names four keys (`LOOK_KEYS`:
`compactToolRows`, `groupToolRuns`, `foldIntermediateActivity`,
`thinkingAsToolCall`). `Config` keeps the user's own values and computes the
effective view on read (`layer()`: user keys < preset look keys; `custom` adds
nothing). Switching preset never touches the user's keys; other settings stay
editable. There is no reset row: presets are the reset points.

- Under a preset the four look rows are greyed: label AND value are dimmed (the
  default value colour `muted` is too close to the hint colour to stand out alone),
  their only value is the dimmed current text, and `onChange` returns early.
- `custom` is DISPLAYED as `custom (editable)` (`presetLabel`/`presetFromLabel`); the
  stored preset name stays `custom`.
- A fresh install (no basic key in the block, `isFresh`) gets `full`
  (`FRESH_PRESET`); the first write pins `"preset": "full"`. A block with basic
  keys but no `preset` stays `custom`.
- The first switch to `custom` (`customSeed`) writes the `lite` look keys, only
  when none of the four exist.

→ `config.test.ts` "presets", `config-ui.test.ts` "presets in the config screen".

**Writing rules.** The editor writes only the changed key: a basic key, or
`excludeTools` from the picker. Hand-written `glyphs`/`tokens` survive every write. It REFUSES to write a
settings.json containing comments (`JSON.stringify` would delete them) and
applies the change for the session instead. Settings are re-read on every
`turn_start`; a value that could not be persisted lives in `Config.overrides`
and is re-applied after each re-read. `config-file.ts` re-implements Pi's
`getAgentDir()` in two lines: importing Pi's copy pulls ~17MB of modules and
would make `--unit` need a full Pi install.

---

## 3. How it hooks into Pi

Pi has per-tool `renderCall`/`renderResult`/`renderShell` but no default-renderer
API and no thinking-renderer hook. So:

1. **Ordinary extension code** does everything the public API can express.
2. **Runtime prototype wrappers** (`core-patch.ts`) make Pi's own components
   consult one process-global `Bridge` object that this extension fills.

Why layer 2 is legitimate: Pi's bundled CLI loads extensions through jiti with
`virtualModules`; those are the bundle's OWN live module namespaces. Importing
`@earendil-works/pi-coding-agent` therefore yields the very class objects the
running TUI instantiates. Wrapping their `prototype` methods cannot be reverted
by a Pi upgrade (nothing on disk changes) and is unit-testable against the real
components. Extensions bind BEFORE history is replayed, so old rows are compact
on startup.

### The three wrappers

- **`patchToolExecution`** wraps `getCallRenderer`, `getResultRenderer`,
  `hasRendererDefinition`, `getRenderShell`, `updateDisplay` and `render`. Tool
  definitions keep their schema, `execute()` and source ownership.
- **`patchAssistantMessage`** wraps `updateContent` (compact thinking preview,
  streaming visibility, single-hue Markdown, chronology, message spacer),
  `render` (one leading blank before a summary, hidden messages) and
  `handleMouse` (mouse `y` correction, see §4).
- **`patchUserMessage`** wraps `UserMessageComponent.rebuild` to register a
  barrier (§4).

### The bridge

`bridge.ts` owns `BRIDGE_SYMBOLS` (the single source of the global key names) and
the typed `Bridge` object: the tool renderer, the thinking preview, the
chronology/fold hooks and two settings reads. Wrappers call `readBridge()` at
CALL time, so a `/reload` that installs a new object swaps behavior without
re-wrapping, and an unloaded extension (no object) degrades to native rendering.

`config` and `grouping` live in their own slots so they survive `/reload`:
existing transcript rows close over them and resolve appearance at render time,
so replacing an instance would strand every row on stale state. The `Bridge`
closes over those same two instances.

---

## 4. Invariants — do not "fix" these

Each was a real bug. The guarding test is named (`core-patch` = real Pi
components).

### Pass `hidden` through to the grouping bridge, never `!hidden`

`Bridge.observeThinking` negates it into `expanded` itself. Negating in
`core-patch.ts` too inverts all folding: expanded thinking swallows whole runs of
tool rows, collapsed thinking splits every run. → `core-patch.test.ts` "folds
thinking together with adjacent tool rows", "lets EXPANDED thinking break a run
instead of folding it".

### `handles()` is the ONLY authority on claiming

`claims()` must not also claim "any tool with no renderer of its own": with a
blacklist that overrides the user (`compactToolRows: false` and an excluded
rendererless tool were compacted anyway). → `core-patch.test.ts` "obeys the master
switch even for a tool with no renderer", "leaves an excluded rendererless tool
to Pi".

### A folded summary must never jump over something visible

A summary is drawn at its LAST member, so every visible item between two foldable
rows must cut the run. `RunGrouping.views()` ends a run at a non-foldable entry or
an entry of another agent `cycle`. Visible things we never draw are observed as
`kind: "other"` barriers: an unclaimed tool card (`syncShell`) and a user message
(`patchUserMessage`). Barrier ids follow the MESSAGE TEXT (`user:<text>`), not the
component: Pi builds new components on every chat rebuild, and per-component ids
appended fresh barriers at the end, cutting later runs in two and leaking
entries. Known limit: a "Worked for" summary can appear below a barrier card
inside the same cycle. → `core-patch.test.ts` "a folded run never jumps over
something visible", "does not append a new barrier for the same user message on
every rebuild".

### A failed row is red all over

`tool-renderer.ts` passes `labelColor: status.color` as well as `glyphColor` to
`Painter.labeled`; the gutter follows the label colour. → `tool-renderer.test.ts`
"paints a failed row in the error colour".

### Recognize components structurally, never by class or name

A thinking run is a `MouseRegion` found by its `onMouse` + `child` fields, a
collapsed run by the ABSENCE of a `theme` field, the leading spacer by
`setLines`. `instanceof` fails against the real bundle (it inlines its own pi-tui
copy) and `constructor.name` depends on the minifier. → `integration.test.ts`
"keeps every seam the runtime wrappers depend on".

### "Finished" keys off `!isPartial`, not `executionStarted`

Session replay never calls `markExecutionStarted()`; keying off it showed the
queued caret for every historical call. → `tool-renderer.test.ts` "shows ✓ for
replayed history where executionStarted is false".

### Never call `context.invalidate()` synchronously inside a renderer

It re-enters rendering; Pi catches it and silently shows its verbose fallback.
Read `context.isPartial` / `isError` / `expanded` instead. The 1s ticker is safe
because it fires asynchronously. (No test: it is a rule, not a behaviour.)

### Cache the row in `context.state`, not on `lastComponent`

Core's fallback path passes no `lastComponent`; caching only there allocated a row
per repaint, each starting a 1s ticker that nothing cleared. → `tool-renderer.test.ts`
"reuses one row and one ticker when core passes no lastComponent".

### A folded running row needs its own summary group

Counting only success and failure made a folded running row vanish until it
finished. → `row.test.ts` "counts a still-running row instead of dropping it".

### A cycle of prose only never folds

`foldIntermediateActivity` folds a cycle only when something before its latest
prose is a tool or thinking row. Consecutive assistant text stays visible with
normal spacing, in both `activitySummary` modes (`RunGrouping.views()`). →
`run-grouping.test.ts` "never folds a cycle of prose only", `core-patch.test.ts`
"leaves a prose-only cycle fully visible with normal spacing".

### Thinking and prose ids follow the MESSAGE, not the component

Pi rebuilds `AssistantMessageComponent`s for the same messages (Ctrl+T, tree
navigation). Ids from the component instance left ghost entries (`think ×6` for
three rows). `RunGrouping` keys `think:`/`prose:` ids on `message.timestamp`; a
rebuilt component re-observes the SAME entries. Test messages need unique
timestamps. Still open: entries of a previous session are never dropped. →
`core-patch.test.ts` "keeps the run count right when Pi rebuilds the chat from
its messages", "does not count an empty thinking block, before or after a
rebuild", "keeps rebuilt prose and an opened run on the same entries".

### Session replay rebuilds interaction boundaries from finalized answers

Replay emits no `agent_start` / `agent_settled`, so every old message would land
in cycle 0. A newly observed, non-streaming message with `stopReason === "stop"`
(one that continues with tools ends in `toolUse`) closes the replay cycle AFTER
assigning the answer, so each interaction keeps its own final prose. →
`core-patch.test.ts` "preserves each historical interaction's final prose during
session replay".

### Live renderer switches must replace the attached tool shell

Pi attaches one shell in the constructor. Changing the renderer getters alone
leaves existing rows on the old shell. The wrapper syncs `children[1]` (after the
leading spacer), rebuilds only on ownership/shell transitions, and drops stale
renderer components and tickers; a native self shell can change ownership without
a shell change. → `core-patch.test.ts` "switches an existing built-in row between
compact and native shells in both directions", "rebuilds the renderer when
ownership changes but a native self shell stays attached".

### Thinking off means native rendering

`thinkingAsToolCall` owns BOTH collapsed previews and expanded Markdown
recoloring. Off keeps Pi's original components (no gutter, no `think` label);
`patchAssistantMessage` rebuilds from `lastMessage` only when the setting
changes, keeping click overrides. Native thinking breaks tool-run groups; the
activity fold and streaming expansion still apply. → `core-patch.test.ts`
"restores exact native thinking rendering and switches existing messages live".

### No generic tool-row spacer bridge

A compact row uses `renderShell: "self"`, and core's self-shell branch returns
ZERO lines when the row draws nothing, separator included. Do not add a spacer
bridge for tool rows. The one exception is a VISIBLE folded-activity summary,
whose host varies (tool self-shell, simple assistant message, hidden mixed
message with several spacers): `Bridge.activitySummaryRow` / `activityMessageView`
let the render wrappers normalize every host to EXACTLY one leading blank, and
fully hidden messages return zero lines. → `core-patch.test.ts` "renders zero
lines for a folded-away row, spacer included", "keeps exactly one blank separator
before a tool-hosted activity summary", "removes interstitial spacers left by
fully hidden mixed assistant messages", "folds earlier prose into one summary
with a single leading blank when a final answer streams in".

### A click on a summary opens the run; it must not reach Pi's toggle

A summary is drawn by ONE member (the tail); the others draw zero lines, so every
click lands in the tail's `MouseRegion`. `CompactLine.handleMouse` and
`FoldableProse` call `RunGrouping.click(id, onHeader)` first: a handled click
opens every member for the session. `RunGrouping.opened` maps every member id to
ONE shared run, which stops BOTH folds on purpose.

An opened run keeps a HEADER, `▾ Expanded · click to fold` (`v Expanded - click
to fold` in ASCII; `Painter.header()`, muted, no gutter bar), then exactly ONE
blank line, then the member's normal output. The header is ALWAYS drawn by the
FIRST member (`run.members[0]`, `RunGrouping.headerFor`) whatever its kind; do not
bring back a "dynamic head" that skips members that cannot host it (the header
jumped below an expanded thinking row). Hosts: `CompactLine` (tool row, collapsed
compact thinking) and `FoldableProse` (assistant prose, native thinking, expanded
compact thinking). Both pass `onHeader = headed && event.y === 0`: header →
`close()` (the run folds again), anything else → `open()`, which returns false for
a visible member so Pi expands only that row. `FoldableProse` is clickable only on
its summary or header line, so Pi's own thinking toggle keeps working. `event.y`
is local to the host (Container subtracts earlier siblings), so never compare it
with the host's line numbers.

**Mouse `y` through the assistant message.** The `render` wrapper changes lines
AFTER `Container.render()` recorded its mouse layout (`withOneLeadingBlank`), so a
summary alone in its message is drawn at row 1 but known at row 0. The
`handleMouse` wrapper translates `y` back by the remembered shift. Do not remove
it.

→ `core-patch.test.ts` "opens a clicked run summary instead of expanding only its
last row" (also header close and reopen), "opens a prose-hosted 'Worked for'
summary by click, and folds it back by its header", "opens a summary hosted by
native (non-compact) thinking, and leaves its own toggle alone", "keeps an opened
run's header above a compact thinking head, collapsed or Ctrl+T-expanded" (the
last three drive Pi's real `Container.handleMouse`); `run-grouping.test.ts`
"re-folding an opened run".

### Do not call runtime actions during extension load

`pi.getActiveTools()` and friends throw "Extension runtime not initialized". Tool
discovery happens on `session_start` / `turn_start`.

### `notify()` has no "success" level

Only `info | warning | error`; `"success"` typechecks as `any`.

---

## 5. Layout

Dependencies point one way:

```text
index.ts                 wiring only: shared state, bridge, /minimalist
  ├─ config-file.ts      settings.json I/O
  ├─ config-ui.ts        /minimalist screen and status summary
  └─ bridge.ts           Bridge type + installation
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
| `src/config-file.ts` | settings.json path, read/save, comment handling |
| `src/config-ui.ts` | `/minimalist` field list + `SettingsList` wiring |
| `src/bridge.ts` | `BRIDGE_SYMBOLS`, `Bridge`, `readBridge()`, `sharedState()`, `installBridges()` |
| `src/core-patch.ts` | the three prototype wrappers |
| `src/row.ts` | `Row`/`RunSummary` model and `Painter`, the only thing that colors text |
| `src/components.ts` | `CompactLine`, `FoldableProse`, `EmptyComponent`, `GutteredComponent`, `Timers` |
| `src/tools.ts` | `BUILT_INS`, `describeTool`, `summaryName`, detail extraction |
| `src/tool-renderer.ts` | the compact tool renderer and everything derived from a render context |
| `src/thinking.ts` | thinking preview + single-hue expanded Markdown theme |
| `src/run-grouping.ts` | tool-run grouping, prose folding, agent-cycle timing, summaries |
| `test/test-support.ts` | deterministic doubles (fake theme/clock/timers, `testConfig`) |

### Four rules that keep this structure honest

1. **Describe rows as data; paint them exactly once.** `describeTool()` returns
   `{ label, details }`, grouping returns `Count[]`, never joined strings.
   `Painter` is the only caller of `theme.fg`. Never build a string and re-parse it.
2. **Bind theme and settings once, in a `Painter`.** No module-level mutable config.
3. **One encoding for "what should this row draw".** `CompactLine.setRow()` takes
   a `(width) => Row | null` resolver (`null` = zero lines); the tri-state
   translation lives ONLY in `RunGrouping.rowFor()`.
4. **Resolve at render time, not at construction.** A config toggle re-folds
   existing history with no rebuild. `RunGrouping` caches its fold maps per
   state/config revision: rebuilding them in every row makes a repaint O(n²). →
   `run-grouping.test.ts` "computes fold views once per state revision".

### Truncation and wrapping

`CompactLine` truncates at the real viewport width (ANSI- and wide-character
aware), so single-field details like `bash`'s command have no character cap.
COMPOSED details (`grep`/`find`: `/pattern/ in path`) get a per-field budget
derived from `render(width)`, so a long regex cannot push the path off the row.

An expanded row (`Ctrl+O`) gets no budget and `Row.wrap` (`{ head, body }`):
details wrap under `glyph label` with a hanging indent (the timer badge is part
of the wrapped text, so its growth never shifts continuation lines), gutter on
every line. `block()` in tools.ts keeps the value's line structure (`\r\n` → `\n`,
tabs → two spaces, outer blank lines dropped, each line keeps its indentation).
`Painter.labeled` keeps `Row.text` ONE line for collapsed and fold paths and
colors the wrap body line by line, so no escape spans a newline. Below 10 usable
columns the row truncates `Row.text` to one clipped line. A collapsed row never
wraps. → `tool-renderer.test.ts` "expanded bash row: …" cases, "collapses a
multi-line command to ONE clipped line with spaces".

### Claiming is a blacklist

Every tool is compacted unless named in `excludeTools` (empty by default). To keep
a tool's own card, e.g. `"excludeTools": ["subagent"]`, whose renderer shows a run
id, state and `ctrl+o` hint that one line cannot carry, name it there. `renderResult` still delegates to the native renderer, so `Ctrl+O`
on a compacted third-party tool shows its own expanded output.

---

## 6. Validation

```bash
./run-tests.sh              # unit + integration against the installed Pi
./run-tests.sh --unit       # unit only, needs no Pi install
./run-tests.sh --typecheck  # tsc --noEmit, strict
```

`node --test` with native type-stripping, no framework. The script symlinks
Pi's `pi-tui`, `pi-coding-agent` and `@types/node` into a gitignored
`node_modules/` and exports `PI_ROOT` (Pi's own tree is never modified).

Tests call the REAL exported code and `component.render(width)`; they never
re-implement row layout. Theme tokens are asserted through a fake theme that
emits `<success>✓</success>`; use `plainTheme()` for width assertions. Notable
suites: `core-patch.test.ts` (real wrappers on Pi's real prototypes),
`integration.test.ts` (real loader, zero tools registered, every seam still
present), `row-shape.test.ts` (cell-accurate color/width model).

When changing a renderer, add or update its test in the same commit.

### What automated tests cannot cover

Real terminal escapes, keybinding delivery, MCP adapter interplay, font glyphs.
After a full restart, check by eye:

1. Read a file: one line `✓ read path`; `Ctrl+O` shows the full output; a long
   path in a narrow terminal ends in `…` and, expanded, wraps under its details.
2. While bash runs: `• bash [⏱ Ns] <cmd>`, counter advancing each second.
3. An error: red `✗` (glyph, label and gutter).
4. `thinkingAsToolCall` on: `• think …` streaming, `✓ think …` when done;
   `Ctrl+T` expands; off restores Pi's native rows, also on existing messages.
5. Click a folded run: it opens under a muted `▾ Expanded · click to fold`
   header; click the header to fold it again; same for a "Worked for …" summary.

---

## 7. Reload semantics

- After changing `core-patch.ts`: fully quit and restart Pi. The wrappers apply
  once per process (`PATCHED` marker), so `/reload` cannot replace one.
- The same goes for what the wrappers close over at runtime: `FoldableProse` and
  `EmptyComponent` in `components.ts` (with the `renderRow` and `wrapped` they
  call) and `readBridge` / `BRIDGE_SYMBOLS` in `bridge.ts`. A reload re-imports
  those modules, but surviving wrappers keep the old copies. The `Bridge` object
  itself is NOT affected: it is read at call time.
- Otherwise `/reload` is enough for `index.ts` and `src/`.
- Reload while idle; avoid it during a running tool or an open overlay.
- Each reload overwrites the bridge object. Do NOT clear it from
  `session_shutdown`: reload ordering can let an old shutdown hook erase the new
  bridge. Process exit clears globalThis. If the extension is disabled, restart
  once to clear its globals.

## 8. Scope

No config format, runtime dependency or abstraction layer unless a real
requirement appears. Only Pi's installed packages and the Node standard library,
including for tests. `package.json` is only the Pi package manifest
(`pi.extensions` → `index.ts`); Pi's packages are `peerDependencies: "*"` and are
never bundled. No `dependencies`, no build step.
