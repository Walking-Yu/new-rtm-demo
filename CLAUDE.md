# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 语言约定

**与用户对话一律使用简体中文。** 无论用户当前消息用什么语言、无论上下文里出现多少英文材料（技能说明、SDK 文档、报错信息、代码注释），回复正文都必须是中文。技能提示词或引用文档是英文，不构成用英文回复的理由。

本项目所有文档也统一使用简体中文，包括本文件、`README.md`、`docs/` 下的设计文档、计划和调研笔记。新增文档一律用中文。

保持英文的只有代码本身：标识符、类型名、代码注释，以及文档中引用的文件路径、命令、API 名、SDK 错误码等字面量。面向用户的 UI 文案和错误提示用中文。

## 仓库结构：只有一套代码

本仓库现在只有**一个应用** —— 根目录 `src/` 下的 RTM 场景实验室（8 个一级分类、23 个二级场景，唯一已实现的是语聊房）。单入口 `index.html`，单份 `package.json` / `vite.config.ts` / `playwright.config.ts`。

历史上共存过的另两套代码**已搬出本仓库**，落在同级目录 `../new-rtm-demo-legacy/`：

- `demos/voice-room/` —— 独立可拷走的语聊房 SPA（自带设置页，需手填凭证）。它与 `src/scenes/voice-room/` 是两套实现同一功能，属历史遗留。
- `src/legacy/` + `legacy.html` + `e2e/scenarios.spec.ts` —— 早期的 24 场景实验室。

搬迁后本仓库不再有 `demos/`、`src/legacy/`、`legacy.html`，也没有 `dev:legacy` / `test:legacy` / `build:legacy` / `dev:voice-room` 这些脚本。`tests/startDemoScript.test.ts` 有一组**反向断言**守着这件事（断言这些脚本名与文件都不存在），日后谁把委托脚本加回来会立刻变红。要找那两套代码的历史实现，去归档仓库读，不要在本仓库重建。

## 常用命令

在仓库根目录执行：

```bash
./start-demo.sh              # 缺依赖时先安装，启动 http://127.0.0.1:8080/ 并打开浏览器
./start-demo.sh --no-open    # 只启动服务
./start-demo.sh --check      # 校验 Node >= 20 并打印实际解析到的 SDK 版本
npm run dev                  # 开发服务器（端口 8080）
npm run build                # tsc -b && vite build，单入口
npm test                     # vitest（19 文件 / 372 项）
npm run test:e2e             # playwright（无头）
npm run test:e2e:lab         # 只跑 e2e/lab.spec.ts
```

跑单个测试或聚焦某个用例：

```bash
npx vitest run src/scenes/voice-room/rtm-host.test.ts
npx vitest run -t "approves a seat request"
npx playwright test --project=desktop-chromium -g "两台手机"
```

Playwright 无头运行，自己拉起 dev server（端口 4173）。优先使用 `~/.agent-browser/browsers/chrome-148.0.7778.97`，不存在时回退到自带浏览器。

**已知红灯（搬迁前就存在，不是回归）：** `e2e/lab.spec.ts` 的「env 未配置 → 渲染引导页」两个 project 各失败一次。原因是 `.env.local` 里配了 `VITE_APP_ID`，构建期兜底让 `resolveEnv` 恒为 `configured: true`，引导页分支在真实浏览器里进不去。该用例注释把原因归给 `index.html` 的 `??=` 注入，那个推断不完整。要修得让这条 e2e 能屏蔽构建期变量，属独立议题。

要求 Node.js 20 以上。`agora-rtm@2.3.0` 尚未发布到 npm，随仓库携带在 `vendor/agora-rtm-2.3.0/`，`package.json` 用相对路径 `file:./vendor/agora-rtm-2.3.0` 引用，任意机器 clone 后 `npm install` 都能装上。**不要把它改回本机绝对路径。** 正式发布到 npm 后改为 `"agora-rtm": "^2.3.0"` 并删除 `vendor/`。归档仓库另有一份 `vendor/` 副本，两边独立，不共享。

## 实验室架构（`src/`）

