#!/usr/bin/env bash
# =============================================================================
# patch-pi.sh — Re-apply the compact-tool-renderer core bridge after a Pi update
# =============================================================================
#
# WHY THIS EXISTS
# ---------------
# The compact-tool-renderer extension is pure API (pi.registerTool()) and
# survives Pi updates on its own. BUT two small "bridges" had to be written
# directly into Pi's compiled output because the public API has no way to:
#   1. give EVERY tool (MCP / third-party, unknown names) a default renderer
#   2. expose the TUI `ui` handle so the elapsed timer can repaint live
#
# Those two edits live in Pi's compiled JS, so a Pi upgrade overwrites them.
# Run this script once after any `npm i -g @earendil-works/pi-coding-agent`
# update to re-apply them. It is IDEMPOTENT: safe to run repeatedly, it only
# patches files that are missing the marker (never double-inserts).
#
# USAGE
# -----
#   ~/.pi/agent/extensions/compact-tool-renderer/patch-pi.sh
#
# After patching, fully restart Pi (the running process still has the old
# compiled modules cached in memory).
# =============================================================================
set -euo pipefail

# Resolve Pi's real install path (the `pi` binary on PATH points at it).
# readlink -f resolves symlinks so we patch the actual files, not a link.
# The pi binary lives at <root>/dist/bundle/cli.js, so three dirname steps
# walk from the file → bundle → dist → package root.
PI_BIN="$(readlink -f "$(command -v pi)")"
PI_ROOT="$(dirname "$(dirname "$(dirname "$PI_BIN")")")"

# The two files we patch: the bundled CLI (what `pi` actually runs) and the
# unbundled component (kept in sync for direct imports / future builds).
BUNDLE="$PI_ROOT/dist/bundle/chunks/chunk-JVUZSMYM.js"
CORE="$PI_ROOT/dist/modes/interactive/components/tool-execution.js"
# Thinking blocks render in this third file (also patched in both forms).
ASSISTANT="$PI_ROOT/dist/modes/interactive/components/assistant-message.js"

# Marker strings. We check for the exact bridge code we insert (not just the
# symbol name) so that a leftover reference elsewhere in the file can never
# cause a false "already patched" skip. If the exact code is absent, we patch.
BUNDLE_MARKER='getCallRenderer(){let renderer=globalThis[Symbol.for("pi.defaultToolRenderer")]'
CORE_MARKER='if (renderer?.handles?.(this.toolName) && renderer.renderCall)'

patched=0

# -----------------------------------------------------------------------------
# Patch 1: default tool renderer bridge (both files)
# -----------------------------------------------------------------------------
# Core consults a process-global renderer in two modes:
# 1. `handles(name)` — replace rendering ONLY for selected native tools while
#    preserving their built-in definitions/source ownership (pi-subagents needs
#    that ownership to expose read/bash/write to child runtimes).
# 2. No native renderers — generic fallback for rendererless third-party tools.
# -----------------------------------------------------------------------------
if ! grep -qF "$BUNDLE_MARKER" "$BUNDLE"; then
  echo "Patching bundle: named/default tool renderer bridge"
  # Replace the renderer-selection methods as one bounded block. This matches
  # both clean Pi and the older fallback-only bridge from previous releases.
  perl -0pi -e 's/getCallRenderer\(\)\{.*?\}getRenderContext/getCallRenderer(){let renderer=globalThis[Symbol.for("pi.defaultToolRenderer")];return renderer?.handles?.(this.toolName)\&\&renderer.renderCall?(args,renderTheme,context)=>renderer.renderCall(this.toolName,args,renderTheme,context):this.toolDefinition?.renderCall}getResultRenderer(){let renderer=globalThis[Symbol.for("pi.defaultToolRenderer")];if(renderer?.handles?.(this.toolName)\&\&renderer.renderResult){let nativeRenderer=this.toolDefinition?.renderResult;return(result,options,renderTheme,context)=>renderer.renderResult(this.toolName,result,options,renderTheme,context,nativeRenderer)}return this.toolDefinition?.renderResult}hasRendererDefinition(){return this.toolDefinition!==void 0}getRenderShell(){let renderer=globalThis[Symbol.for("pi.defaultToolRenderer")],handlesTool=renderer?.handles?.(this.toolName)===!0,rendererlessTool=!this.toolDefinition?.renderCall\&\&!this.toolDefinition?.renderResult;return(handlesTool||rendererlessTool)\&\&renderer?.renderShell?renderer.renderShell:this.toolDefinition?.renderShell??"default"}getRenderContext/s' "$BUNDLE"
  # Generic fallback paths for rendererless tools.
  perl -0pi -e 's/createCallFallback\(\)\{return new Text\(theme\.fg\("toolTitle",theme\.bold\(this\.toolName\)\),0,0\)\}/createCallFallback(){let renderer=globalThis[Symbol.for("pi.defaultToolRenderer")]?.renderCall,component=renderer?.(this.toolName,this.args,theme,this.getRenderContext(void 0));return component??new Text(theme.fg("toolTitle",theme.bold(this.toolName)),0,0)}/' "$BUNDLE"
  perl -0pi -e 's/createResultFallback\(\)\{let output=this\.getTextOutput\(\);/createResultFallback(){let renderer=globalThis[Symbol.for("pi.defaultToolRenderer")]?.renderResult,component=renderer?.(this.toolName,this.result,{expanded:this.expanded,isPartial:this.isPartial},theme,this.getRenderContext(void 0));if(component!==void 0)return component;let output=this.getTextOutput();/' "$BUNDLE"
  patched=1
