# RTM Demo 实验室重构

Label: `wayfinder:map`

## Destination

锁定「实验室骨架 + 语聊房样板场景」的全部设计决策，使其足以支撑一份可建造的 spec。验收锚点：第二个场景能靠复制样板在一天内产出。

23 个场景的逐个实现**不在**本图范围内 —— 本图产出决策，不产出交付物。

## Notes

### 领域

声网 RTM 2.x（`agora-rtm@2.3.0-beta.0`）能力演示实验室，辅以 RTC 做语音/视频。最终开源交付给客户，作为一个整页挂在上层网站中。

输入材料：`docs/inputs/index.md`、`docs/inputs/单个demo页面的参考UI.png`（腾讯云音视频的两级 tab 布局参考）。
现有代码：`demos/voice-room/`（主线语聊房 SPA）、根 `src/`（遗留 24 场景实验室，作为场景清单的种子）。
仓库约定见 `CLAUDE.md`；文档一律简体中文。

### 每个 session 应参考的技能

`/grilling`、`/domain-modeling`（术语）、`/codebase-design`（模块形状）、`/research`（外部事实）、`/prototype`（UI/交互）。

### 已定决策（charting 前置，不再重开）

1. **遗留实验室作为种子** —— 根 `src/domain/scenarioCatalog.ts` 的元数据（8 个一级分类、24 个场景、roles、capabilities 标注）作为导航注册表的来源；执行层（`canvas` 抽象、`simulation.ts`、`realScenarioRuntime.ts`）弃用。
2. **一个二级场景一份 `rtm.ts`** —— TypeScript，不是 `.js`。目标是客户能直接拷进自己项目集成。
3. **RTM 依赖暂指向本地包**，后续发布到 npm。
4. **env 由父页面写 `window.__ENV__`** 注入。
5. **默认使用不支持 token 的 appId** —— demo 不让体验用户传 token；后续若换成支持 token 的 appId，只需 `login` 多传一个参数。
6. **多用户场景只允许一人开麦/开摄像头**，其余默认关闭；各二级场景的人数上限在实现时逐个约定。
7. **单一 appId，RTM/RTC 共用**；本 demo 主打 RTM 能力，RTC 仅作辅助，只用到语音和视频。
8. **`rtm.ts` 只承载 RTM 机制**（连接、订阅、发布、Storage+Lock 并发、事件分发），业务状态机以回调注入，留在场景目录的另一个文件里。
9. **`rtm.ts` 内部自带 trace 数组并导出** —— 底层 RTM API 粒度采集，零依赖，客户拷走即可运行；那段观测代码客户可留可删。
10. **`rtm.ts` 导出场景语义方法**（如 `requestSeat()`、`approveSeat()`、`kickMember()`），不是 RTM API 的扁平薄包装。客户打开文件即看到「这个业务动作要调哪些 RTM API」。

### 张力（已知，非待决）

决策 10（场景语义方法，23 份各不相同）与验收锚点（第二个场景一天产出）存在张力。缓解方向不能是「抽共享层」—— 那会破坏决策 9 的零依赖。`02` 号票需要给出在零依赖前提下降低复制成本的具体形态。

## Decisions so far

- [41 页面级 RTM 会话与事件分发](./issues/41-页面级-rtm-会话与事件分发.md) —— 页面级模块在 login 前一次注册 SDK 事件，只将事件分发给当前角色，并将房间操作与 login/logout 生命周期分离。
- [42 本地房间目录与唯一 URL payload](./issues/42-本地房间目录与唯一-url-payload.md) —— 目录仅存于 UTC 日期 Local Storage key，邀请仅用严格校验的 `data` Base64URL payload 传输并按 roomId 合并单个房间。
- [43 Host RTM 深接口收缩](./issues/43-host-rtm-深接口收缩.md) —— Host 房间模块的新接口只暴露订阅、Storage 单写、Presence State、消息和 trace，不承担页面登录或首快照等待。
- [44 Audience RTM 深接口与 whoNow 准入](./issues/44-audience-rtm-深接口与-whonow-准入.md) —— Audience 只在订阅前用一次 `whoNow` 校验 Host，入房后仅消费事件，且无任何 Storage 写入能力。
- [45 事件驱动房间状态与单角色客户端](./issues/45-事件驱动房间状态与单角色客户端.md) —— 房间 store 只由 Presence/Storage 事件建立，订阅不等首快照，RTC 结果不回滚麦位归属。
- [46 归一化入房控制器](./issues/46-归一化入房控制器.md) —— Host 创建与 Audience 三种入口统一执行 Local Storage 落盘、封禁复检、whoNow、挂载和订阅顺序。
- [47 单角色页面状态与订阅 loading 蒙层](./issues/47-单角色页面状态与订阅-loading-蒙层.md) —— 登录、入口、房间和结束态分层呈现，订阅期间房间 UI/时间线保持挂载并由统一蒙层阻断。
- [48 旧架构退场与项目契约同步](./issues/48-旧架构退场与项目契约同步.md) —— 正式运行路径已无 orchestrator、Lock、ACK、主动 metadata 读取或角色级 login/logout；用户确认后旧兼容实现及专属测试已删除。

