# Handoff: RTM 在线体验馆（RTM Online Experience Hall）

> 来源：Claude Design 项目「项目UI重构范围确认」（projectId `61b2821e-e176-46aa-aadf-1cba74446f32`），目录 `design_handoff_rtm_experience_hall/`。
> 本目录是随仓库分发的设计交接包完整副本；用浏览器直接打开任一 `.dc.html`（需与同目录的 `support.js` 一起）即可查看。

## Overview
一个面向开发者的 RTM 能力在线体验产品。核心是「语聊房」场景：用户以房主或听众身份进入真实房间，
左侧是建议体验流程（引导任务），中间是语聊房舞台（麦位 + 治理面板 + 公告 + 公屏），
右侧是 RTM 数据流（实时 API 调用与事件回调的时间线）。目标是让开发者一边玩、一边看清每个交互背后
触发了哪些 RTM 调用。

## About the Design Files
本包内的 `.dc.html` 文件是**用 HTML 写成的设计稿**——用于表达最终视觉与交互意图的原型，
**不是可直接上线的生产代码**。任务是在目标代码库既有的技术环境中（React / Vue / 小程序 / 原生等）
**按既有工程规范重新实现这些设计**：复用现有组件库、状态管理、路由与样式方案。
若项目尚无前端环境，则自行选择最合适的框架从零搭建，再按本文档实现。
请勿把 HTML 原型直接塞进产品；也请勿把原型里的内联样式当作样式规范来照抄结构。

## Fidelity
**High-fidelity（高保真）**。颜色、字号、间距、圆角、动效时长均为最终值，请按像素级还原。
唯一例外：头像目前是纯色圆 + 文字首字，接入真实用户头像即可。

## Screens / Views
原型里有 5 个视图（`view` prop 切换）：`host`（房主视角）、`listener`（听众视角）、
`join`（进房前）、`docs`（文档占位）、`console`（控制台占位）。核心是前两个。

### 1. 全局框架 Shell
- **Purpose**：所有视图共用的三栏骨架。
- **Layout**：
  - 页面根：`1440 × 900`（设计基准，实际按容器自适应），`display:grid`，行 `56px / 1fr`。
    背景 `canvas`，文字色 `fg`（**必须显式声明在根节点上**，不能只写在 body 上）。
  - 顶栏 `56px`：背景 `surface`，下边框 `1px line`，左右 padding `28px`，`display:flex`，`gap:40px`。
    - 左：品牌 `RTM`（700 / 15px / letter-spacing -.01em）+ 竖线分隔 + `在线体验馆`（等宽 / 500 / 11px / `mono` 色 / letter-spacing .04em / padding-left 10px / border-left 1px line）。
    - 中：导航 `nav`，等宽 12px，每项 `padding:0 12px`，选中项 `border-bottom:2px solid ink` 且 `margin-bottom:-1px`，序号用 `mono2` 色 500 字重。
    - 右：连接状态（等宽 11px：`RTM` + 6px 圆点 + 状态词）+ 主题切换按钮（见组件）。`gap:16px`。
  - 主体：`display:grid`，列 `leftW / 1fr / rightW`。
    - 左栏 `aside`：`sideW` 宽（展开）或 `48px`（收起），背景 `surface`，右边框 `1px line`。
    - 中区 `main`：`padding: pad`，背景 `canvas`。
    - 右栏 `aside`：`tlW` 宽（展开）或 `48px`（收起），背景 `surface`，左边框 `1px line`。
  - 左右栏顶部使用自身 `padding-top: pad`，**不与语聊房卡片强制等高、不加额外分隔横线**（明确的设计决定，勿"优化"）。

### 2. 建议体验流程（左栏）
- **Purpose**：把 RTM 能力拆成有序的体验任务，引导用户逐条完成。
- **Layout**：`display:grid`，行 `auto / 1fr`。标题行 `建议体验流程`（700 / `h2` / letter-spacing -.01em）+ 折叠按钮（28×28，1px line，圆角 6px，图标收起时 `scaleX(-1)`）。
- **Components**：
  - 分节头：等宽 11px `mono` 色，形如 `01 / 场景任务`，右侧进度 `2/5`。
  - 进度条：`track` 色底，已完成段落用 accent 渐变，高度 2px。
  - 任务项：左侧 20px 处 7px 圆点（`box-shadow: 0 0 0 3px surface` 形成断线效果），标题 + 右侧状态。
    - 完成：圆点 `success`，标题 `fg` 600，状态 `✓ 已完成`（`success` 色）。
    - 待体验：圆点 `dash`，标题 `fg2` 500，状态 `✓ 待体验`（`disabled` 色）。
    - **只有这两种状态**，不要 in-progress / error 态。
  - CTA `前往 Console 创建项目`：高 `btnH`，圆角 6px，1px accent 渐变描边，右侧 ↗ 图标。
  - 分节之间：`border-top: 1px line` + `padding-top: pad`。
