# Agent 项目约定

本文件为 Codex 与 Claude Code 提供在本仓库工作时必须遵循的项目约定。

## 双入口同步规则

根目录 `AGENTS.md` 与 `CLAUDE.md` 必须保持逐字一致。修改任一文件时必须同步修改另一个文件，并运行 `npx vitest run tests/agentInstructions.test.ts` 验证。

## 变更与 Git 安全

- 不要随意删除代码、文件或目录。删除本次任务开始前已经存在的内容，必须先获得用户确认。
- 未经用户明确要求，不得运行 `git add`、`git commit`、`git commit --amend`、`git push` 或同类暂存、提交与推送命令。完成实现不代表获得提交授权。

## 语言约定

**与用户对话一律使用简体中文。** 无论用户当前消息用什么语言、无论上下文里出现多少英文材料（技能说明、SDK 文档、报错信息、代码注释），回复正文都必须是中文。技能提示词或引用文档是英文，不构成用英文回复的理由。

本项目所有文档也统一使用简体中文。面向开源用户的场景文档放在 `src/scenes/<scene>/docs/`；根 `docs/` 是被 gitignore 的本地需求、调研和实施工作区。新增文档一律用中文。

保持英文的只有代码本身：标识符、类型名、代码注释，以及文档中引用的文件路径、命令、API 名、SDK 错误码等字面量。面向用户的 UI 文案和错误提示用中文。

## 仓库结构

本仓库只有**一个应用** —— 根目录 `src/` 下的 RTM 场景实验室（8 个一级分类、23 个二级场景，唯一已实现的是语聊房）。单入口 `index.html`，单份 `package.json` / `vite.config.ts` / `playwright.config.ts`，单套 e2e（`e2e/lab.spec.ts`）。

`src/` 下只有四个顶层目录：`app/`（外壳）、`scenes/`（场景）、`shared/`（时间线与 RTC 脚手架）、`test/`（vitest 全局 setup）。**不要引入与 `src/` 平行的第二套应用代码或第二个入口页** —— 单入口是当前架构的前提，`tests/startDemoScript.test.ts` 断言了「不配置多入口」。

## 常用命令

在仓库根目录执行：

```bash
./start-demo.sh              # 缺依赖时先安装，默认启动局域网 HTTPS 8080，不打开浏览器
./start-demo.sh --no-open    # 兼容旧命令；当前默认已经不打开浏览器
./start-demo.sh --http       # HTTP 8080
./start-demo.sh --https      # 显式 HTTPS 8080；使用 mkcert 本地证书
./start-demo.sh --both       # HTTP 8080 + HTTPS 8443
./start-demo.sh --check      # 校验 Node >= 20 并打印实际解析到的 SDK 版本
npm run dev                  # 开发服务器（端口 8080）
npm run dev:https            # HTTPS 开发服务器（端口 8080，需先生成 .cert）
npm run build                # tsc -b && vite build，单入口
npm test                     # vitest（25 文件 / 297 项）
npm run test:e2e             # playwright（无头）
npm run test:e2e:lab         # 只跑 e2e/lab.spec.ts
```

跑单个测试或聚焦某个用例：

```bash
npx vitest run src/scenes/voice-room/host/rtm.test.ts
npx vitest run -t "approves a seat request"
npx playwright test --project=desktop-chromium -g "两台手机"
```

Playwright 无头运行，自己拉起 dev server（端口 4173）。优先使用 `~/.agent-browser/browsers/chrome-148.0.7778.97`，不存在时回退到自带浏览器。

局域网麦克风/摄像头要求可信 HTTPS。`start-demo.sh` 默认监听 `0.0.0.0`、启动 HTTPS 8080 且不打开浏览器；`--https` 显式选择相同行为，`--http` 保留普通 HTTP 入口，`--both` 同时启动 HTTP 8080 与 HTTPS 8443。HTTPS 模式用 `mkcert` 为本机和局域网 IPv4 生成 `.cert/dev.pem` 与 `.cert/dev-key.pem`；`.cert/` 必须保持 gitignore。脚本不得自动安装根 CA，用户需明确执行 `mkcert -install`；远端设备也必须单独信任启动日志打印的 `rootCA.pem`。普通 HTTP 下浏览器可能禁用媒体采集和 Clipboard API。