- [01 场景清单与两级导航映射](./issues/01-场景清单与两级导航映射.md) —— 范围缩小为「只做语聊房，其余先空着」：注册表二级条目只留 `id`/`title`/`summary`/`status`，`status` 仅 `ready` | `planned`；未实现场景 tab 可见可点、进去是路线图占位页；`canvas`/`actions`/`initialStatus` 丢弃，`roles`/`capabilities` 归档到 `docs/` 作为实现资料。
- [02 rtm.ts 契约与目录形态](./issues/02-rtm-ts-契约与目录形态.md) —— `rtm.ts` 导出场景语义方法（B 方案），非 RTM API 扁平包装；契约细节见票内 Answer。
- [03 npm 依赖可安装化](./issues/03-npm-依赖可安装化.md) —— `agora-rtm@2.3.0-beta.0` 确认未发布到 npm（registry 最高 2.2.4），beta 包 vendor 进仓库并用相对 `file:` 路径；同时把所有 `latest` 依赖锁版本。vendor 目录位置待骨架形态定，合规性待用户内部确认。
- [04 RTM Web 多实例与嵌入约束调研](./issues/04-rtm-web-多实例与嵌入约束调研.md) —— 多 RTM 实例（不同 uid）可行，由用户确认；官方文档表述相反且跨实例行为未说明，属「实测可行、文档未保证」，README 必须声明。嵌入方式定为**同源路由挂载**，不用跨域 iframe，故 `window.__ENV__` 成立、麦克风/摄像头无 `allow` 属性问题。国内站与国际站是两个域，需部署两份、各自一套 env。
- [05 时间线数据模型与 uid 前缀](./issues/05-时间线数据模型与-uid-前缀.md) —— 修正为**一场景一角色一份 `rtm-<role>.ts`**（语聊房 = `rtm-host.ts` + `rtm-audience.ts`），各自维护 trace，业务层按 `at` 归并、同毫秒用实例内 `seq` 稳定次序；uid/role 前缀由实例自己贴；trace 导出为可订阅对象（`getEntries()` + `subscribe()`）。
- [07 共享 rtc.ts 接口边界](./issues/07-共享-rtc-ts-接口边界.md) —— `rtc.ts` 共享单份、允许被 import（与 `rtm.ts` 规则不同，需在文档写明理由）；只覆盖语音与视频；**视频把 track 交给 UI 组件自己 play（B 方案），音频保持内部直接 play**；只有实际开音视频的用户创建 RTC 实例；时间线只呈现 RTM，`rtc.ts` 不采集 trace。
- [09 单页 demo 布局原型](./issues/09-单页-demo-布局原型.md) —— 布局定为「一级 tab + 二级药丸 tab + 主区 `1fr` 双手机并排 + 右侧 400px 时间线（可折叠 40px，≤1240px 转横排）」；两级 tab **不加**箭头与键盘导航（原生横向滚动）；时间线单列按 `at` 交错、色点区分 api/event、彩色 uid badge 前置，需支持 **uid / role / kind 三维 UI 层筛选**，超限静默丢弃最旧、**不做截断提示**；场景说明与能力标签本阶段不做，位置预留在页面底部可折叠 div。原型确认后即删。
- [06 env 注入与本地兜底](./issues/06-env-注入与本地兜底.md) —— `window.__ENV__` **只有 `appId` 一个字段**（不加 region/日志级别/白名单）；优先级 `window.__ENV__` → `import.meta.env.VITE_APP_ID` → 引导页（无源码硬编码兜底）；要求上层页面在加载 bundle **前**同步注入，app 启动读一次快照、不监听变化；新骨架**不做** `SetupPage` 等价物，点 tab 直接进场景；房间 ID 与 uid **随机生成**（`voice-room-<rand>` / `host-<rand>` / `audience-<rand>`），`?room=` / `?uid=` 可覆盖用于联调，不落 storage。
- [08 各场景客户端数量上限](./issues/08-各场景客户端数量上限.md) —— 无技术上限、只有体验上限，全部端都是真实链路（模拟端方案作废）；默认 **2 端**，更多端的场景在实现时逐个约定；端数**不进注册表**、写在场景目录自己的 `config.ts`；「只有一人开音视频」的约束落在 `rtc.ts` 单实例语义上，UI 灰置只是配合。
- [10 语聊房迁移切分](./issues/10-语聊房迁移切分.md) —— 一主持人一份、多参与者共享一份 `rtm-<role>.ts`；两份文件间的重复**接受、不抽共享层**；`protocol.ts`（envelope/去重）与 `RoomStateRepository.mutate`（Lock + majorRevision）**下沉进 `rtm-*.ts`**，快照类型与 17 个纯函数转移**留在场景目录**；骨架目录形态与 `vendor/` 置于仓库根一并定下；遗留 `demos/voice-room/` 与根 `src/` 本阶段不删。
- [11 开源合规与交付清单](./issues/11-开源合规与交付清单.md) —— 历史上曾使用本地 vendor 和体验 App ID；当前 SDK 已改为 npm 安装，真实 App ID 只通过本地或部署环境注入，不进入开源仓库；LICENSE 使用 MIT，两站域名白名单**待核实**。
- **charting 已完成** —— 上述 11 条决策已收敛进 [`spec.md`](./spec.md)，并拆成实现票 [`issues/12`–`25`](./issues/)。本图到此不再新增决策票；后续实现遇到需要重新决策的问题，回头补票并同步修 spec。

## Not yet specified

- 遗留根 `src/` 实验室与 `demos/voice-room/` 的最终**移除时机** —— `10` 定了本阶段不删，开源前需定论（`11` 交付清单已列此项）。
- 两站部署的**域名白名单具体清单** —— `11` 标记为待核实，写进 README 前必须核对官方域名列表。
- 若后续某场景需要**模拟端**（如展示百人 Presence 列表），标注方式届时再定 —— `08` 明确本阶段无模拟端。

## Out of scope

- **23 个场景的逐个实现** —— 本图只到骨架 + 语聊房样板 + 「第二个场景可一天产出」的验证。其余场景是后续独立 effort。
- **Token server 示例** —— 决策 5 定了默认无 token 鉴权；提供 token 生成服务是另一件事。
- **上层网站本身** —— 本图只负责「作为一整页被挂进去」的嵌入契约，网站的实现不在范围内。
