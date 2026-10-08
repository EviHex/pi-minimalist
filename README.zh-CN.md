# pi-minimalist

[English](README.md) | **简体中文** | [Français](README.fr.md)

> 本文翻译自英文版 [README.md](README.md),如有出入以英文版为准。命令、设置名和 JSON 键保持英文原样,方便你在界面里对照。

**少滚动,给答案留出更多空间。**

让 [Pi](https://pi.dev) 的对话记录更安静:把冗长的工具调用折成一行摘要,需要时再展开完整输出。

## 效果对比

**之前:** 一次工具调用占掉大半个屏幕。

<img width="656" height="550" alt="before" src="https://github.com/user-attachments/assets/aa1602f7-5db1-49b8-a4d3-cbd1aef69ea0" />

**之后:** 同一次调用,只占一行。

<img width="699" height="50" alt="after" src="https://github.com/user-attachments/assets/c0e8bca4-afa7-42c1-9bf0-69f267d18d9f" />

**点击**折叠的一行,会把它展开成多行。点击其中一行,只看这一行的输出。点击展开区域上方的 `▾ Expanded · click to fold`,可以重新折叠。

<img src="docs/click.png" width="600" alt="点击折叠的一行会展开成多行;点击其中一行只展开这一行">

按 **Ctrl+O** 展开工具输出,包括 diff 和语法高亮。展开后的行会自动换行显示长命令,不会截断。会话内容不会被删除,模型也看得到全部内容;只有显示方式改变。

## 安装

```bash
pi install npm:pi-minimalist
```

重启 Pi,工具调用就会显示为紧凑的一行。不需要任何配置。

## 选择你想要的安静程度

运行 **`/minimalist`** 可以实时修改设置。可以只用紧凑工具行,也可以走得更远:

- **Combine consecutive tool calls**(合并连续工具调用):合并成一条摘要,例如 `read ×2, edit ×1`。
- **Collapse earlier activity**(折叠早先的活动):让最新的回复保持在视线中心。之前的活动会被替换成耗时或工具计数。
- **Compact thinking rows**(紧凑思考行),或让思考内容在生成时保持可见。
- **Keep running tools visible**(保持运行中的工具可见):在合并其他调用的同时,运行中的工具会带计时器显示已耗时间。
- **Excluded tools**(排除的工具):让指定工具(例如 `subagent`)保留自己的卡片,不压缩成一行。在 `/minimalist` 里打开该行,输入关键字搜索,在工具上按 Enter 即可切换。

全新安装默认使用 **`full`** 预设(见下文):紧凑工具行、合并调用和紧凑思考行。活动折叠需要手动开启。如果你想逐条看到每次调用,请选择 `lite`。

### 预设

`/minimalist` 顶部的 **Preset** 一行,可以一次设置四个选项:**Compact tool rows**、**Combine consecutive tool calls**、**Collapse earlier activity** 和 **Compact thinking rows**。

| 预设 | 效果 |
| --- | --- |
| `off` | Pi 原生的工具卡片。 |
| `lite` | 单行工具行,每次调用各占一行。 |
| `full` | `lite` 加上合并连续调用和紧凑思考行。 |
| `max` | `full` 加上折叠早先的活动(`Worked for …`)。 |
| `custom` | 这四个选项使用你自己的值。 |

<img src="docs/presets.png" width="600" alt="预设选择界面">

预设不会覆盖你的设置。选中 `off`、`lite`、`full` 或 `max` 时,只有那四行会变灰并显示预设的值,在它们上面按 Enter 没有任何作用。其他选项(Left border、Elapsed timer、Symbols 等)仍然归你所有,可以继续编辑。你自己的值会被保留,选回 `custom` 时会恢复。第一次选择 `custom` 时,会从 `lite` 开始。

**升级说明:** 如果你的设置里已经有 `minimalist` 配置块,你会继续停留在 `custom`,什么都不会变。只有完全没有 `minimalist` 设置的用户才会从 `full` 开始,这会让思考行变得紧凑。想换一种外观,修改 **Preset** 即可。

### 日常操作

| 操作 | 作用 |
| --- | --- |
| `/minimalist` | 打开设置(`/minimalist config` 也可以) |
| `/minimalist status` | 显示当前设置 |
| Ctrl+O | 展开或折叠工具输出 |
| Ctrl+T | 展开或折叠思考内容 |

设置会作用于已有的对话历史,并保存为全局设置。如果某个符号在你的终端里显示不正常,请选择 **Symbols → ASCII**。不需要 Nerd Font。

## 回到 Pi 的默认外观

关闭 **Compact tool rows** 即可恢复原生工具卡片。也可以选择 `off` 预设。

要完全禁用这个扩展,运行 `pi config`,禁用 pi-minimalist,然后重启 Pi。

## 兼容性

已在 Pi **1.0.0** 上测试。Pi 的更新可能影响渲染兼容性;请[反馈问题](https://github.com/EviHex/pi-minimalist/issues),并附上你的 Pi 版本、终端和一张截图。

[MIT 许可证](LICENSE)。