else
  echo "Bundle: named/default tool renderer bridge already present, skipping"
fi

if ! grep -qF "$CORE_MARKER" "$CORE"; then
  echo "Patching core: named/default tool renderer bridge"
  perl -0pi -e 's/    getCallRenderer\(\) \{.*?    getRenderContext/    getCallRenderer() {\n        const renderer = globalThis[Symbol.for("pi.defaultToolRenderer")];\n        if (renderer?.handles?.(this.toolName) \&\& renderer.renderCall) {\n            return (args, renderTheme, context) => renderer.renderCall(this.toolName, args, renderTheme, context);\n        }\n        return this.toolDefinition?.renderCall;\n    }\n    getResultRenderer() {\n        const renderer = globalThis[Symbol.for("pi.defaultToolRenderer")];\n        if (renderer?.handles?.(this.toolName) \&\& renderer.renderResult) {\n            const nativeRenderer = this.toolDefinition?.renderResult;\n            return (result, options, renderTheme, context) => renderer.renderResult(this.toolName, result, options, renderTheme, context, nativeRenderer);\n        }\n        return this.toolDefinition?.renderResult;\n    }\n    hasRendererDefinition() {\n        return this.toolDefinition !== undefined;\n    }\n    getRenderShell() {\n        const renderer = globalThis[Symbol.for("pi.defaultToolRenderer")];\n        const handlesTool = renderer?.handles?.(this.toolName) === true;\n        const rendererlessTool = !this.toolDefinition?.renderCall \&\& !this.toolDefinition?.renderResult;\n        if ((handlesTool || rendererlessTool) \&\& renderer?.renderShell) {\n            return renderer.renderShell;\n        }\n        return this.toolDefinition?.renderShell ?? "default";\n    }\n    getRenderContext/s' "$CORE"
  perl -0pi -e 's/createCallFallback\(\) \{\n        return new Text\(theme\.fg\("toolTitle", theme\.bold\(this\.toolName\)\), 0, 0\);\n    \}/createCallFallback() {\n        const renderer = globalThis[Symbol.for("pi.defaultToolRenderer")]?.renderCall;\n        const component = renderer?.(this.toolName, this.args, theme, this.getRenderContext(undefined));\n        return component ?? new Text(theme.fg("toolTitle", theme.bold(this.toolName)), 0, 0);\n    }/' "$CORE"
  perl -0pi -e 's/createResultFallback\(\) \{\n        const output = this\.getTextOutput\(\);/createResultFallback() {\n        const renderer = globalThis[Symbol.for("pi.defaultToolRenderer")]?.renderResult;\n        const component = renderer?.(this.toolName, this.result, { expanded: this.expanded, isPartial: this.isPartial }, theme, this.getRenderContext(undefined));\n        if (component !== undefined) {\n            return component;\n        }\n        const output = this.getTextOutput();/' "$CORE"
  patched=1
else
  echo "Core: named/default tool renderer bridge already present, skipping"
fi

# -----------------------------------------------------------------------------
# Patch 2: expose TUI `ui` handle in the renderer context
# -----------------------------------------------------------------------------
# The elapsed timer needs to repaint every second while a tool runs. The
# renderer context now carries `ui`, so the extension can call
# ui.requestRender() to animate the timer without recursing into render().
# -----------------------------------------------------------------------------
if ! grep -q 'ui: this.ui' "$CORE"; then
  echo "Patching core: expose ui in render context"
  perl -0pi -e 's/(invalidate: \(\) => \{\n                this\.invalidate\(\);\n                this\.ui\.requestRender\(\);\n            \},)/$1\n            \/\/ Expose the TUI so renderers can schedule repaints (e.g. spinner\n            \/\/ animation) without recursing into render().\n            ui: this.ui,/' "$CORE"
  patched=1
