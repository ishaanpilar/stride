<div align="center">

<img src="docs/assets/screenshots/cover.png" width="100%" alt="Stride：一款安静、由 AI 驱动的 Mac 个人整理工具。把脑子里的事都记下来，让 AI 帮你归类和规划，然后一次只专注一件事。">

**一款安静、由 AI 驱动的 Mac 个人整理工具。**

把脑子里的事都记下来，让 AI 帮你归类和规划，然后一次只专注一件事。
基于 David Allen 的《搞定》（Getting Things Done）。你的数据保存在你自己的 Mac 上。

[下载](https://github.com/ishaanpilar/stride/releases/latest) · [功能](#功能) · [用 AI 构建](#用-ai-构建) · [English](./README.md)

</div>

## 截图

<p align="center">
  <img src="docs/assets/screenshots/1-focus-briefing.png" alt="带有 AI 晨间简报的专注视图" width="100%">
</p>

| 助手会规划，也会提问 | 全屏专注计时器 |
|---|---|
| <img src="docs/assets/screenshots/2-assistant.png" alt="助手规划下午的安排并追问一个问题"> | <img src="docs/assets/screenshots/3-focus-timer.png" alt="带专注教练的全屏番茄钟"> |

| 菜单栏面板 | 项目 |
|---|---|
| <img src="docs/assets/screenshots/4-menu-bar.png" alt="显示今日任务、AI 收集和番茄钟的菜单栏面板"> | <img src="docs/assets/screenshots/5-project.png" alt="显示进度、优先级和预估时间的项目视图"> |

## 功能

### 帮你整理的助手

- **助手对话**（⌘⇧J，停靠在右侧）：用日常语言提出要求，它会通过经过校验的工具添加、更新、安排、合并和清理任务、项目、领域和标签。回复简短清晰，附带建议按钮，需要你决定时只问一个问题。
- **一切皆可撤销**：每个 AI 改动都会出现在“更改”卡片中，并各自带有撤销按钮。删除或批量改动会先征求确认。
- **AI 快速收集**（⌘⇧K）：把想到的一切倒出来，AI 提议项目和任务，你确认后一次性添加。
- **晨间简报**：以通知和卡片的形式给出当天的简短计划。
- **领域上下文**：为每个领域（一家公司或生活的一部分）写下归属内容、关键词和相关人员，或直接告诉助手。收集、助手和专注教练会据此把工作归到正确的位置，说明理由，不确定时会询问，并从你的更正中学习。

### 专注模式

- 从今日卡片、菜单栏或右键任意任务即可开始番茄钟。
- 应用其余部分淡出，当前任务居中，配以大号计时器和缓慢变化的光晕。
- 专注教练会估算任务真正需要的时间，建议下一步实际行动（或建议交给别人），鼓励你，并问一个有用的问题。
- 计时结束时会问“完成了吗？”，帮你完成、重新安排或转交。
- 可以缩小为悬浮小计时器、隐藏为小胶囊，或进入全屏。

### GTD 所需的一切

- 收件箱、下一步行动、等待中、将来/也许、项目、领域、情境、参考资料和每周回顾。
- 今日/专注视图、看板、日历和时间线。
- 任意位置拖动排序；拖到侧边栏或日历即可移动或安排。

### 为 Mac 打造

- 柔和的原生设计，跟随 macOS 强调色，支持浅色和深色模式。
- 全局流畅动画，可在设置中开关（并遵循“减弱动态效果”）。
- 菜单栏面板：收集、今日、收件箱、下一步、即将到来、排序、番茄钟，可调整高度。
- 将带日期的任务单向同步到 macOS 日历中的“Stride”日历（支持 Google 日历账户）。

### 你的密钥，你的数据

- 使用你自己的 AI 密钥：DeepSeek 或 Claude，密钥保存在 macOS 钥匙串中。
- 本地优先，可选同步（iCloud、Dropbox、WebDAV 或自托管服务器）。
- 无遥测。

## 安装

### Mac

1. 从[最新版本](https://github.com/ishaanpilar/stride/releases/latest)下载 `Stride.app.zip`，把 **Stride** 移到“应用程序”。
2. 当前版本尚未经过 Apple 公证。首次打开时请右键点击 Stride 并选择“打开”，或在“系统设置 → 隐私与安全性”中允许。
3. 打开“设置 → AI”，选择 DeepSeek 或 Claude 并粘贴 API 密钥。不使用 AI 也可以正常使用。

### Windows（测试版）

从 1.6.0 起提供适用于 Windows 10 和 11（x64）的 Stride 测试版。

1. 从[最新版本](https://github.com/ishaanpilar/stride/releases/latest)下载 `Stride_<版本>_x64-setup.exe` 并运行。（`.msi` 用于集中管理的安装；能自动更新的是 setup `.exe`。）
2. 安装程序目前还没有代码签名，Microsoft Defender SmartScreen 可能会提示“Windows 已保护你的电脑”。点击“更多信息”，再点击“仍要运行”。如需确认文件可信，可用 `Get-FileHash .\Stride_<版本>_x64-setup.exe` 计算 SHA-256，并与发布页上的 `SHA256SUMS.txt` 对照。
3. 打开“设置 → AI”，选择 DeepSeek 或 Claude 并粘贴 API 密钥。

在 Windows 上，Stride 位于系统托盘而不是菜单栏：左键点击托盘图标打开面板（收集、现在、全部任务、番茄钟），右键点击打开菜单。快捷键中 Mac 的 Cmd 对应 Ctrl，强调色跟随 Windows 的强调色。有新版本时，Stride 会在应用内提示：直接在应用内更新，或给出新安装程序的下载链接。

目前仅限 Mac：将带日期的任务同步到 macOS 日历、显示或图形崩溃后自动恢复窗口，以及面板和悬浮计时器的半透明（毛玻璃）效果。

## 从源码构建

需要 [Bun](https://bun.sh)（版本见 `.bun-version`）、[Rust](https://rustup.rs) 和 Xcode。

```bash
bun install
bun run desktop:dev
```

## 用 AI 构建

Stride 公开且有意地使用 AI 编程代理构建。自分叉以来的大部分代码由 Claude 通过 Claude Code 编写，并由人来指导、审查和决定发布内容。

- [`CLAUDE.md`](CLAUDE.md) 是所有编程代理必须遵循的规则和测试门槛。
- 应用内的 AI 输出一律视为不可信：经过校验、有超时，并始终有非 AI 的后备方案。

欢迎使用 AI 辅助的贡献，详见 [CONTRIBUTING](docs/CONTRIBUTING.md)。

## 路线图

- 会议与任务并列显示
- 把任务时间块安排到日历，并支持双向同步
- 每日计划与收工仪式
- 夜间 AI 整理（可撤销）
- iPhone 应用

## 许可与致谢

Stride 是基于 [GNU AGPL-3.0](LICENSE) 的自由软件。

Stride 最初分叉自 dongdongbh 及其贡献者的开源 GTD 应用 [Mindwtr](https://github.com/dongdongbh/Mindwtr)。其基础部分来自 Mindwtr，相关代码的版权归 Mindwtr 作者所有。详见 [NOTICE](NOTICE)。

Stride 受 David Allen 的《搞定》启发，与 David Allen 或 David Allen Company 无关，也未获其认可。