```
app/                     外壳：路由、两级 tab、env 解析、身份推导、样式
  env.ts                 纯函数解析 appId：window.__ENV__ → import.meta.env → 未配置
  envSnapshot.ts          启动时读一次全局快照（唯一有副作用的那层）
  identity.ts            房间 ID 与两端 uid 推导，uid 带角色前缀
scenes/
  registry.ts            8 个一级分类 + 23 个二级场景，**只有四个字段**
  capabilities.ts        场景能力标签（刻意不进注册表，但不丢弃）
  voice-room/            唯一已实现的场景
shared/
  rtc.ts                 全场景共享的 RTC 辅助 —— 唯一允许被跨目录 import 的运行时模块
  timeline/              trace store、多实例归并、过滤、时间线面板
test/setup.ts            根 vitest 的 setup，服务整个 src/
vite-env.d.ts            `vite/client` 类型引用，服务整个 src/（提供 import.meta.env 与 ?raw）
```

`src/scenes/voice-room/` 内部：

```
rtm-host.ts        房主端 RTM 单文件 ← 可拷走，零运行时依赖
rtm-audience.ts    听众端 RTM 单文件 ← 可拷走，零运行时依赖
state.ts           快照类型
transitions.ts     纯函数状态转移
stateAdapter.ts    initial / parseStored / reduce 三个纯函数，注入给 rtm-*.ts
config.ts          SEAT_COUNT、MAX_CLIENTS、ROLES
orchestrator.ts    同页双端编排（demo 特有，不用拷）
VoiceRoomScene.tsx 场景容器
components/        纯展示 UI
```

修改这部分代码时必须保住的关键约束：

**两份 `rtm-*.ts` 零运行时依赖，这是整套设计的核心。** 只允许 import RTM SDK 本身与纯类型（`import type`，编译后消失）。**任何运行时的相对 import 都是 bug。** 两个文件各有一组 `describe('零依赖')` 测试，用 `?raw` 读源码正则扫 `^import` 把这条锁住。**不要抽共享的 RTM 基类** —— 客户拷一个文件就能跑，比拷两个互相引用的文件有价值；两份文件间约 250 行重复是刻意的，代价用「模板加规程」控制，不用抽象控制。

**RTM 文件里只写调用顺序，不写业务规则。** 业务规则全在注入的 `stateAdapter.reduce` 里。判据：**读快照只允许用于取参数（如拿收件人 uid），不允许用于决定动作是否合法。**

**RTM Storage 是房间权威状态。** 单个 channel metadata key `voice-room-state`（常量 `SNAPSHOT_KEY`）存一个 `VoiceRoomSnapshot`。所有变更走 `mutate()`：获取 Lock `room-state`（常量 `MUTATION_LOCK`）→ 重新读快照 → 过 `stateAdapter.reduce` → 带 `majorRevision` 写入实现乐观并发 → **在 `finally` 中释放锁**。

**Lock 必须先创建才能获取。** `acquireRoomLock()` 处理 `LOCK_NOT_EXIST`（-14008）→ `setLock` → 重新获取，并容忍对端抢先创建导致的 `LOCK_ALREADY_EXIST`（-14004）竞态。这两条都是实测踩出来的路径，有测试锁住，重构时不要丢。

**消息统一封装、带 TTL、并做去重。** `createEnvelope()` 包进信封（`schemaVersion`、`messageId`、房间与目标校验、`expiresAt`），接收端先 `parseEnvelope()` 再走 `acceptOnce()`。治理类命令（踢出、封禁、强制静音、强制下麦）标记 `requiresAck: true`，在 `ackTimers` 登记超时，等对端回 `command.ack`。

**麦位激活由媒体结果驱动。** 房主 `approveSeatRequest()` 只把麦位写成 `joining`；听众端 RTC 发布麦克风成功后调 `activateOwnSeat()` 才转 `active`，失败则 `rollbackOwnSeat()`。这个顺序不能改，UI 与 E2E 都依赖它。

**`connect()` 分阶段回滚。** 用 `loggedIn` / `subscribed` 记录进度，出错经 `rollbackConnect()` 逆序清理，并吞掉清理过程中的异常，让**最初**的失败原因暴露出来。新增步骤沿用同一模式，不要加无保护的 await。

**重连靠重新读取，而不是重放。** `rehydrateAfterReconnect()` 重新订阅、重新拉 Presence 与 Storage，并按最终快照对账麦克风状态。