else
  echo "Core: ui exposure already present, skipping"
fi

# Bundle equivalent: same field added to the minified getRenderContext object.
if ! grep -qF 'ui:this.ui' "$BUNDLE"; then
  echo "Patching bundle: expose ui in render context"
  perl -0pi -e 's/(invalidate:\(\)=>\{this\.invalidate\(\),this\.ui\.requestRender\(\)\},)/$1ui:this.ui,/' "$BUNDLE"
  patched=1
else
  echo "Bundle: ui exposure already present, skipping"
fi

# -----------------------------------------------------------------------------
# Patch 3: thinking bridges (assistant-message.js + bundle). Two bridges:
#   a) collapsed thinking preview — Pi shows a bare "Thinking..." label when a
#      thinking block is hidden (Ctrl+T); the extension renders a compact
#      one-line preview instead, via globalThis[Symbol.for("pi.thinkingPreview")].
#      A normally hidden block is forced open while its message streams, then
#      returns to its existing override/default visibility after completion.
#   b) expanded thinking gutter — the expanded thinking block (native Markdown)
#      gets wrapped by globalThis[Symbol.for("pi.contentWrap")] so every line
#      carries the purple thinking gutter, matching the collapsed preview.
# -----------------------------------------------------------------------------
ASSISTANT_MARKER='Symbol.for("pi.thinkingPreview")'
if ! grep -qF "$ASSISTANT_MARKER" "$ASSISTANT"; then
  echo "Patching assistant-message: thinking preview bridge"
  perl -0pi -e 's/(const hidden = this\.thinkingVisibilityOverrides\.get\(runIndex\) \?\? this\.hideThinkingBlock;\n                const thinkingComponent = hidden\n                    \? )new Text\(theme\.italic\(theme\.fg\("thinkingText", this\.hiddenThinkingLabel\)\), this\.outputPad, 0\)/$1(globalThis[Symbol.for("pi.thinkingPreview")] ? globalThis[Symbol.for("pi.thinkingPreview")](thinkingBlocks.join("\\n"), theme, this.outputPad, this.isStreaming, this, runIndex) : new Text(theme.italic(theme.fg("thinkingText", this.hiddenThinkingLabel)), this.outputPad, 0))/' "$ASSISTANT"
  patched=1
else
  echo "Assistant: thinking preview bridge already present, skipping"
fi

if ! grep -qF 'this.isStreaming, this, runIndex' "$ASSISTANT"; then
  echo "Patching assistant-message: stable thinking preview identity"
  perl -0pi -e 's/this\.outputPad, this\.isStreaming\) : new Text/this.outputPad, this.isStreaming, this, runIndex) : new Text/' "$ASSISTANT"
  patched=1
else
  echo "Assistant: stable thinking preview identity already present, skipping"
fi

# Pi only exposes streaming state for the whole assistant message. Respect a
# user's per-block visibility choice once complete, but force open live thought.
STREAMING_THINKING_MARKER='const hidden = this.isStreaming ? false :'
if ! grep -qF "$STREAMING_THINKING_MARKER" "$ASSISTANT"; then
  echo "Patching assistant-message: expand streaming thinking"
  perl -0pi -e 's/const hidden = this\.thinkingVisibilityOverrides\.get\(runIndex\) \?\? this\.hideThinkingBlock;/const hidden = this.isStreaming ? false : (this.thinkingVisibilityOverrides.get(runIndex) ?? this.hideThinkingBlock);/' "$ASSISTANT"
  patched=1
else
  echo "Assistant: streaming thinking behavior already present, skipping"
fi

QUIET_THINKING_MARKER='Symbol.for("pi.minimalist.quietThinking")'
if ! grep -qF "$QUIET_THINKING_MARKER" "$ASSISTANT"; then
  echo "Patching assistant-message: quiet thinking aggregation bridge"
  perl -0pi -e 's/(const hidden = this\.isStreaming \? false : \(this\.thinkingVisibilityOverrides\.get\(runIndex\) \?\? this\.hideThinkingBlock\);\n                )const thinkingComponent/${1}globalThis[Symbol.for("pi.minimalist.quietThinking")]?.(this, runIndex, this.isStreaming, hidden);\n                const thinkingComponent/' "$ASSISTANT"
  patched=1
else
  echo "Assistant: quiet thinking aggregation bridge already present, skipping"
fi

