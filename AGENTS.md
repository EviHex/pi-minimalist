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
defaults  <  global agent settings.json (PI_CODING_AGENT_DIR respected)
```

```json
"minimalist": {
  "preset": "custom",
  "compactToolRows": true,
  "groupToolRuns": true,
  "foldIntermediateActivity": false,
  "activitySummary": "elapsed",
  "gutter": true,
  "timer": true,
  "thinkingAsToolCall": false,
  "keepActiveToolsExpanded": false,
  "keepActiveThinkingExpanded": false,
  "glyphStyle": "unicode",

  "excludeTools": ["subagent"],
  "glyphs": {},
  "tokens": {}
}
```

- `/minimalist` opens an editor built on pi-tui's `SettingsList` — the same
  component `/settings` uses, so arrow keys, hover descriptions and Enter/Space
  cycling behave identically. `/minimalist config` remains an alias.
- `/minimalist status` prints the current state. The editor has no reset
  row: the presets are the reset points, and a
  hand-written advanced value or unrelated Pi setting is never touched.

### Presets are a layer, not a write

A preset names exactly four keys (`LOOK_KEYS`: `compactToolRows`,
`groupToolRuns`, `foldIntermediateActivity`, `thinkingAsToolCall`). `Config`
keeps the user's own values in `settings` and computes the effective view on read
(`layer()`: user keys < the preset's four look keys; `custom` adds nothing).
Choosing off/lite/full/max therefore never touches the user's keys, and every
other setting (Left border, Symbols, ...) stays the user's own and stays editable.
Advanced keys (`glyphs`, `tokens`, `excludeTools`) are never preset.

- **Greyed rows.** `SettingsList` has no disabled rows, so under a preset each
  look row's ONLY value is its dimmed current text: Enter "cycles" to the same
  text and `onChange` returns early. The row's description says to switch to
  `custom`; the footer stays generic.
- **Default.** A fresh install gets `full` (`FRESH_PRESET`). "Fresh" means the
  `minimalist` block holds no basic key (`isFresh`), including no block at all. A
  user who never configured anything therefore moves from the old defaults to
  `full`: thinking rows become compact. An existing block with any basic key but
  no `preset` key stays `custom`, unchanged. The first write pins
  `"preset": "full"` into a fresh block, so saving one setting does not flip the
  user to `custom`.
- **First switch to `custom`** (index.ts `persist` + `customSeed`) writes the
  `lite` look keys, but only when the file has none of the four look keys. Existing
  own values are left untouched.
- There is deliberately no reset row: presets are the reset points and delete
  nothing.

→ `config.test.ts` "presets", `config-ui.test.ts` "presets in the config screen".

### Which settings are discoverable, and why

The twelve keys above the blank line are in the command, including `preset` and
`glyphStyle`
(Unicode / ASCII). The two prose sub-options appear only while
`foldIntermediateActivity` is on. The three below are JSON-only: they need
exact tool names or knowledge of Pi's theme palette, and putting them in a
chooser would imply they are casual choices.

The default symbols are ordinary Unicode, not Nerd Font private-use glyphs:
no Nerd Font is required. If a font lacks a glyph or terminal width handling
misaligns it, the `ascii` preset uses only one-column symbols.

### Writing rules

The `/minimalist` editor writes only the changed basic key in the global
`minimalist` block (a preset switch to `custom` may add the four seeded look keys).
Project-local `minimalist` blocks are ignored, not migrated or deleted.
Hand-written `glyphs`/`tokens`/`excludeTools` survive every write.
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
   consult one process-global `Bridge` object that this extension fills.

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

### The bridge

`bridge.ts` owns `BRIDGE_SYMBOLS` (the single source of the global key names) and
the typed `Bridge` object: the tool renderer, the thinking preview, the
chronology/fold hooks and two settings reads. The wrappers call `readBridge()` at
CALL time, so a `/reload` that installs a new object swaps behavior without
re-wrapping, and an unloaded extension (no object) degrades to Pi's native
rendering.

`config` and `grouping` live in their own slots so they survive `/reload`:
existing transcript rows close over them and resolve their appearance at render
time, so replacing an instance would strand every row on stale state. The
`Bridge` closes over those same two instances.

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

### A folded summary must never jump over something visible

A summary is drawn at the position of its LAST member. So every visible transcript
item between two foldable rows must cut the run, or the summary lands after it.
`RunGrouping.views()` therefore ends a run at (a) any non-foldable entry, and (b) an
entry of another agent `cycle` (a new user prompt). Visible things we never draw are
observed as `kind: "other"` barriers (`observeBarrier`, bridge `observeBarrier`):
a tool card we do not claim (`syncShell` in `patchToolExecution`: `subagent`, any
`excludeTools` name, or every tool while `compactToolRows` is off) and a user message
(`patchUserMessage`, wraps `UserMessageComponent.rebuild`). They are never folded
into a "Worked for" summary or its tool counts (`activityFoldable`, `isAction`). Known
limit: a "Worked for" summary still sits at its last folded row, so it can appear
below a barrier card that was inside the same cycle. → `core-patch.test.ts`, "a folded
run never jumps over something visible".

### A failed row is red all over

`tool-renderer.ts` passes `labelColor: status.color` (as well as `glyphColor`) to
`Painter.labeled`, whose gutter follows the label colour. Before, only the glyph was
red and the label and gutter stayed green in every state. → `tool-renderer.test.ts`,
"paints a failed row in the error colour".

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

### A cycle of prose only never folds

`foldIntermediateActivity` folds a cycle only when something before its latest prose is not prose (a tool row or a thinking row); consecutive assistant text alone stays fully visible, with no "Worked for" summary and normal spacing, in both `activitySummary` modes. The check is in `RunGrouping.views()`. → `run-grouping.test.ts`, "never folds a cycle of prose only", `core-patch.test.ts`, "leaves a prose-only cycle fully visible".

### Thinking and prose ids follow the MESSAGE, not the component

Pi builds NEW `AssistantMessageComponent`s for the same messages on every rebuild
(`rebuildChatFromMessages`: Ctrl+T, tree navigation, ...). Ids made from the
component instance left ghost thinking/prose entries behind: the folded summary
counted them (`think ×6` for three visible rows), and clicking it opened rows
that did not exist. `RunGrouping` therefore keys `think:`/`prose:` ids on
`message.timestamp` (set once when streaming starts, so partial and final
messages agree) and falls back to the component number only without one. A
rebuilt component re-observes the SAME entries in place. Tool rows were never
affected (they use `toolCallId`). Test messages need unique timestamps
(`assistantMessage()` in `core-patch.test.ts` counts up). → `core-patch.test.ts`,
"keeps the run count right when Pi rebuilds the chat from its messages", "does
not count an empty thinking block, before or after a rebuild", "keeps rebuilt
prose and an opened run on the same entries". Still open: entries of a previous
session are never dropped on a session switch.

### Session replay rebuilds interaction boundaries from finalized answers

Replayed history emits no `agent_start` / `agent_settled` events. Without a
fallback, every old message lands in cycle 0 and activity folding preserves only
the final prose of the entire session. A newly observed, non-streaming
message with `stopReason === "stop"` (one that continues with tools ends in `toolUse`) closes the replay cycle AFTER assigning
that answer, so every historical user interaction keeps its own final prose. →
`core-patch.test.ts`, "preserves each historical interaction's final prose during
session replay".

### Live renderer switches must replace the attached tool shell

Pi attaches one shell in `ToolExecutionComponent`'s constructor. Changing the live
renderer getters alone leaves existing rows displaying the old shell. The runtime
wrapper synchronizes `children[1]` (after the leading spacer), rebuilds only on
ownership/shell transitions, and drops stale renderer components/tickers. Keep
native self-shell tools in mind: ownership may change without a shell change. →
`core-patch.test.ts`, "switches an existing built-in row between compact and
native shells", "rebuilds the renderer when ownership changes but a native
self shell stays attached".

### Thinking off means native rendering, not a different compact-row color

`thinkingAsToolCall` controls ownership of BOTH collapsed previews and expanded
Markdown recoloring. Off keeps Pi's original components, without the gutter or
`think` label. `patchAssistantMessage` rebuilds from `lastMessage` only when that
setting changes, so existing rows switch live without losing click overrides.
Native thinking breaks tool-run groups; the separately enabled activity fold and
streaming expansion still apply. → `core-patch.test.ts`, "restores exact native
thinking rendering and switches existing messages live".

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
spacers left by fully hidden mixed assistant messages", and "folds earlier prose
into one summary with a single leading blank when a final answer streams in".

### A click on a summary opens the run; it must not reach Pi's toggle

A summary is drawn by ONE member (the tail); the others draw zero lines, so
every click lands in the tail's `MouseRegion` and Pi expanded only that row.
`CompactLine.handleMouse` asks `RunGrouping.open()` first (MouseRegion consults
its child before `onMouse`); a handled click opens every member for the session.
`RunGrouping.opened` maps every member id to ONE shared run object, which stops
BOTH folds on purpose: a row the user opened stays visible, even when later
prose starts a new "Worked for" summary.

An opened run keeps a HEADER: `▾ Expanded · click to fold` (`v Expanded - click to
fold` in ASCII; `Painter.header()`, muted colour, no gutter bar — three blank columns
instead, so its text starts where the rows below start, and no padding at all when
the gutter is off; no counts, same text for tool runs
and "Worked for" runs). It is followed by exactly ONE blank line, then the member's
normal output: the host draws `[header, "", ...own lines]` (`CompactLine`,
`FoldableProse`), so the blank is never doubled — the member's own leading spacer sits
ABOVE the header, outside the host. The header is ALWAYS drawn by the FIRST member of
the opened run (`run.members[0]`, transcript order; `RunGrouping.headerFor`), whatever
its kind and whether or not Ctrl+T expanded it. There is no "which member can host it"
search: every member kind has a host that can draw it, all with a click handler:

- `CompactLine`: a tool row, or a collapsed compact thinking row. The header is `Row.header`.
- `FoldableProse` around assistant prose, around NATIVE thinking
  (`thinkingAsToolCall` off, expanded or not) and around EXPANDED compact thinking
  (the recolored Markdown; `patchAssistantMessage` recolors it in place, then wraps it
  in `foldable()` inside its `MouseRegion`). It draws the summary, or — for the
  head of an opened run — the header line ABOVE Pi's unchanged output
  (bridge `proseHeader`).

Do not bring back a "dynamic head" that skips a member that cannot host the header: it
made the header jump below an expanded thinking row. Both hosts remember
whether their last render drew a header and pass `onHeader = headed && event.y === 0`
to the click callback (`RunGrouping.click`): header → `close()` (members leave
`opened`, the run folds again, the tail opens it again); anything else → `open()`,
which returns false for a visible member so Pi expands only that row.
`FoldableProse` is only clickable on its summary or its header line; a click on the
native output below (prose body, a thinking row) is not handled, so Pi's own
thinking toggle keeps working. `event.y` is local to the host because Container
subtracts earlier siblings (the tool spacer, the message spacer), so never compare
it with the host's line numbers. Only host line 0 is the header: the blank at line 1
and everything below are not handled by us (Pi's own click applies). The header view is
not a "summary" view, so the assistant-message `y` shift below does not apply to it. The header is shown only while the fold that made
it is on (`groupToolRuns` / `foldIntermediateActivity`). It is derived at render
time and does not depend on the members' counts.

**Mouse `y` through the assistant message.** For a summary, the `render` wrapper
changes the lines AFTER `Container.render()` recorded its mouse layout
(`withOneLeadingBlank` adds or drops leading blanks), so Pi's `y` no longer matches
that layout: a summary alone in its message is drawn at row 1 but the Container
knows it at row 0, and the click falls off the end. The `handleMouse` wrapper on
the prototype translates `y` back by the same shift (remembered per component from
the last render; none when the view is not a summary). Do not remove it. →
`core-patch.test.ts`, "opens a clicked run summary instead of expanding only its
last row" (also covers header close and reopen), "opens a prose-hosted 'Worked for'
summary by click, and folds it back by its header" and "opens a summary hosted by
native (non-compact) thinking, and leaves its own toggle alone" (both drive Pi's
real `Container.handleMouse`), and `run-grouping.test.ts`, "re-folding an opened run".

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
  ├─ config-file.ts      settings.json I/O
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
| `src/config-file.ts` | global settings.json path, read/save, comment handling |
| `src/config-ui.ts` | `/minimalist` field list + `SettingsList` wiring |
| `src/bridge.ts` | `BRIDGE_SYMBOLS`, the `Bridge` type, `readBridge()`, `sharedState()`, `installBridges()` |
| `src/core-patch.ts` | the two runtime prototype wrappers |
| `src/row.ts` | `Row`/`RunSummary` model and `Painter`, the only thing that colors text |
| `src/components.ts` | `CompactLine`, `FoldableProse`, `EmptyComponent`, `GutteredComponent`, injectable `Timers` |
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
passed to `render()`. There is no other length cap (the old `maxDetailChars`
setting is gone; a leftover key in settings.json is ignored). A collapsed row
still slices its input to about twice the budget before the whitespace regex, so
a huge string is not fully scanned on every repaint; an expanded row shows
everything.

### An expanded row wraps; a collapsed row never does

On `Ctrl+O` the user asked to see everything, so an expanded call row gets no
detail budget and `Row.wrap` (`{ head, body }`): `CompactLine` wraps the details
under themselves, a hanging indent below `glyph label` (the timer badge is part of
the wrapped text, not of the indent, so its growth never shifts the continuation
lines), with the gutter on every line. An expanded row KEEPS the value's line
structure (`block()` in tools.ts): `\r\n` becomes `\n`, tabs become two spaces,
trailing whitespace and blank lines at the start and end go, and each source line
keeps its own leading indentation. `wrapTextWithAnsi` wraps every source line
separately, so a long line wraps and later lines still indent under the details.
A continuation of a wrapped, indented line is not re-indented (no hanging indent
inside the hanging indent). All tools whose details come from `describeTool`'s
text fields (bash, mcp, mcpScript, grep/find pattern, generic) share this path;
paths stay verbatim.

`Painter.labeled` keeps `Row.text` ONE line (whitespace collapsed) for the
collapsed and fold paths, and colors the wrap body line by line, so no color
escape spans a newline. Below 10 usable detail columns the row falls back to
truncating `Row.text`: the whole command on one clipped, space-joined line.
A collapsed row stays exactly one line. → `tool-renderer.test.ts`, "keeps an
expanded command's lines under the hanging indent; a collapsed one stays one
clipped row" and the tests after it.

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
   After `Ctrl+O`, the same row wraps under its details instead. A
   multi-line command (heredoc) then shows one source line per row.
3. Several tools in a row: one line each, one blank line before each.
4. `mcp`, `mcpScript` and an `mcp__<server>` proxy: `✓ mcp <operation> @ <server>`.
5. An unrendered IDE tool: `✓ tool_name <identifying argument>`.
6. While bash runs: `• bash [⏱ Ns] <cmd>`, no row background, counter advancing
   once per second even for a silent command.
7. `Ctrl+O`: full original output, with diffs and syntax highlighting intact.
8. An error: red `✗`.
9. With **Compact thinking rows** on: `• think …` while streaming,
   `✓ think <preview>` when done; `Ctrl+T` expands it. Off restores Pi's native
   thinking label and Markdown, including on existing messages. Streaming follows
   Pi's visibility setting; `keepActiveThinkingExpanded` shows it in full.
10. `/minimalist status`: one line per setting.
11. `/minimalist` (or `/minimalist config`): arrow keys, a description line for
    the hovered setting, Enter/Space cycling, a visible live-change/Ctrl+O hint —
    and the transcript behind the overlay changing as you toggle.
12. Set Symbols to ASCII: `+ bash …` with a `|` gutter, still aligned.
13. A long command with `groupToolRuns` on: counted in the summary's `•` group,
    not vanished.
14. `foldIntermediateActivity`: each new prose block folds every preceding prose,
    thinking and tool row into ONE summary; switching it off restores them all.
15. `activitySummary`: `Worked for 2m 7s` replaces prior tool rows rather than
    appearing after them; tool-count mode likewise emits one combined summary.
16. Click a folded run: it opens into separate rows under a muted
    `▾ Expanded · click to fold` header, then one blank line. Click
    one row: only that row expands. Click the header: the run folds back; click
    the summary again: it reopens. Same for a "Worked for …" summary, including one
    drawn at the start of an assistant message (prose or native thinking): the
    summary and the `▾` header are clickable there, the prose text below is not.

---

## 7. Reload semantics

- After changing `core-patch.ts`: fully quit and restart Pi. The wrappers are
  applied once per process (`PATCHED` marker), so `/reload` cannot replace one.
- The same goes for what the wrappers close over, i.e. what `core-patch.ts`
  imports at runtime: `FoldableProse` and `EmptyComponent` in `components.ts` (with
  the `renderRow` and `wrapped` they call) and `readBridge` / `BRIDGE_SYMBOLS` in
  `bridge.ts`. A reload re-imports those modules, but the surviving wrappers keep
  the old copies. (The `Bridge` object itself is NOT affected: it is read at call time.)
- Otherwise `/reload` is enough for `index.ts` and `src/`: everything else is
  reached through the `Bridge` object at call time.
- Reload while idle; avoid it during a running tool or an open overlay.
- Each reload overwrites the bridge object with a fresh one. Do NOT clear it
  from `session_shutdown`: reload ordering can let an old shutdown hook erase the
  newly installed bridge. Process exit clears globalThis naturally.
- If the extension is disabled, restart once to clear its globals.

## 8. Scope

No config format, runtime dependency or abstraction layer unless a real
requirement appears. Only Pi's installed packages and the Node standard
library, including for tests.

When adding or changing a renderer, add or update its test in the same commit:
this UI has regressed silently more than once, and these tests exist to name the
broken behavior instead of showing a large snapshot diff.

`package.json` exists only as the Pi package manifest (`pi.extensions` points at
`index.ts`). Pi's own packages are `peerDependencies` with `*`, as Pi's package
docs require: Pi provides them at runtime, so they must never be bundled. There
are no `dependencies` and no build step; keep it that way. A development
checkout can still be loaded by its explicit `index.ts` path, which bypasses
package discovery.
