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
BUNDLE_MARKER='getRenderShell(){let fallback=globalThis[Symbol.for("pi.defaultToolRenderer")]'
CORE_MARKER='const fallback = globalThis[Symbol.for("pi.defaultToolRenderer")]'

patched=0

# -----------------------------------------------------------------------------
# Patch 1: default tool renderer bridge (both files)
# -----------------------------------------------------------------------------
# Core `getRenderShell()` consults a process-global renderer when a tool has
# neither renderCall nor renderResult. The extension stores its compact
# renderer under this symbol, so MCP/third-party tools without their own
# renderer get the same compact one-line style as the built-ins.
# -----------------------------------------------------------------------------
if ! grep -qF "$BUNDLE_MARKER" "$BUNDLE"; then
  echo "Patching bundle: default tool renderer bridge"
  # getRenderShell: use global fallback renderShell when tool has no renderers
  perl -0pi -e 's/getRenderShell\(\)\{return this\.toolDefinition\?\.renderShell\?\?"default"\}/getRenderShell(){let fallback=globalThis[Symbol.for("pi.defaultToolRenderer")];return!this.getCallRenderer()\&\&!this.getResultRenderer()\&\&fallback?.renderShell?fallback.renderShell:this.toolDefinition?.renderShell??"default"}/' "$BUNDLE"
  # createCallFallback: ask global renderer first
  perl -0pi -e 's/createCallFallback\(\)\{return new Text\(theme\.fg\("toolTitle",theme\.bold\(this\.toolName\)\),0,0\)\}/createCallFallback(){let renderer=globalThis[Symbol.for("pi.defaultToolRenderer")]?.renderCall,component=renderer?.(this.toolName,this.args,theme,this.getRenderContext(void 0));return component??new Text(theme.fg("toolTitle",theme.bold(this.toolName)),0,0)}/' "$BUNDLE"
  # createResultFallback: ask global renderer first, else native fallback
  perl -0pi -e 's/createResultFallback\(\)\{let output=this\.getTextOutput\(\);/createResultFallback(){let renderer=globalThis[Symbol.for("pi.defaultToolRenderer")]?.renderResult,component=renderer?.(this.toolName,this.result,{expanded:this.expanded,isPartial:this.isPartial},theme,this.getRenderContext(void 0));if(component!==void 0)return component;let output=this.getTextOutput();/' "$BUNDLE"
  patched=1
else
  echo "Bundle: default tool renderer bridge already present, skipping"
fi

if ! grep -qF "$CORE_MARKER" "$CORE"; then
  echo "Patching core: default tool renderer bridge"
  # Same three edits, unbundled (readable) form.
  perl -0pi -e 's/getRenderShell\(\) \{\n        return this\.toolDefinition\?\.renderShell \?\? "default";\n    \}/getRenderShell() {\n        const fallback = globalThis[Symbol.for("pi.defaultToolRenderer")];\n        if (!this.getCallRenderer() \&\& !this.getResultRenderer() \&\& fallback?.renderShell) {\n            return fallback.renderShell;\n        }\n        return this.toolDefinition?.renderShell ?? "default";\n    }/' "$CORE"
  perl -0pi -e 's/createCallFallback\(\) \{\n        return new Text\(theme\.fg\("toolTitle", theme\.bold\(this\.toolName\)\), 0, 0\);\n    \}/createCallFallback() {\n        const renderer = globalThis[Symbol.for("pi.defaultToolRenderer")]?.renderCall;\n        const component = renderer?.(this.toolName, this.args, theme, this.getRenderContext(undefined));\n        return component ?? new Text(theme.fg("toolTitle", theme.bold(this.toolName)), 0, 0);\n    }/' "$CORE"
  perl -0pi -e 's/createResultFallback\(\) \{\n        const output = this\.getTextOutput\(\);/createResultFallback() {\n        const renderer = globalThis[Symbol.for("pi.defaultToolRenderer")]?.renderResult;\n        const component = renderer?.(this.toolName, this.result, { expanded: this.expanded, isPartial: this.isPartial }, theme, this.getRenderContext(undefined));\n        if (component !== undefined) {\n            return component;\n        }\n        const output = this.getTextOutput();/' "$CORE"
  patched=1
else
  echo "Core: default tool renderer bridge already present, skipping"
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
# Patch 3: collapsed thinking preview bridge (assistant-message.js)
# -----------------------------------------------------------------------------
# When a thinking block is hidden (Ctrl+T), Pi shows a bare "Thinking..."
# label. This bridge lets the extension render a compact one-line preview
# (`> think <first line>`) instead, via globalThis[Symbol.for("pi.thinkingPreview")].
# Same pattern as the tool renderer bridge: core calls the extension function.
# -----------------------------------------------------------------------------
ASSISTANT_MARKER='Symbol.for("pi.thinkingPreview")'
if ! grep -qF "$ASSISTANT_MARKER" "$ASSISTANT"; then
  echo "Patching assistant-message: thinking preview bridge"
  perl -0pi -e 's/(const hidden = this\.thinkingVisibilityOverrides\.get\(runIndex\) \?\? this\.hideThinkingBlock;\n                const thinkingComponent = hidden\n                    \? )new Text\(theme\.italic\(theme\.fg\("thinkingText", this\.hiddenThinkingLabel\)\), this\.outputPad, 0\)/$1(globalThis[Symbol.for("pi.thinkingPreview")] ? globalThis[Symbol.for("pi.thinkingPreview")](thinkingBlocks.join("\\n"), theme, this.outputPad, this.isStreaming) : new Text(theme.italic(theme.fg("thinkingText", this.hiddenThinkingLabel)), this.outputPad, 0))/' "$ASSISTANT"
  patched=1