QUIET_PROSE_MARKER='Symbol.for("pi.minimalist.quietProse")'
if ! grep -qF "$QUIET_PROSE_MARKER" "$ASSISTANT"; then
  echo "Patching assistant-message: quiet prose boundary bridge"
  perl -0pi -e 's/(if \(content\.type === "text" && content\.text\.trim\(\) \{\n                )\/\/ Assistant text/${1}globalThis[Symbol.for("pi.minimalist.quietProse")]?.(this, i);\n                \/\/ Assistant text/' "$ASSISTANT"
  patched=1
else
  echo "Assistant: quiet prose boundary bridge already present, skipping"
fi

THINKING_THEME_MARKER='Symbol.for("pi.thinkingMarkdownTheme")'
if ! grep -qF "$THINKING_THEME_MARKER" "$ASSISTANT"; then
  echo "Patching assistant-message: all-purple thinking Markdown bridge"
  perl -0pi -e 's/(globalThis\[Symbol\.for\("pi\.minimalist\.quietThinking"\)\]\?\.\(this, runIndex, this\.isStreaming, hidden\);\n                )const thinkingComponent/${1}const thinkingMarkdownTheme = globalThis[Symbol.for("pi.thinkingMarkdownTheme")]?.(this.markdownTheme, theme) ?? this.markdownTheme;\n                const thinkingComponent/' "$ASSISTANT"
  perl -0pi -e 's/(new Markdown\(thinkingBlocks\.join\("\\n\\n"\), this\.outputPad, 0, )this\.markdownTheme/$1thinkingMarkdownTheme/' "$ASSISTANT"
  patched=1
else
  echo "Assistant: all-purple thinking Markdown bridge already present, skipping"
fi

GUTTER_WRAP_MARKER='Symbol.for("pi.contentWrap")'
if ! grep -qF "$GUTTER_WRAP_MARKER" "$ASSISTANT"; then
  echo "Patching assistant-message: thinking gutter + prose top border bridges"
  perl -0pi -e 's/this\.contentContainer\.addChild\(new MouseRegion\(thinkingComponent, \(event\) => \{/const contentWrap = globalThis[Symbol.for("pi.contentWrap")];\n                this.contentContainer.addChild(new MouseRegion(hidden ? thinkingComponent : (contentWrap?.(thinkingComponent, "thinking", theme) ?? thinkingComponent), (event) => {/' "$ASSISTANT"
  patched=1
else
  echo "Assistant: content wrap bridges already present, skipping"
fi

# Bundle equivalent: same bridge added to the minified hidden-branch expression.
if ! grep -qF "$GUTTER_WRAP_MARKER" "$BUNDLE"; then
  echo "Patching bundle: thinking gutter + prose top border bridges"
  perl -0pi -e 's/addChild\(new MouseRegion\(thinkingComponent,event=>\{/addChild(new MouseRegion(hidden?thinkingComponent:(()=>{let contentWrap=globalThis[Symbol.for("pi.contentWrap")];return contentWrap?.(thinkingComponent,"thinking",theme)??thinkingComponent})(),event=>{/' "$BUNDLE"
  patched=1
else
  echo "Bundle: content wrap bridges already present, skipping"
fi

# Bundle preview bridge: same expression as the unbundled file, minified.
if ! grep -qF "$ASSISTANT_MARKER" "$BUNDLE"; then
  echo "Patching bundle: thinking preview bridge"
  perl -0pi -e 's/thinkingComponent=hidden\?new Text\(theme\.italic\(theme\.fg\("thinkingText",this\.hiddenThinkingLabel\)\),this\.outputPad,0\)/thinkingComponent=hidden?(globalThis[Symbol.for("pi.thinkingPreview")]?globalThis[Symbol.for("pi.thinkingPreview")](thinkingBlocks.join(`\n`),theme,this.outputPad,this.isStreaming,this,runIndex):new Text(theme.italic(theme.fg("thinkingText",this.hiddenThinkingLabel)),this.outputPad,0))/' "$BUNDLE"
  patched=1
else
  echo "Bundle: thinking preview bridge already present, skipping"
fi

if ! grep -qF 'this.isStreaming,this,runIndex' "$BUNDLE"; then
  echo "Patching bundle: stable thinking preview identity"
  perl -0pi -e 's/this\.outputPad,this\.isStreaming\):new Text/this.outputPad,this.isStreaming,this,runIndex):new Text/' "$BUNDLE"
  patched=1
else
  echo "Bundle: stable thinking preview identity already present, skipping"
fi