- **收起态**：宽 48px，仅显示居中的展开按钮 + 竖排文字「体验流程」+ 完成计数。

### 3. 语聊房（中区，host / listener）
- **Purpose**：真实的语聊房互动。
- **Layout**：卡片 `display:grid`，列 `1fr / panelW`，行 `hdrH / 1fr / auto`；背景 `surface`，1px line，圆角 10px，`overflow:hidden`。
  - **header**（跨两列，高 `hdrH`，下边框 1px line，左右 padding `pad`）：
    左 `HOST` 徽标（等宽 11px，1px ink 描边，圆角 4px，padding 3px 7px）+ 房间名（700 / `h1`）；
    右 `暂时离开`（1px line，`fg2`）+ `解散房间`（1px danger 描边，`danger` 文字）。按钮高 `btnH`，圆角 6px。
  - **左列**（padding `pad`，`display:grid`，`gap`）：麦位区 → 公告 → 公屏。
  - **右列**（`grid-column:2 / grid-row:2/4`，背景 `subtle`，左边框 1px line，padding `pad`）：治理面板。
- **Components**：
  - **分节标题行**（麦位 / 公告 / 公屏 三者同级）：`padding-top: gap` + `border-top: 1px line`，
    左侧标题 600 字重 + 等宽 11px `mono` 的元信息（`2 / 8 · 4 ONLINE` / `PINNED` / `12 MESSAGES`）。
    麦位区在最上方无需上边框。
  - **麦位网格**：`repeat(4, 1fr)`，行高 132px，`gap`。
    - 已占用：1px line，圆角 8px，背景 surface；`avatar` 尺寸圆形头像（`ink` 底 / `onInk` 字）；
      名字 600 `fs`；状态等宽 11px。说话中：`border-color: ink` + `box-shadow: 0 0 12px rgba(ink,.20)`，
      动画 `lab-breathe 1.8s ease-in-out infinite`（opacity/spread 呼吸）。
    - 空位：`1px dashed dash`，圆角 8px，`avEmpty` 圆底 + `+`，文字 `空麦位 / OPEN`（`faint`）。
    - 选中：外加 `box-shadow: 0 0 0 2px ink`（ring）。
  - **公告**：分节标题行（`公告` + `PINNED`）+ 正文 `fsSm` / line-height 1.6 / `fg` 色。**无卡片底色、无边框**。
  - **公屏**：可滚动消息列，每条 `padding: rowP 0`；发言人名 600 + 等宽时间戳 `mono2`；正文 `fsSm` / 1.6。
    系统消息用 `mono` 色等宽小字居中。底部输入行：input（1px line，圆角 6px，高 `btnH`）+ 发送按钮（`ink` 底 `onInk` 字）。
  - **治理面板（房主）**：`已选 · 02 小鹿` 卡（1px ink，圆角 8px）内含 `静音 / 下麦 / 踢出`（踢出为 danger 文字）；
    `排麦申请` 列表（每行姓名 + `→ SEAT 03 · 25s` 等宽小字 + `同意`（ink 实心）/`拒绝`（line 描边））；
    `更新公告` 输入 + `发布`；`在线听众` 列表（每行 `邀请上麦` / `封禁`）。
    分节标题同样用 600 + 右侧等宽计数。
  - **听众视角**：无治理面板列（`panelW` 变 0），header 右侧为 `申请上麦` / `离开房间`。

### 4. RTM 数据流（右栏）
- **Purpose**：把每次交互对应的 RTM API 调用与事件回调实时可视化。
- **Layout**：`display:grid`，行 `auto / auto / 1fr`。
  - 标题行：`RTM 数据流`（700 / `h2`）+ 等宽 `5 API · 4 EVENT`；右侧 `清空` `隐藏连接` 文字链（`fg2`）+ 折叠按钮。
  - 图例行：`API` / `EVENT` 两个 pill（1px line，圆角 999px，内含对应色圆点 + 计数）。
  - 列表：`overflow:auto`，每行 `padding: traceP`，圆角 6px，`gap`。