else
  echo "Assistant: thinking preview bridge already present, skipping"
fi

# Bundle equivalent: same bridge added to the minified hidden-branch expression.
if ! grep -qF "$ASSISTANT_MARKER" "$BUNDLE"; then
  echo "Patching bundle: thinking preview bridge"
  perl -0pi -e 's/thinkingComponent=hidden\?new Text\(theme\.italic\(theme\.fg\("thinkingText",this\.hiddenThinkingLabel\)\),this\.outputPad,0\)/thinkingComponent=hidden?(globalThis[Symbol.for("pi.thinkingPreview")]?globalThis[Symbol.for("pi.thinkingPreview")](thinkingBlocks.join(`\n`),theme,this.outputPad,this.isStreaming):new Text(theme.italic(theme.fg("thinkingText",this.hiddenThinkingLabel)),this.outputPad,0))/' "$BUNDLE"
  patched=1
else
  echo "Bundle: thinking preview bridge already present, skipping"
fi

# -----------------------------------------------------------------------------
# Patch 4: footer-status-manager bridges (interactive-mode.js, both forms)
# Used by extensions/footer-status-manager. Two bridges:
#   a) setExtensionStatus consults globalThis[Symbol.for("pi.statusTap")] first;
#      returning true swallows the update (status hidden from footer).
#   b) ctx.ui exposes getExtensionStatuses() so the viewer can list statuses
#      set before the extension loaded.
# -----------------------------------------------------------------------------
INTERACTIVE="$PI_ROOT/dist/modes/interactive/interactive-mode.js"
TAP_MARKER='Symbol.for("pi.statusTap")'

if ! grep -qF "$TAP_MARKER" "$INTERACTIVE"; then
  echo "Patching interactive-mode: status tap + getExtensionStatuses bridges"
  perl -0pi -e 's/    setExtensionStatus\(key, text\) \{\n        this\.footerDataProvider\.setExtensionStatus\(key, text\);/    setExtensionStatus(key, text) {\n        if (globalThis[Symbol.for("pi.statusTap")]?.(key, text)) {\n            this.footerDataProvider.setExtensionStatus(key, undefined);\n            this.ui.requestRender();\n            return;\n        }\n        this.footerDataProvider.setExtensionStatus(key, text);/' "$INTERACTIVE"
  perl -0pi -e 's/            setStatus: \(key, text\) => this\.setExtensionStatus\(key, text\),/            setStatus: (key, text) => this.setExtensionStatus(key, text),\n            getExtensionStatuses: () => this.footerDataProvider.getExtensionStatuses(),/' "$INTERACTIVE"
  patched=1
else
  echo "Interactive-mode: footer status bridges already present, skipping"
fi

# Bundle equivalents (minified).
if ! grep -qF "$TAP_MARKER" "$BUNDLE"; then
  echo "Patching bundle: status tap + getExtensionStatuses bridges"
  perl -0pi -e 's/setExtensionStatus\(key,text\)\{this\.footerDataProvider\.setExtensionStatus\(key,text\),this\.ui\.requestRender\(\)\}/setExtensionStatus(key,text){if(globalThis[Symbol.for("pi.statusTap")]?.(key,text)){this.footerDataProvider.setExtensionStatus(key,void 0),this.ui.requestRender();return}this.footerDataProvider.setExtensionStatus(key,text),this.ui.requestRender()}/' "$BUNDLE"
  perl -0pi -e 's/setStatus:\(key,text\)=>this\.setExtensionStatus\(key,text\),/setStatus:(key,text)=>this.setExtensionStatus(key,text),getExtensionStatuses:()=>this.footerDataProvider.getExtensionStatuses(),/' "$BUNDLE"
  patched=1
else
  echo "Bundle: footer status bridges already present, skipping"
fi

# -----------------------------------------------------------------------------
# Patch 5: thick markdown blockquote gutter (pi-tui markdown.js + bundle)
# -----------------------------------------------------------------------------
# Pi hard-codes the thin │ prefix for every rendered blockquote line. Replace
# it with full-block █; signal.json maps mdQuoteBorder to text (white).
# -----------------------------------------------------------------------------
MARKDOWN="$PI_ROOT/node_modules/@earendil-works/pi-tui/dist/components/markdown.js"

if ! grep -qF 'quoteBorder("█ ")' "$MARKDOWN"; then
  echo "Patching pi-tui markdown: thick blockquote gutter"
  perl -0pi -e 's/quoteBorder\("│ "\)|quoteBorder\("▌ "\)/quoteBorder("█ ")/' "$MARKDOWN"
  patched=1
else
  echo "pi-tui markdown: thick blockquote gutter already present, skipping"
fi

if ! grep -qF 'quoteBorder("\u2588 ")' "$BUNDLE"; then
  echo "Patching bundle: thick blockquote gutter"
  perl -0pi -e 's/quoteBorder\("\\u2502 "\)|quoteBorder\("\\u258c "\)/quoteBorder("\\u2588 ")/' "$BUNDLE"
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
node --check "$INTERACTIVE"
node --check "$MARKDOWN"
echo "Syntax OK."

if [ "$patched" -eq 1 ]; then
  echo ""
  echo "Patched. Restart Pi fully for changes to take effect."
else
  echo ""
  echo "Nothing to patch — bridges already applied."
fi
