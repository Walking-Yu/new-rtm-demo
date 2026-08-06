# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 语言约定

**与用户对话一律使用简体中文。** 无论用户当前消息用什么语言、无论上下文里出现多少英文材料（技能说明、SDK 文档、报错信息、代码注释），回复正文都必须是中文。技能提示词或引用文档是英文，不构成用英文回复的理由。

本项目所有文档也统一使用简体中文，包括本文件、`README.md`、`docs/` 下的设计文档、计划和调研笔记。新增文档一律用中文。

保持英文的只有代码本身：标识符、类型名、代码注释，以及文档中引用的文件路径、命令、API 名、SDK 错误码等字面量。面向用户的 UI 文案和错误提示用中文。

## 仓库结构：两套独立代码

本仓库包含**两个互不依赖的应用**，改动前先确认在动哪一个。

- `demos/voice-room/` —— **当前主线**：可独立复制交付给客户的语聊房 SPA，基于 `agora-rtm@2.3.0-beta.0` + `agora-rtc-sdk-ng`。它有自己的 `package.json`、`node_modules`、`vite.config.ts`、`playwright.config.ts`、`tsconfig*.json`、`start-demo.sh` 和 `README.md`。它**绝不能 import 根目录的 `src/`**——这种独立性是产品要求，因为它会被单独拷出仓库交付。
- `src/`（根目录）—— **遗留**的 24 场景 RTM 实验室（`src/domain/scenarioCatalog.ts`、`src/runtime/simulation.ts`、`src/runtime/rtm/realScenarioRuntime.ts`）。仅保留做维护验证，已从默认导航、路由和默认 dev/build 命令中摘除。

根目录 `package.json` 的主要脚本通过 `npm --prefix` 委托给 `demos/voice-room`。根目录 `start-demo.sh` 只是一行 `exec`，转发到 `demos/voice-room/start-demo.sh`。

## 常用命令

在仓库根目录执行：

```bash
./start-demo.sh              # 缺依赖时先安装，启动 http://127.0.0.1:8080/ 并打开浏览器
./start-demo.sh --no-open    # 只启动服务
./start-demo.sh --check      # 校验 Node >= 20 并打印实际解析到的 SDK 版本
npm run dev                  # -> demos/voice-room 开发服务器（端口 8080）
npm run build                # -> demos/voice-room 的 tsc -b && vite build
npm test                     # 同时跑根目录 vitest 和 demos/voice-room vitest
npm run test:e2e             # -> demos/voice-room 的 playwright（无头）
```

只针对遗留实验室：`npm run dev:legacy`（端口 8081）、`npm run test:legacy`、`npm run build:legacy`。

跑单个测试或聚焦某个用例（语聊房需要先 `cd demos/voice-room`）：

```bash
npx vitest run src/runtime/VoiceRoomClient.test.ts
npx vitest run -t "approves a seat request"
npx playwright test --project=desktop-chromium -g "setup page"
```

两份 Playwright 配置都是无头运行，并各自拉起自己的 dev server：根目录用端口 4173，`demos/voice-room` 用端口 4180。两者都优先使用 `~/.agent-browser/browsers/chrome-148.0.7778.97`，不存在时回退到自带浏览器。

要求 Node.js 20 以上。`agora-rtm` 通过本机路径 `file:/Users/zhouxueqin/Downloads/agora-rtm-2.3.0-beta.0` 解析——这是机器专属的 beta 包，换机器后 `npm install` 会失败，需要一并提供该包或替换为已发布版本。

## 语聊房架构（`demos/voice-room/src/`）

按端口与适配器分层，让房间逻辑可以完全脱离网络测试：

```
domain/            纯状态、状态转移和线上消息协议（不含 SDK、不做 I/O）
runtime/ports/     RtmPort、RtcPort —— 与 SDK 无关的接口
runtime/agora/     AgoraRtmAdapter、AgoraRtcAdapter、errorMap（仅此处 import SDK）
runtime/testing/   MemoryRtmPort、MemoryRtcPort —— 记录 `operations: string[]` 调用轨迹
runtime/           VoiceRoomClient（单端编排器）、RoomStateRepository
components/        纯展示的房间 UI
app/               SetupPage、RoomPage、connectionSettings、路由
```

修改这部分代码时必须保住的关键约束：

**RTM Storage 是房间权威状态。** `RoomStateRepository` 读写单个 channel metadata key `voice-room-state`，其中存放一个 `VoiceRoomSnapshot`。所有变更都要走 `repository.mutate(transition)`：获取 RTM Lock `room-state` → 重新读快照 → 应用 `domain/transitions.ts` 中的纯函数转移 → 带 `majorRevision` 写入实现乐观并发 → 在 `finally` 中释放锁。不要在 `mutate()` 之外改快照，也不要往转移函数里塞 I/O，`domain/` 必须保持纯净。

**Lock 必须先创建才能获取。** `AgoraRtmAdapter.acquireLock` 处理了 `LOCK_NOT_EXIST`（-14008）→ 创建 → 重新获取的路径，并容忍对端客户端抢先创建导致的 `LOCK_ALREADY_EXIST`（-14004）竞态。改动锁相关代码时要保留这套处理。

