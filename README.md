# pi-minimalist

Make Pi's tool calls and optional thinking previews quieter: compact, one-line rows without losing access to the original tool output.

**Illustrative terminal layout** (not a screenshot or a literal capture; exact text and colors depend on the tool and theme):

Before, Pi's usual tool cards (schematic):

```text
read src/a.ts
  <file contents>
bash node --test
  <test results>
```

After, compact rows:

```text
✓ read src/a.ts
✓ bash node --test
```

Press `Ctrl+O` to reveal the full original output.

Tool output is hidden **from the transcript, not from the model**. Pi's `Ctrl+O` toggles the full original tool output; `Ctrl+T` expands/collapses thinking blocks when the model provides them. Folding consecutive rows and rendering thinking like a tool call are optional and off by default.

## Install locally

Requires an existing Pi installation. This is a local extension, **not** a published Pi package; do not use `pi install`.

1. Copy this directory to `~/.pi/agent/extensions/pi-minimalist/` (or keep it elsewhere and use an absolute path to `index.ts`).
2. Add the explicit entry point to the `extensions` array in `~/.pi/agent/settings.json`:

   ```json
   {
     "extensions": ["extensions/pi-minimalist/index.ts"]
   }
   ```

   If you already have extensions, append the string instead of replacing their entries. When installing elsewhere, use `"/absolute/path/to/pi-minimalist/index.ts"`. The explicit path is necessary for this local nested repository; it is not automatically discovered. No build or package manifest is needed.
3. Restart Pi. Run `/minimalist` to open the settings editor.

## Use and undo

- `/minimalist` — open the settings editor; `/minimalist config` is an alias. Edit settings live with arrow keys and Enter/Space; Escape closes the editor. The editor saves only the changed setting to your **global** Pi `settings.json` (or `PI_CODING_AGENT_DIR/settings.json` when configured). Project-local `minimalist` blocks are ignored; existing project files are not modified. If the global file has comments or cannot be written, changes apply only to this session and Pi warns you.
- Select **Restore defaults** in the editor to reset its display settings (including Symbols). This does not erase hand-written custom glyphs, colours, excluded tools, or other Pi settings. If saving fails, the defaults still apply for this session and Pi warns you.
- `/minimalist status` — show the current settings without opening the editor.
- `Ctrl+O` — expand/collapse tool output. `Ctrl+T` — expand/collapse thinking blocks. These are Pi's default keybindings and may be customized in `keybindings.json`.
- To disable the extension completely, remove its path from the `extensions` array and **restart Pi** (not just `/reload`). To remove it, delete the local directory after disabling it. Existing `minimalist` preferences in `settings.json` are inert without the extension; you can remove that key if desired.

Turning off **Compact tool rows** only restores native tool cards; it does not disable other enabled minimalist options. Optional folding changes what is shown in the transcript, not the underlying session or tool results.

## Compatibility

Tested against locally installed `@earendil-works/pi-coding-agent` **0.86.1** with `./run-tests.sh` and `./run-tests.sh --typecheck`. This extension wraps Pi's runtime component prototypes (it does not modify Pi's installed files), so future Pi releases may change the internal methods it relies on. Run both checks after updating Pi, and restart Pi after changing or disabling the extension. Terminal appearance and keyboard delivery still need a manual check; the automated tests do not cover them.

If a default symbol is missing or misaligned, set **Symbols** to **ASCII** in `/minimalist`. The default symbols are ordinary Unicode; a Nerd Font is not required. Custom glyphs set in `settings.json` still take precedence over either style. More implementation and configuration details are in [AGENTS.md](AGENTS.md).
