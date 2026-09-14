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
# Only the bundled CLI is patched. The unbundled component files are SDK
# exports, not code the `pi` command runs; patching those dead mirrors doubled
# the upgrade surface and made tests verify the wrong runtime.
#
# A Pi upgrade overwrites the bundle. Re-run this script after an update. It is
# idempotent: marker checks prevent duplicate insertions.
#
# USAGE
# -----
#   ~/.pi/agent/extensions/pi-minimalist/patch-pi.sh
#
# After patching, fully restart Pi (the running process still has the old
# compiled modules cached in memory).
# =============================================================================
set -euo pipefail

# PI_ROOT override enables fixture tests. Otherwise derive it from the `pi`
# binary: <root>/dist/bundle/cli.js is three dirname calls below package root.
if [ -z "${PI_ROOT:-}" ]; then
  PI_BIN="$(readlink -f "$(command -v pi)")"
  PI_ROOT="$(dirname "$(dirname "$(dirname "$PI_BIN")")")"
fi

# Bundle chunk hashes change between releases. Find the one containing
# ToolExecutionComponent instead of baking today's hash into this script.
BUNDLE=""
for candidate in "$PI_ROOT"/dist/bundle/chunks/chunk-*.js; do
  if grep -qF 'createCallFallback()' "$candidate"; then
    if [ -n "$BUNDLE" ]; then
      echo "Error: multiple bundle chunks contain ToolExecutionComponent" >&2
      exit 1
    fi
    BUNDLE="$candidate"
  fi
done
if [ -z "$BUNDLE" ]; then
  echo "Error: could not find ToolExecutionComponent in Pi bundle" >&2
  exit 1
fi

BUNDLE_MARKER='getCallRenderer(){let renderer=globalThis[Symbol.for("pi.defaultToolRenderer")]'

patched=0

# -----------------------------------------------------------------------------
# Patch 1: default tool renderer bridge
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
if ! grep -qF "$QUIET_SPACER_MARKER" "$BUNDLE"; then
  echo "Patching bundle: suppress hidden quiet tool spacers"
  perl -0pi -e 's/this\.addChild\(new Spacer\(1\)\),this\.contentBox=/this.addChild({render:()=>globalThis[Symbol.for("pi.minimalist.quietSpacer")]?.(this.toolCallId)===!1?[]:[""],invalidate(){}}),this.contentBox=/' "$BUNDLE"
  patched=1
else
  echo "Bundle: quiet spacer bridge already present, skipping"
fi

# -----------------------------------------------------------------------------
# Patch 3: thinking bridges
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

if ! grep -qF "$ASSISTANT_MARKER" "$BUNDLE"; then
  echo "Patching bundle: thinking preview bridge"
  perl -0pi -e 's/thinkingComponent=hidden\?new Text\(theme\.italic\(theme\.fg\("thinkingText",this\.hiddenThinkingLabel\)\),this\.outputPad,0\)/thinkingComponent=hidden?(globalThis[Symbol.for("pi.thinkingPreview")]?globalThis[Symbol.for("pi.thinkingPreview")](thinkingBlocks.join(`\n`),theme,this.outputPad,this.isStreaming,this,runIndex):new Text(theme.italic(theme.fg("thinkingText",this.hiddenThinkingLabel)),this.outputPad,0))/' "$BUNDLE"
  patched=1
else
  echo "Bundle: thinking preview bridge already present, skipping"
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
  perl -0pi -e 's/(if\(content\.type==="text"&&content\.text\.trim\(\)\))this\.contentContainer/${1}globalThis[Symbol.for("pi.minimalist.quietProse")]?.(this,i),this.contentContainer/' "$BUNDLE"
  patched=1
else
  echo "Bundle: quiet prose boundary bridge already present, skipping"
fi

# -----------------------------------------------------------------------------
# Verify: perl exits 0 when a substitution matches nothing, so check every
# expected marker before accepting the file.
# -----------------------------------------------------------------------------
echo "Verifying bridges and syntax..."
for marker in \
  "$BUNDLE_MARKER" \
  "$QUIET_SPACER_MARKER" \
  "$ASSISTANT_MARKER" \
  'this.isStreaming,this,runIndex' \
  'hidden=this.isStreaming?false:' \
  'Symbol.for("pi.minimalist.quietThinking")' \
  'Symbol.for("pi.minimalist.quietMessageSpacer")' \
  'Symbol.for("pi.thinkingMarkdownTheme")' \
  'Symbol.for("pi.minimalist.quietProse")'; do
  if ! grep -qF "$marker" "$BUNDLE"; then
    echo "Error: patch failed to add: $marker" >&2
    exit 1
  fi
done
node --check "$BUNDLE"
echo "Bridges and syntax OK."

if [ "$patched" -eq 1 ]; then
  echo ""
  echo "Patched. Restart Pi fully for changes to take effect."
else
  echo ""
  echo "Nothing to patch — bridges already applied."
fi