Playwright 使用独立的 `e2e` mode，`vite.config.ts` 在该 mode 下设置 `envDir: false`，因此测试不会加载开发者本机的 `.env.local`。普通 `npm run dev` 仍按 Vite 默认规则加载 `.env.local`，两者不要合并。

要求 Node.js 20 以上。`agora-rtm@2.3.0` 已正式发布，`package.json` 使用 `"agora-rtm": "^2.3.0"` 从 npm 安装。`vendor/` 仅是本机历史副本，必须保持 gitignore，不随开源仓库分发。

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
  rtc.ts                 全场景共享的 RTC 辅助
  timeline/              trace store、多实例归并、过滤、时间线面板
test/setup.ts            根 vitest 的 setup，服务整个 src/
vite-env.d.ts            `vite/client` 类型引用，服务整个 src/（提供 import.meta.env 与 ?raw）
```

`src/scenes/voice-room/` 内部：

```
host/
  rtm.ts                   房主端纯 RTM 机制
  onRtmEvent.ts            房主端 SDK 事件绑定与协议校验
audience/
  rtm.ts                   听众端纯 RTM 机制
  onRtmEvent.ts            听众端 SDK 事件绑定与协议校验
app-rtm.ts    与语聊房单页面应用生命周期对齐的唯一 RTM client、登录和事件分发
browser-room-directory.ts  Local Storage 房间目录
voice-room-url.ts  唯一 data 参数的 Base64URL codec
room-entry-controller.ts   Host/Audience 归一化准入与订阅顺序
event-driven-single-room-client.ts 当前 Tab 单角色业务桥接与房间 store
config.ts          SEAT_COUNT、DEFAULT_ANNOUNCEMENT
VoiceRoomScene.tsx 场景容器
```

修改这部分代码时必须保住的关键约束：

**每个 Tab 只有一个角色和一个 RTM client。** `AppRtmSession` 在 `login()` 前一次注册事件，再把事件分发给当前 Host 或 Audience `onRtmEvent.ts`。离开房间只 `unsubscribe()`，语聊房 SPA 真正卸载才 `logout()`。

**不要抽跨角色的 RTM 基类。** 房主和听众各自保留 `rtm.ts`，共同机制的重复是刻意的。`rtm.ts` 只依赖页面级会话 seam，不创建 SDK client，不 login/logout。对业务层暴露的函数必须按用户功能命名（如 `muteMicrophone`、`requestSeat`、`approveSeatRequest`），固定它使用的 RTM primitive、消息 type、metadata key 和 trace；通用 `publishToUser` / `publishToRoom` / `setPresenceState` / `setRoomMetadata` 只能作为私有实现。完整函数契约见 `src/scenes/voice-room/docs/语聊房功能与-rtm-函数映射.md`。

**RTM Storage 是房间权威状态。** 房间 metadata 只有 `hostUserId`、`announcement`、`seats`、`forcedMutedUserIds` 四个 key。Host 收到空 Storage `SNAPSHOT` 时用该快照的 `majorRevision` 一次初始化；非空全量事件直接替换本地 store。Audience 不写 Storage。最终协议不使用 Lock，不调用 `getChannelMetadata()`。

**房间目录与封禁只存在 Local Storage。** 目录 key 为 `record-channel-list-YYYYMMDD`，URL 只有一个 `data` Base64URL 参数。封禁通过本地目录、邀请快照和 P2P 消息尽力同步，不构成服务端权限。

**房间生命周期是 active/inactive。** 新房间和旧目录缺省归一为 `active`；Host“暂时离开”只离开 RTC 并 RTM unsubscribe，房间保持 active，可通过 Host URL 恢复。Host“解散房间”先把本地目录置为终态 `inactive`，再广播 `room.dissolved` 并退订；Audience 收到后也置 inactive 并退订。inactive 不得被后续旧邀请重新激活，也不出现在可加入列表。

**邀请复制优先完整 URL，失败降级短内容。** Host 点击邀请时，Clipboard API 成功则复制当前 origin 的完整 Audience URL；Clipboard API 不可用或拒绝时，兼容复制只写 `data=...`。Audience 输入始终兼容完整 URL、`?data=...`、`data=...` 和纯 Base64URL payload。

**消息统一封装、带 TTL、并做去重。** `rtm.ts` 创建的信封包含 `schemaVersion`、`messageId`、`roomId`、可选目标 UID、`sentAt`、`expiresAt` 和 payload。`onRtmEvent.ts` 先校验来源/目标/TTL，再按 `messageId` 去重。最终协议不自动重试。

**nickname 只来自 Presence store。** 订阅成功后 `initializeMemberState(displayName)` 首次写 nickname；Host 同时写 `muted=false`，尚未上麦的 Audience 不写 `muted`。Audience RTC 发布成功后才增量写 `muted`，主动或被迫下麦后用 `presence.removeState` 删除 `muted` 与 `microphoneError`。排麦申请、接受邀请和公屏消息均不携带 nickname，接收方按 publisher UID 调用业务 store 的 `getNickNameByUid()`。麦位 UI、trace 和系统消息不得把 Storage `seat.displayName` 当作 nickname；Presence 中无 nickname 或用户已离线时，统一降级展示省略后的 UID。Host 批准排麦只写 `seats` metadata，不发 `seat.approved` P2P。封禁动作在发 `member.ban` P2P 之前必须通知入房控制器更新 Local Storage `banUserIds`。

**可读 trace 的业务解释只做一次。** nickname 映射、麦位解析和 Presence/Storage/Message 的可读摘要由业务桥接层生成；角色 `rtm.ts` 不维护第二份 nickname store，不解析 Storage 来理解麦位。业务 store listener 返回 `summary` 和延迟执行的 `consume`；`onRtmEvent.ts` 先记录事件 trace，再调用 `consume` 并观察异步失败。角色构造参数中的只读 `describeUser` / `describeSeats` 只服务 API trace，不得在 `rtm.ts` 内复制业务状态。

**Storage 全量更新，trace 只呈现 diff。** 业务桥接层在覆盖 store 前比较当前快照和最新完整快照，Storage 事件 trace 只列变化的 key；首次快照写 `initialize`。`updateSeats` API trace 只列发生变化的麦位。首次权威麦位快照只建立基线，不生成“Host 上了 1 号麦”等历史系统消息；只有入房后的麦位变化才生成上麦/下麦消息。

**麦位只表达归属，媒体结果不回滚麦位。** `seats` 元素只有 `seatId`、`userId`、`displayName`。批准或接受邀请由业务 store 驱动 Host `rtm.ts` 的 `approveSeatRequest()` / `updateSeats()` 无 Lock 写入归属，再尝试发布 RTC 麦克风；发布失败只显示媒体错误，保留麦位供重试。自主静音来自 Presence State，强制静音来自 `forcedMutedUserIds`。

**麦克风设备异常通过 Presence State 协作同步。** `rtc.ts` 用本地 AudioTrack 是否存在、底层 `MediaStreamTrack.readyState === "live"` 且未 muted 判断采集健康；RTC publish 失败但本地轨道采集健康时只提示发布失败，不写设备异常。仅采集轨道不存在、ended 或 muted 时，Host/Audience 调用 `reportMicrophoneError()` 增量写 `microphoneError=true`，本端与其他端在对应麦位显示异常标识。仍在麦位且采集恢复时调用 `clearMicrophoneError()` 写回 `false`；Audience 主动或被迫下麦时调用 `clearSeatMediaState()` 删除 `muted` 与 `microphoneError`。该状态不改变 Storage 麦位归属。`REMOTE_STATE_CHANGED` 携带最新完整 State，trace 必须与旧 State 比较后只展示真正变化的 key。

**Host 与 Audience 的本端麦克风共用语义。** Host 的 1 号麦也必须在 RTC join 和权威麦位就绪后发布麦克风，并通过 Host `rtm.ts` 的 `muteMicrophone()` / `unmuteMicrophone()` / `reportMicrophoneError()` / `clearMicrophoneError()` 同步 Presence。Host 与 Audience 都可自主闭麦/开麦；只有 Audience 下麦时删除麦位媒体 State。

**可读 message trace 包含普通聊天内容。** RTM 收到合法信封后先记录 message 事件，再启动业务消费，保证 `seat.left` 先于后续 Storage API。`chat.message` 事件摘要格式为 `chat.message from <nickname>: <text>`；礼物、爱心和 P2P 控制消息不追加 payload 正文。Host 收到 `seat.request` 时同时在房间视图显示 3 秒业务 toast。

**Host 排麦队列与 Audience 等待态共用 30 秒超时。** Host 收到 `seat.request` 后为该申请记录本地 `expiresAt`，列表逐秒展示剩余时间；30 秒未审批/拒绝则自动删除。审批、拒绝、成员离开、目标麦位被占用或房间离开时必须清理对应 timeout；队列为空时停止 ticker。

**Audience 上麦申请先锁定再 publish。** 第一次点击必须在 await P2P publish 前同步设置 `waitingSeatId` 并发布 view，防止快速连点并发发送多个 `seat.request`；publish 失败时回滚等待态，成功后再启动 30 秒超时。

**上麦申请只能是 USER P2P。** Audience `requestSeat()` 固定向 Host UID 使用 `channelType=USER` 发布 `seat.request`，禁止发到房间 `MESSAGE`。Host 暂时离开时，未上麦 Audience 的申请按钮禁用并通过 title 说明无法处理；业务方法同样拒绝申请。已在麦 Audience 的主动下麦按钮不受此禁用条件影响。

**上麦 P2P 失败与麦位竞争必须显式收敛。** Audience 申请或 Host 邀请的 USER P2P publish 超时、目标不在线或失败时，在房间视图 toast“<nickname> 不在线”；申请失败同时回滚等待态。Storage 最新快照若显示申请中的麦位被其他 UID 占用，申请方清除等待态并 toast“上麦申请被拒绝”；邀请中的麦位被任意 UID 占用时，其他受邀方清除邀请并隐藏接受/拒绝入口。收到 `seat.invited` 时公屏滚到顶部展示操作，之后有新公屏消息时再滚到底部。

**`subscribeRoom()` 的 Promise 只代表 SDK `subscribe()` 完成。** 它不等 Presence 或 Storage 首快照。订阅失败只回滚当前角色绑定和房间订阅，不操作页面级登录。

**重连只消费 SDK 后续全量事件。** 不重复 `subscribe()`、不调用 `getChannelMetadata()`、不重放历史消息。Presence `SNAPSHOT` 全量替换在线 store：缺失 nickname 时不保留旧映射，缺失本端 `muted` 时默认 `false`，缺失远端 `muted` / `microphoneError` 时从对应 store 删除并按 `false` 展示；join/leave/timeout/interval 做增量更新，禁止 `presence.getOnlineUsers()`。

**一个标签页只跑一个真实客户端。** Host 与 Audience 的真实联调使用两个标签页；`RoomEntryController` 用 generation 守卫所有准入和订阅 await。两个页面都会真实播放音频，**人工验证时必须戴耳机**。

**Host Presence 缺席只表示暂时离开。** active 房间的 Audience 准入不调用 `whoNow`，通过本地封禁与 status 检查后直接 subscribe。Presence SNAPSHOT/leave/timeout 中 Host 不在线时只把 `hostTemporarilyAway` 置为 true，Host 麦位显示“暂时离开…”，其他成员继续互动；Host 回来后清除。只有目录 inactive 或收到 `room.dissolved` 才进入结束页。

**时间线只呈现 RTM，`rtc.ts` 不采集 trace。** 混入 RTC 节点会稀释「RTM 数据流」这条主线。RTC 的成败体现为后续那次 RTM 调用的出现或缺席，因果仍然可读。

**页面 login 与终止 unsubscribe 必须可见。** `AppRtmSession` 记录真实 `rtm.login` API trace，并与当前角色 trace 合并。解散、被踢和被封禁后仍保留 client trace source，直到 `rtm.unsubscribe` 节点可见；不得因结果页切换而提前移除 trace source。

**应用级 listener 从 login 前记录 linkState。** `AppRtmSession` 与语聊房单页面应用生命周期对齐：场景挂载时创建并在 SDK `login()` 前注册 listener，房间/角色切换时复用，场景真正卸载时 `logout()`。它独占记录整个页面生命周期的真实 linkState trace，包括首次连接；trace 来源标记为 `app`，不是第三种业务角色。Host/Audience `onRtmEvent` 只更新业务连接状态，不重复写节点。数据流默认展示连接事件，用户可手动隐藏。

**数据流在页面生命周期内只追加。** 角色切换、暂时离开、解散、被踢、被封禁或 client 替换都不得清空或移除既有 trace source，两份当前角色 `rtm.ts` 也不得按条数自动截断。只有用户点击“清空”才调用各 source 的 `clearTraces()`；页面刷新或场景组件真正卸载后可从空数据流重新开始。

**凭证不在本项目生成。** 不接收 App Certificate、不含 token 生成器、不预置密钥，也不要新增。appId 只从 `window.__ENV__` 或 `.env` 来；源码里刻意没有第三层硬编码兜底。

## 本项目遵循的 RTM 2.3 SDK 约定

在 `login` 之前注册事件。只用 `linkState`（旧的 `status` 事件已废弃）。使用 `token` 事件，并且只把 `WILL_EXPIRE` 当作即将过期。房间订阅只开 Message、Presence 和 Metadata，`withLock: false`。Presence 由 `SNAPSHOT` 和增量事件维护，禁止调用 `presence.getOnlineUsers()`。核对来源和文档链接见根目录 `README.md`。

## 测试约定

Vitest + jsdom + Testing Library，测试文件以 `*.test.ts(x)` 与源码同目录放置。

**两类测试替身职责不同**：

- `host/rtm.test.ts` / `audience/rtm.test.ts` 里的页面级 RTM port 替身——记录 `subscribe`、`publish`、Presence 和 Storage 的原子调用，用来断言业务桥接层到角色 `rtm.ts` 再到页面级 seam 的完整行为。
- `testing.ts` 的 `createVoiceRoomFakes()`——给渲染真实场景的测试用（外壳路由、场景 UI）。场景一挂载就自动连接，不注入替身就会去连真实 RTM。它只需要「不发网络请求、能被驱动」，所以是无副作用空实现加少量开关。

E2E 使用占位 App ID，**刻意不验证**真实 Agora 连通性；完整真实链路仍需用有效项目凭证人工验收。

## 其他约定

设计文档（spec / PRD）按功能放在 `docs/scratch/<feature-slug>/spec.md`，实现票一票一文件放同目录的 `issues/<NN>-<slug>.md`，每张票用 `Blocked by` 声明阻塞边。**不写单独的 plan 文档** —— 实施顺序由票之间的阻塞边表达。调研笔记放 `docs/research/`，命名为 `YYYY-MM-DD-slug.md`。详见 `docs/agents/issue-tracker.md`。

agent 配置（issue tracker、triage 标签、domain 布局）留在 `docs/agents/`，这是 `/setup-matt-pocock-skills` 的固定落点；`docs/scratch/` 只放各 effort 的工作产物，两者不要混。

`docs/superpowers/{specs,plans}/` 是早期 superpowers 流程留下的历史产出，按项目约束保留、不删除，但**不要再往那里新增文件**。当前在推进的 effort 是 `rtm-demo-lab`，其 spec、plan、票和 handoff 都在 `docs/scratch/rtm-demo-lab/`；配套调研笔记仍在 `docs/research/`。`rtm-scenario-lab`、`standalone-voice-room-spa` 两组文档是已归档的历史材料，留在 `docs/superpowers/` 原地。

Demo 里的踢出、封禁、强制麦控都是客户端协作行为，不构成信任边界。文档和代码说明这些能力时，不要把它们说成已强制执行的权限控制。

## Agent skills

### Issue tracker

Issue 与 spec 以 markdown 文件形式存放在本仓库 `docs/scratch/` 下，本地跟踪，无远端 tracker。详见 `docs/agents/issue-tracker.md`。

### Triage labels

沿用五个规范角色的默认标签名：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。详见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文布局：根目录 `CONTEXT.md` + `docs/adr/`，两者均由 `/domain-modeling` 惰性创建。详见 `docs/agents/domain.md`。