- **Row 结构**：等宽时间戳（11px，`mono`）+ 类型圆点（7px）+ 名称（等宽 13px 600）+ 可选 TAG（等宽 10px，1px 描边）+ 右侧耗时（等宽 11px `mono`）；第二行摘要 `fsSm` / `fg2` / 1.5。
- **配色（wash 方案，浅色主题）**：API 行底 `#a7e5d3` 系薄荷绿、圆点 `#2fa98a`；EVENT 行底 `#a8c8e8` 系天蓝、圆点 `#3d7fc2`；深色主题下改用 `apiBg` / `eventBg` 深底 + 提亮圆点。
- **新到行**：`lab-rowbreathe 1.8s ease-in-out infinite`（背景明度呼吸），1–2 个呼吸周期后转静态。
- **收起态**：宽 48px，竖排「数据流」+ 条目计数 + 展开按钮（图标镜像）。

## Interactions & Behavior
- **主题切换**：顶栏按钮点击在 light / dark 间切换，整套 token 立即替换（无过渡动画）。
  按钮：高 28px，圆角 14px，1px line，等宽 10px letter-spacing .08em；
  内含 11px 圆（1px `fg` 描边）——**浅色态实心 `fg`，深色态透明**；标签 `LIGHT` / `DARK`。
  hover：`border-color: dashStrong`，文字转 `fg`。
- **左右栏折叠**：点击各自的折叠按钮，栏宽在 `sideW/tlW ↔ 48px` 间切换，图标水平镜像；收起后仅保留竖排栏名 + 计数。
- **麦位选择**：点击已占用麦位 → 选中 ring + 右侧治理面板同步；点击空麦位（听众）→ 触发申请上麦。
- **排麦申请**：`同意` → 该听众进入麦位、数据流追加 `updateChannelMetadata` + `storage UPDATE`；`拒绝` → 仅移除申请行。
- **发送消息**：回车或点击发送 → 公屏追加消息 + 数据流追加 `publish`（约 41ms）。
- **发布公告**：`发布` → 公告正文替换 + 数据流追加 `setChannelMetadata` / `updateChannelMetadata`。
- **数据流新增**：新行插入列表底部并自动滚动到底，带呼吸动效。`清空` 清空列表并显示空态
  （居中 8px 圆点 + `mono` 色说明文字）。
- **动效原则**：只用 1.8s 呼吸（ease-in-out infinite）表达"活着/刚发生"；其余状态切换无缓动或 ≤120ms。
  不要弹跳、不要位移动画。
- **响应式**：设计基准 1440 宽。<1280 时右栏优先收起，<1024 时左栏也收起。

## State Management
```
view: 'host' | 'listener' | 'join' | 'docs' | 'console'
theme: 'light' | 'dark'            // 用户切换后覆盖初始值
density: 'compact' | 'regular' | 'comfortable'
leftOpen: boolean                  // 体验流程栏
rightOpen: boolean                 // 数据流栏
seats: Array<{ index, uid, name, role: 'host'|'guest', speaking, muted } | null>  // 长度 8
selectedSeat: number | null
requests: Array<{ uid, name, seat, waitedSec }>
listeners: Array<{ uid, name }>
announcement: string
messages: Array<{ id, uid, name, text, time, kind: 'user'|'system' }>
traces: Array<{ id, time, kind: 'api'|'event', name, tag?, durationMs?, summary, fresh }>
connection: 'connected' | 'connecting' | 'reconnecting' | 'disconnected'
tasks: Array<{ id, title, done }>  // 只有 done / pending
```
数据获取：全部来自 RTM SDK 的实时回调（presence / storage / message），无独立后端轮询。
每个 UI 动作先乐观更新本地状态，再由 SDK 回调校正；治理动作在生产环境必须经服务端校验。

## Design Tokens

### Light
```
canvas #fafafa   surface #ffffff   subtle #fbfbfc   code #f6f7f8   avEmpty #f3f4f6
lineSubtle #f0f1f3  line #e6e7ea  track #eeeff1  dash #dcdee2  dashStrong #c4c7cc
faint #b3b7bd  disabled #a3a7ae  mono2 #8b8f96  mono #6b7079  fg2 #5f6368
fg #111214  ink #111214  onInk #ffffff
success #1f8a5b  danger #c8362f
event #5b5bd6  eventText #4f4fc4  eventLine #c9c9f2  eventBg #f5f5fd  apiBg #f3f4f6
```