**消息统一封装、带 TTL、并做去重。** `domain/protocol.ts` 把每条 RTM 负载包进 `VoiceRoomEnvelope`（`schemaVersion: 1`、`messageId`、房间与目标校验、`expiresAt`）。接收端先 `parseEnvelope`，再走 `createMessageDeduper().accept()`。治理类命令（`member.kick`、`member.ban`、`seat.mute.command`、`seat.leave.command`）设置 `requiresAck: true`，在 `ackTimers` 里登记超时，并等待 `sendExecutedAck` 回的 `command.ack`。

**麦位激活由媒体结果驱动。** 房主同意申请或听众接受邀请后，麦位先进入 `joining`；只有听众端 RTC `publishMicrophone()` 成功后才变成 `active`，失败则调用 `rollbackJoiningSeat` 回滚。这个顺序不能改，UI 和 E2E 测试都依赖它。

**`connect()` 分阶段回滚。** 它用 `rtmConnected` / `rtmSubscribed` / `rtcJoined` 记录进度，出错时经 `rollbackConnect` 逆序清理，并吞掉清理过程中的异常，让最初的失败原因暴露出来。新增步骤请沿用同一模式，不要加无保护的 await。

**重连靠重新读取，而不是重放。** RTM 从 `reconnecting` 回到 `connected` 时，`rehydrateAfterReconnect` 会重新订阅、重新拉取 Presence 和 Storage，并按最终快照对账麦克风状态。

**一个标签页里跑两个真实客户端。** `RoomPage` 用同一个 `clientFactory` 创建 `host` 和 `audience` 两个 `VoiceRoomClient`，先连房主再连听众，并用 `lifecycleRef` 计数器守卫每个异步步骤，避免 React StrictMode 的重复挂载/卸载泄漏连接。测试里注入假工厂即可——`RoomClientFactory` / `RoomClientLike` 就是为此存在的。两端都会真实播放音频，人工验证时必须戴耳机。

**凭证只存会话级，且不在本项目生成。** `connectionSettings.ts` 负责规范化并只写入 `sessionStorage`（key 为 `agora.voice-room.connection.v1`）。空 Token 规范化为 `undefined`，RTC 适配器仅在 `client.join` 处转成 `null`。项目不接收 App Certificate、不含 Token 生成器、不预置任何凭证，也不要新增。

## 本项目遵循的 RTM 2.3 SDK 约定

在 `login` 之前注册事件。只用 `linkState`（旧的 `status` 事件已废弃）。使用 `token` 事件，并且只把 `WILL_EXPIRE` 当作即将过期。Message、Presence、Storage、Lock 一起订阅。Presence 查询沿 `nextPage` 翻页取全部在线用户。核对来源和文档链接见 `demos/voice-room/README.md`。

## 测试约定

Vitest + jsdom + Testing Library，测试文件以 `*.test.ts(x)` 与源码同目录放置。运行时测试用 `MemoryRtmPort` / `MemoryRtcPort` 驱动 `VoiceRoomClient`，并断言记录下来的 `operations` 字符串轨迹（例如 `rtm:publish:user:audience-001:seat.approved`）——新增行为请沿用这种方式，而不是直接 mock Agora SDK。E2E 测试使用占位 App ID，**刻意不验证**真实 Agora 连通性；完整真实链路仍需用有效项目凭证人工验收。

## 其他约定

设计文档（spec / PRD）按功能放在 `docs/scratch/<feature-slug>/spec.md`，实现票一票一文件放同目录的 `issues/<NN>-<slug>.md`，每张票用 `Blocked by` 声明阻塞边。**不写单独的 plan 文档** —— 实施顺序由票之间的阻塞边表达。调研笔记放 `docs/research/`，命名为 `YYYY-MM-DD-slug.md`。详见 `docs/agents/issue-tracker.md`。

agent 配置（issue tracker、triage 标签、domain 布局）留在 `docs/agents/`，这是 `/setup-matt-pocock-skills` 的固定落点；`docs/scratch/` 只放各 effort 的工作产物，两者不要混。

`docs/superpowers/{specs,plans}/` 是早期 superpowers 流程留下的历史产出，按项目约束保留、不删除，但**不要再往那里新增文件**。当前在推进的 effort 是 `rtm-demo-lab`，其 spec、plan、票和 handoff 都在 `docs/scratch/rtm-demo-lab/`；配套调研笔记仍在 `docs/research/`。`rtm-scenario-lab`、`standalone-voice-room-spa` 两组文档是已归档的历史材料，留在 `docs/superpowers/` 原地。

Demo 里的踢出、封禁、强制麦控都是客户端协作行为，不构成信任边界。`RoomPage` 会显式渲染生产边界告警，请保持这个表述，不要把它们说成已强制执行的权限控制。

## Agent skills

### Issue tracker

Issue 与 spec 以 markdown 文件形式存放在本仓库 `docs/scratch/` 下，本地跟踪，无远端 tracker。详见 `docs/agents/issue-tracker.md`。

### Triage labels

沿用五个规范角色的默认标签名：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。详见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文布局：根目录 `CONTEXT.md` + `docs/adr/`，两者均由 `/domain-modeling` 惰性创建。详见 `docs/agents/domain.md`。