if ! grep -qF 'hidden=this.isStreaming?false:' "$BUNDLE"; then
  echo "Patching bundle: expand streaming thinking"
  perl -0pi -e 's/hidden=this\.thinkingVisibilityOverrides\.get\(runIndex\)\?\?this\.hideThinkingBlock,/hidden=this.isStreaming?false:(this.thinkingVisibilityOverrides.get(runIndex)??this.hideThinkingBlock),/' "$BUNDLE"
  patched=1
else
  echo "Bundle: streaming thinking behavior already present, skipping"
fi

if ! grep -qF 'Symbol.for("pi.minimalist.quietThinking")' "$BUNDLE"; then
  echo "Patching bundle: quiet thinking aggregation bridge"
  perl -0pi -e 's/(hidden=this\.isStreaming\?false:\(this\.thinkingVisibilityOverrides\.get\(runIndex\)\?\?this\.hideThinkingBlock\),)thinkingComponent/${1}quietThinking=globalThis[Symbol.for("pi.minimalist.quietThinking")]?.(this,runIndex,this.isStreaming,hidden),thinkingComponent/' "$BUNDLE"
  patched=1
else
  echo "Bundle: quiet thinking aggregation bridge already present, skipping"
fi

if ! grep -qF 'Symbol.for("pi.thinkingMarkdownTheme")' "$BUNDLE"; then
  echo "Patching bundle: all-purple thinking Markdown bridge"
  perl -0pi -e 's/(quietThinking=globalThis\[Symbol\.for\("pi\.minimalist\.quietThinking"\)\]\?\.\(this,runIndex,this\.isStreaming,hidden\),)thinkingComponent/${1}thinkingMarkdownTheme=globalThis[Symbol.for("pi.thinkingMarkdownTheme")]?.(this.markdownTheme,theme)??this.markdownTheme,thinkingComponent/' "$BUNDLE"
  perl -0pi -e 's/(\),this\.outputPad,0,)this\.markdownTheme,\{color:text=>theme\.fg\("thinkingText",text\),italic:!0\}/$1thinkingMarkdownTheme,{color:text=>theme.fg("thinkingText",text),italic:!0}/' "$BUNDLE"
  patched=1
else
  echo "Bundle: all-purple thinking Markdown bridge already present, skipping"
fi

if ! grep -qF 'Symbol.for("pi.minimalist.quietProse")' "$BUNDLE"; then
  echo "Patching bundle: quiet prose boundary bridge"
  perl -0pi -e 's/(if\(content\.type==="text"&&content\.text\.trim\(\))this\.contentContainer/${1}globalThis[Symbol.for("pi.minimalist.quietProse")]?.(this,i),this.contentContainer/' "$BUNDLE"
  patched=1
else
  echo "Bundle: quiet prose boundary bridge already present, skipping"
fi

# -----------------------------------------------------------------------------
# Patch 5: thick markdown blockquote gutter (pi-tui markdown.js + bundle)
# -----------------------------------------------------------------------------
# Pi hard-codes the thin │ prefix for every rendered blockquote line. Replace
# it with ▌ (same half-block as the tool-call gutter); signal.json maps
# mdQuoteBorder to text (white).
# -----------------------------------------------------------------------------
MARKDOWN="$PI_ROOT/node_modules/@earendil-works/pi-tui/dist/components/markdown.js"

if ! grep -qF 'quoteBorder("▌ ")' "$MARKDOWN"; then
  echo "Patching pi-tui markdown: thick blockquote gutter"
  perl -0pi -e 's/quoteBorder\("│ "\)|quoteBorder\("█ "\)/quoteBorder("▌ ")/' "$MARKDOWN"
  patched=1
else
  echo "pi-tui markdown: thick blockquote gutter already present, skipping"
fi

if ! grep -qF 'quoteBorder("\u258c ")' "$BUNDLE"; then
  echo "Patching bundle: thick blockquote gutter"
  perl -0pi -e 's/quoteBorder\("\\u2502 "\)|quoteBorder\("\\u2588 "\)/quoteBorder("\\u258c ")/' "$BUNDLE"
  patched=1
else
  echo "Bundle: thick blockquote gutter already present, skipping"
fi

# -----------------------------------------------------------------------------
# Verify: syntax-check all patched files so a bad regex never leaves Pi broken.
# -----------------------------------------------------------------------------
echo "Verifying syntax..."
node --check "$BUNDLE"
node --check "$CORE"
node --check "$ASSISTANT"
node --check "$MARKDOWN"
echo "Syntax OK."

if [ "$patched" -eq 1 ]; then
  echo ""
  echo "Patched. Restart Pi fully for changes to take effect."
else
  echo ""
  echo "Nothing to patch — bridges already applied."
fi
