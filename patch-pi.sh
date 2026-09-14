#!/usr/bin/env bash
# =============================================================================
# patch-pi.sh — Re-apply the pi-minimalist core bridges after a Pi update
# =============================================================================
#
# WHY THIS EXISTS
# ---------------
# Everything that Pi's public extension API can express lives in the extension
# itself and survives Pi updates on its own. Only the gaps below need bridges
# written directly into Pi's compiled output, because the public API cannot:
#   1. replace rendering for a built-in tool while keeping its builtin identity
#      (registerTool() would take ownership and break pi-subagents discovery)
#   2. give EVERY tool (MCP / third-party, unknown names) a default renderer
#   3. render/observe thinking blocks or assistant prose in the transcript
#   4. suppress the parent Spacer(1) of a hidden tool/assistant row
#
# NOTE: the elapsed timer needs NO bridge. `context.invalidate()` is public API
# and already recomputes + repaints the row, so no `ui` handle is exposed.
#
# NOTE: Markdown chrome (code-block corners `╭ │ ╰` + blockquote `▌`) needs NO
# bridge either. `MarkdownTheme.codeBlockBorder`/`.quoteBorder` receive the
# literal frame text and may REWRITE it, not just recolor it, and the vertical
# code edge is the public `codeBlockIndent` field (settings
# `markdown.codeBlockIndent`). See src/markdown-chrome.ts. pi-tui's
# markdown.js is therefore NOT patched.
#
# These edits live in Pi's compiled JS, so a Pi upgrade overwrites them.
# Run this script once after any `npm i -g @earendil-works/pi-coding-agent`
# update to re-apply them. It is IDEMPOTENT: safe to run repeatedly, it only
# patches files that are missing the marker (never double-inserts).
#
# USAGE
# -----
#   ~/.pi/agent/extensions/pi-minimalist/patch-pi.sh
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

# NOTE: no `ui` bridge here on purpose. The elapsed timer uses the PUBLIC
# `context.invalidate()` from ToolRenderContext, which re-runs updateDisplay and
# repaints. Exposing `this.ui` was redundant, so that patch was removed.

# -----------------------------------------------------------------------------
# Patch 2: suppress parent spacer for hidden quiet tool rows
# -----------------------------------------------------------------------------
# ToolExecutionComponent adds a leading Spacer before its renderer. A hidden
# CompactLine otherwise leaves that blank row in history, so ask quiet mode at
# render time whether this tool's spacer belongs in the transcript.
# -----------------------------------------------------------------------------
QUIET_SPACER_MARKER='Symbol.for("pi.minimalist.quietSpacer")'
if ! grep -qF "$QUIET_SPACER_MARKER" "$CORE"; then
  echo "Patching core: suppress hidden quiet tool spacers"
  perl -0pi -e 's/this\.addChild\(new Spacer\(1\)\);/this.addChild({\n            render: () => globalThis[Symbol.for("pi.minimalist.quietSpacer")]?.(this.toolCallId) === false ? [] : [""],\n            invalidate() { },\n        });/' "$CORE"
  patched=1
else
  echo "Core: quiet spacer bridge already present, skipping"
fi

if ! grep -qF "$QUIET_SPACER_MARKER" "$BUNDLE"; then
  echo "Patching bundle: suppress hidden quiet tool spacers"
  perl -0pi -e 's/this\.addChild\(new Spacer\(1\)\),this\.contentBox=/this.addChild({render:()=>globalThis[Symbol.for("pi.minimalist.quietSpacer")]?.(this.toolCallId)===!1?[]:[""],invalidate(){}}),this.contentBox=/' "$BUNDLE"
  patched=1
else
  echo "Bundle: quiet spacer bridge already present, skipping"
fi

# -----------------------------------------------------------------------------
# Patch 3: thinking bridges (assistant-message.js + bundle)
#   collapsed thinking preview — Pi shows a bare "Thinking..." label when a
#   thinking block is hidden (Ctrl+T); the extension renders a compact one-line
#   preview instead, via globalThis[Symbol.for("pi.thinkingPreview")].
#   A normally hidden block is forced open while its message streams, then
#   returns to its existing override/default visibility after completion.
#
# NOTE: there is no `pi.contentWrap` gutter bridge. Expanded thinking is purple
# text with NO outer gutter, so that patch was removed instead of being left in
# as a hook the extension deliberately deleted on load.
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

QUIET_MESSAGE_SPACER_MARKER='Symbol.for("pi.minimalist.quietMessageSpacer")'
if ! grep -qF "$QUIET_MESSAGE_SPACER_MARKER" "$ASSISTANT"; then
  echo "Patching assistant-message: suppress hidden quiet message spacers"
  perl -0pi -e 's/(if \(hasVisibleContent\) \{\n            )this\.contentContainer\.addChild\(new Spacer\(1\)\);/${1}this.contentContainer.addChild({\n                render: () => globalThis[Symbol.for("pi.minimalist.quietMessageSpacer")]?.(this) === false ? [] : [""],\n                invalidate() { },\n            });/' "$ASSISTANT"
  patched=1
else
  echo "Assistant: quiet message spacer bridge already present, skipping"
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

if ! grep -qF 'Symbol.for("pi.minimalist.quietMessageSpacer")' "$BUNDLE"; then
  echo "Patching bundle: suppress hidden quiet message spacers"
  perl -0pi -e 's/&&this\.contentContainer\.addChild\(new Spacer\(1\)\);let thinkingRunIndex=0;/\&\&this.contentContainer.addChild({render:()=>globalThis[Symbol.for("pi.minimalist.quietMessageSpacer")]?.(this)===!1?[]:[""],invalidate(){}});let thinkingRunIndex=0;/' "$BUNDLE"
  patched=1
else
  echo "Bundle: quiet message spacer bridge already present, skipping"
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
# Verify: syntax-check all patched files so a bad regex never leaves Pi broken.
# -----------------------------------------------------------------------------
echo "Verifying syntax..."
node --check "$BUNDLE"
node --check "$CORE"
node --check "$ASSISTANT"
echo "Syntax OK."

if [ "$patched" -eq 1 ]; then
  echo ""
  echo "Patched. Restart Pi fully for changes to take effect."
else
  echo ""
  echo "Nothing to patch — bridges already applied."
fi