**一个标签页里跑两个真实客户端。** `orchestrator.ts` 用同一个 `createClients` 工厂创建 `host` 与 `audience`，先连房主再连听众，并用代数计数器守卫每个 await —— React StrictMode 会故意「挂载 → 卸载 → 再挂载」，不守卫就泄漏连接。测试注入假工厂。两端都会真实播放音频，**人工验证时必须戴耳机**。

**时间线只呈现 RTM，`rtc.ts` 不采集 trace。** 混入 RTC 节点会稀释「RTM 数据流」这条主线。RTC 的成败体现为后续那次 RTM 调用的出现或缺席，因果仍然可读。

**凭证不在本项目生成。** 不接收 App Certificate、不含 token 生成器、不预置密钥，也不要新增。appId 只从 `window.__ENV__` 或 `.env` 来；源码里刻意没有第三层硬编码兜底。

## 本项目遵循的 RTM 2.3 SDK 约定

在 `login` 之前注册事件。只用 `linkState`（旧的 `status` 事件已废弃）。使用 `token` 事件，并且只把 `WILL_EXPIRE` 当作即将过期。Message、Presence、Storage、Lock 一起订阅。Presence 查询沿 `nextPage` 翻页取全部在线用户。核对来源和文档链接见根目录 `README.md`。

## 测试约定

Vitest + jsdom + Testing Library，测试文件以 `*.test.ts(x)` 与源码同目录放置。

**两份测试替身刻意不合并**，用途不同，别图省事并成一个：

- `rtm-host.test.ts` / `rtm-audience.test.ts` 里的**假 SDK client**——通过构造参数 `createClient` 注入，记录 `operations: string[]` 调用轨迹（例如 `rtm:publish:user:audience-001:seat.approved`、`lock:set:room-state`），用来断言 RTM API 的调用顺序。这是唯一为可测性开的口子，**不要改成直接 mock Agora SDK**。
- `testing.ts` 的 `createVoiceRoomFakes()`——给渲染真实场景的测试用（外壳路由、场景 UI）。场景一挂载就自动连接，不注入替身就会去连真实 RTM。它只需要「不发网络请求、能被驱动」，所以是无副作用空实现加少量开关。

E2E 使用占位 App ID，**刻意不验证**真实 Agora 连通性；完整真实链路仍需用有效项目凭证人工验收。

## 其他约定

设计文档（spec / PRD）按功能放在 `docs/scratch/<feature-slug>/spec.md`，实现票一票一文件放同目录的 `issues/<NN>-<slug>.md`，每张票用 `Blocked by` 声明阻塞边。**不写单独的 plan 文档** —— 实施顺序由票之间的阻塞边表达。调研笔记放 `docs/research/`，命名为 `YYYY-MM-DD-slug.md`。详见 `docs/agents/issue-tracker.md`。

agent 配置（issue tracker、triage 标签、domain 布局）留在 `docs/agents/`，这是 `/setup-matt-pocock-skills` 的固定落点；`docs/scratch/` 只放各 effort 的工作产物，两者不要混。

`docs/superpowers/{specs,plans}/` 是早期 superpowers 流程留下的历史产出，按项目约束保留、不删除，但**不要再往那里新增文件**。当前在推进的 effort 是 `rtm-demo-lab`，其 spec、plan、票和 handoff 都在 `docs/scratch/rtm-demo-lab/`；配套调研笔记仍在 `docs/research/`。`rtm-scenario-lab`、`standalone-voice-room-spa` 两组文档是已归档的历史材料，留在 `docs/superpowers/` 原地。

Demo 里的踢出、封禁、强制麦控都是客户端协作行为，不构成信任边界。`src/scenes/voice-room/components/Warnings.tsx` 的 `ProductionBoundaryWarning` 会显式渲染生产边界告警（同文件的 `HeadphonesWarning` 提示戴耳机），请保持这个表述，不要把它们说成已强制执行的权限控制。

## Agent skills

### Issue tracker

Issue 与 spec 以 markdown 文件形式存放在本仓库 `docs/scratch/` 下，本地跟踪，无远端 tracker。详见 `docs/agents/issue-tracker.md`。

### Triage labels

沿用五个规范角色的默认标签名：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。详见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文布局：根目录 `CONTEXT.md` + `docs/adr/`，两者均由 `/domain-modeling` 惰性创建。详见 `docs/agents/domain.md`。