### Dark
```
canvas #0f1012  surface #141517  subtle #1b1c1f  code #1b1c1f  avEmpty #26272b
lineSubtle #1f2024  line #2a2b2f  track #26272b  dash #3a3b40  dashStrong #4a4b52
faint #5f6368  disabled #6b7079  mono2 #8b8f96  mono #a3a7ae  fg2 #a3a7ae
fg #f2f2f3  ink #f2f2f3  onInk #111214
success #3fb27f  danger #e5534b
event #8b8bea  eventText #a3a3f0  eventLine #3d3d7a  eventBg #1c1c2e  apiBg #1b1c1f
```

### 数据流 wash 配色（Design System v1.1 定稿，覆盖上表的 event/apiBg）
```
light: trace.api #2fa98a / trace.api.bg #a7e5d3 / trace.event #3d7fc2 / trace.event.bg #a8c8e8
dark:  trace.api #7fdcc3 / trace.api.bg #1e4a3f / trace.event #8ab9e6 / trace.event.bg #1f3550
```

### Density scale（三档，默认 comfortable）
| token | compact | regular | comfortable |
|---|---|---|---|
| fs | 12 | 13 | 13 |
| fsSm | 11 | 12 | 12 |
| h1 | 17 | 19 | 22 |
| h2 | 14 | 15 | 16 |
| pad | 14 | 20 | 24 |
| padX | 16 | 20 | 24 |
| gap | 8 | 10 | 12 |
| rowP | 7 | 9 | 11 |
| btnH | 30 | 34 | 38 |
| hdrH | 56 | 64 | 76 |
| avatar | 36 | 40 | 44 |
| traceP | 8 | 10 | 14 |
| sideW | 220 | 236 | 252 |
| tlW | 380 | 400 | 420 |
| panelW | 260 | 280 | 300 |

### Typography
- UI 字体栈：`-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Helvetica, sans-serif`
- 等宽字体栈：`ui-monospace, "SF Mono", Menlo, Consolas, monospace`
- **规则**：所有「机器可读」信息一律等宽——编号、时间戳、耗时、API 名、状态词、计数、TAG。
  人类语言（标题、正文、按钮文案）用 UI 字体。
- 字重只用 500 / 600 / 700。标题 letter-spacing `-.01em ~ -.03em`；等宽小字 `.04em ~ .1em`。

### Radius / Border / Shadow
- 圆角：卡片 10px，区块 8px，控件与行 6px，徽标 4px，pill 与主题按钮 999px/14px，头像 50%。
- 边框恒为 1px；虚线仅用于"空/未占用"。
- **不使用投影做层级**，唯一的 shadow 是呼吸发光（`0 0 12px rgba(ink,.20)`）与圆点的 3px 断线光圈。

### Accent
accent 为渐变可配置项（默认 `#f6a34a → #ee5a9a → #8b5cf6 → #38bdf8`），仅用于：左栏进度条、CTA 描边。**不用于正文、状态、按钮实心底**。

## Assets
无外部图片或图标文件。所有图标为内联 SVG（24×24 viewBox，`currentColor`，stroke 1.5–2）：
折叠/展开（面板图标）、✓、↗、+、皇冠（房主徽标）。头像为纯色圆 + 名称首字，接真实头像时替换为 `<img>` 并保持 50% 圆角。

## Files
- `Lab.dc.html` — **主原型**（三栏框架 + 5 个视图 + 全部交互与两套主题）。这是实现时的第一参考。
- `Design System.dc.html` — 设计系统 v1.1：色板、字体、组件清单与状态、动效规范。
- `Redesign.dc.html` — 定稿方案对照页（Turn 4：4a–4e 浅色 / 4f–4j 深色，各 5 个视图）。用于确认视觉意图。
- `Concept.dc.html` — 早期概念探索（仅作背景参考，不是定稿）。
- `Trace Palettes.dc.html` — 数据流行配色的取舍过程，最终采用 wash 方案。

打开方式：直接用浏览器打开任一 `.dc.html`（需与同目录的 `support.js` 一起）。
`Lab.dc.html` 顶栏可切换主题，左右栏可折叠，导航可切视图。
