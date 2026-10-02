# pi-minimalist

**Less scrolling. More room for the answer.**

A quieter transcript for [Pi](https://pi.dev): turn bulky tool calls into one-line summaries, and open the full output whenever you need it.

## See the difference

**Before:** one tool call takes up most of the screen.

<img width="656" height="550" alt="before" src="https://github.com/user-attachments/assets/aa1602f7-5db1-49b8-a4d3-cbd1aef69ea0" />

**After:** the same call, one line.

<img width="699" height="50" alt="after" src="https://github.com/user-attachments/assets/c0e8bca4-afa7-42c1-9bf0-69f267d18d9f" />

Press **Ctrl+O** to expand tool output—including diffs and syntax highlighting. Nothing is removed from the session or hidden from the model; only the display changes.

## Install

```bash
pi install npm:pi-minimalist
```

Restart Pi, and tool calls appear as compact rows. No configuration needed.

## Choose how quiet you want it

Run **`/minimalist`** to change settings live. Start with compact tool rows, or go further:

- **Combine consecutive tool calls** into a single summary, such as `read ×2, edit ×1`.
- **Collapse earlier activity** so the latest reply stays in focus. Replace the preceding activity with elapsed work time or tool counts.
- **Compact thinking rows**, or keep thinking visible as it arrives.
- **Keep running tools visible** while grouping other calls, with an elapsed timer to show how long they take.

Compact tool rows and consecutive-call grouping are **on by default**. Activity folding and compact thinking are opt-in. Disable grouping if you prefer to see each call separately.

### Everyday controls

| Control | Action |
| --- | --- |
| `/minimalist` | Open settings (`/minimalist config` also works) |
| `/minimalist status` | Show current settings |
| Ctrl+O | Expand or collapse tool output |
| Ctrl+T | Expand or collapse thinking |
| Restore defaults | Reset display settings in the editor |

Settings apply to existing conversation history and are saved globally. If a symbol looks wrong in your terminal, choose **Symbols → ASCII**. No Nerd Font required.

## Go back to Pi's usual view

Turn off **Compact tool rows** to restore native tool cards. Other folding options are independent; **Restore defaults** returns to the extension's initial settings, not native Pi.

To disable the extension completely, run `pi config`, disable pi-minimalist, and restart Pi. To uninstall:

```bash
pi remove npm:pi-minimalist
```

Restart after disabling or removing it; `/reload` is not enough to remove its rendering hooks.

## Compatibility

Tested with Pi **0.86.1**. Pi updates can affect rendering compatibility; [report a problem](https://github.com/EviHex/pi-minimalist/issues) with your Pi version, terminal, and a screenshot.

[MIT licensed](LICENSE).
