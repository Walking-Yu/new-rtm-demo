# 语聊房中的 RTM 使用

这个目录实现了一个可真实联调的单页语聊房，用来展示 Agora RTM Web SDK 在语聊房场景中的典型用法：房间状态怎样同步，成员临时状态怎样传播，以及排麦、邀请、聊天和治理动作怎样发送给一个人或整个房间。

每个浏览器 Tab 只运行一个角色和一个 RTM client。真实联调时，Host 与 Audience 分别打开两个 Tab，使用不同的 RTM UID 加入同一个房间。

## 建议先读

| 材料 | 内容 |
| --- | --- |
| [`app-rtm.ts`](./app-rtm.ts) | 单页应用怎样创建唯一 RTM client、在登录前注册事件、登录、复用和退出 |
| [`host/rtm.ts`](./host/rtm.ts) | Host 的房间初始化、麦位、邀请、治理和公屏动作怎样使用 RTM |
| [`audience/rtm.ts`](./audience/rtm.ts) | Audience 的申请上麦、接受邀请、下麦和公屏动作怎样使用 RTM |
| [《语聊房功能、底层 RTM API、事件与时序》](./docs/语聊房功能底层-RTM-API-事件与时序.md) | 各项功能的发送、接收、状态消费和关键时序 |
| [《语聊房功能与 RTM 函数映射》](./docs/语聊房功能与-rtm-函数映射.md) | 从场景功能直接跳转到对应 Host/Audience 源码实现 |

## 先理解几个术语

| 术语 | 在本文中的意思 |
| --- | --- |
| RTM | Real-Time Messaging，实时信令与状态同步。本场景用它同步房间状态和用户动作，不传输音频 |
| RTC | Real-Time Communication，实时音视频。本场景的声音由 RTC 传输，RTM 只负责协调谁在麦位上以及相关状态 |
| RTM client | Agora RTM SDK 创建的客户端对象。一个 client 使用一个 RTM UID 登录，负责订阅房间、收发消息和读写 RTM 状态 |
| RTM UID | 用户登录 RTM 时使用的唯一标识。它是 RTM 消息的发送者和接收者标识，不等于业务数据库里的用户主键 |
| 房间 / Channel | 多个 RTM 用户共同订阅的逻辑频道。本 Demo 直接使用 `roomId` 作为 Channel Name；订阅后才能收到该房间的消息和状态事件 |
| Channel Type | SDK 用来区分消息发往房间还是单个用户的类型。本 Demo 使用 `MESSAGE` 表示房间频道，使用 `USER` 表示点对点用户频道 |
| listener / event | listener 是提前注册的事件处理函数；event 是 SDK 在连接变化、收到消息或状态变化时传给该函数的数据 |
| publisher | SDK 事件中的消息或状态发布者，值是发送方的 RTM UID |
| Channel Storage | RTM 提供的频道键值存储，也称 Channel Metadata。它适合保存订阅者需要获得的当前房间状态，不是业务数据库 |
| Presence State | 某个在线 RTM 用户附带的临时键值状态。成员离线后不应把它当作持久用户资料 |
| `USER` Message | 点对点消息。发布时 Channel Name 填目标 RTM UID，只有目标用户接收 |
| `MESSAGE` Message | 房间消息。发布时 Channel Name 填 `roomId`，订阅该房间的用户接收 |
| token | 服务端签发给用户的短期访问凭证，用来证明该用户有权登录 RTM 或加入 RTC；不应在浏览器中生成 |
| App Server | 业务自己的服务端，负责账号、数据库、房间目录、权限、token 和其他不能信任客户端自行决定的逻辑 |

## RTM 在这个语聊房中承担什么

| RTM 能力 | 本场景中的用途 | 示例 |
| --- | --- | --- |
| Channel Storage | 保存加入房间后需要获得的完整房间状态 | Host UID、公告、完整麦位表、强制静音名单 |
| Presence State | 同步在线成员的临时状态 | 自主静音、麦克风异常 |
| `USER` Message | 向一个指定用户发送瞬时动作 | 排麦申请、拒绝、上麦邀请、主动下麦、踢出和封禁通知 |
| `MESSAGE` Message | 向整个房间广播瞬时动作 | 聊天、礼物、爱心和房间解散通知 |

选择原则是：需要新成员拿到当前完整结果的状态放在 Storage；只属于在线成员且会随离线消失的临时状态放在 Presence；一次性的业务动作使用 Message。只发给一个人的动作使用 `USER`，房间内所有人都需要收到的动作使用 `MESSAGE`。

## `app-rtm.ts` 做什么

`AppRtmSession` 与单页应用的生命周期一致，是页面内唯一的 RTM SDK client 所有者：

- 创建一个 RTM client；
- 在 `login()` 前注册 `linkState`、`message`、`presence`、`storage` 和 `token` listener；
- 完成登录，并向当前 Host 或 Audience 提供同一个房间操作端口；
- 角色离房时继续保留已登录 client，只取消房间订阅；
- 页面真正卸载时移除 listener 并调用 `logout()`。

它只处理 SDK client 和页面生命周期，不理解排麦、麦位、公告、nickname 或 RTC。

## Host/Audience `rtm.ts` 做什么

两端 `rtm.ts` 把用户功能固定映射到 RTM 调用。业务代码调用的是 `requestSeat()`、`approveSeatRequest()`、`muteMicrophone()` 等语义函数，而不是自行传入任意消息 type 或 metadata key。

Host 负责：

- 订阅和退订房间；
- 初始化和更新 Channel Storage；
- 审批排麦、邀请上麦；
- 更新公告、麦位和强制静音名单；
- 发送踢出、封禁、解散和公屏消息。

Audience 负责：

- 订阅和退订房间；
- 申请上麦、接受或拒绝邀请、主动下麦；
- 更新自己的 Presence 临时状态；
- 发送公屏消息。

Host 与 Audience 的能力不同，因此分别保留两份 `rtm.ts`。Audience 不写 Channel Storage，最终麦位归属始终由 Host 写入。

通用的 `publishToUser()`、`publishToRoom()`、`setPresenceState()` 和 `setRoomMetadata()` 保持私有，避免业务代码绕过场景协议。

## 事件怎样回到业务

[`host/onRtmEvent.ts`](./host/onRtmEvent.ts) 和 [`audience/onRtmEvent.ts`](./audience/onRtmEvent.ts) 接收页面级 client 转发的 SDK 事件，并负责：

- 过滤房间和 Channel Type；
- 校验消息信封的版本、房间、目标用户和有效期，具体含义见下一节；
- 使用 `messageId` 去重；
- 把合法事件交给 [`event-driven-single-room-client.ts`](./event-driven-single-room-client.ts) 更新语聊房状态。

## 消息信封、校验、TTL 和去重

RTM SDK 只负责传递字符串，并不知道“申请上麦”或“踢出成员”是什么。本 Demo 会先把业务内容包装成一个 JSON 对象再发送，这个外层对象称为**消息信封**。

例如，Audience 向 Host 申请 2 号麦位时，实际发送的字符串解析后类似：

```json
{
  "schemaVersion": 1,
  "messageId": "8f3a...",
  "type": "seat.request",
  "roomId": "room-1001",
  "targetUserId": "host-1001",
  "sentAt": 1787191200000,
  "expiresAt": 1787191215000,
  "payload": {
    "requestId": "req-1001",
    "seatId": "seat-1"
  }
}
```

- `schemaVersion`：信封格式版本。接收方只处理自己认识的版本。
- `messageId`：每条消息的唯一 ID，用于识别重复消息。
- `type`：业务动作类型，例如 `seat.request` 或 `room.dissolved`。
- `roomId`：消息所属房间，防止其他房间的消息进入当前状态。
- `targetUserId`：点对点消息的目标 RTM UID；房间广播不需要该字段。
- `sentAt`：发送时间，使用 Unix 毫秒时间戳。
- `expiresAt`：过期时间，同样使用 Unix 毫秒时间戳。
- `payload`：真正的业务参数。上例中是申请 ID 和目标麦位。

**信封校验**是指接收方在执行业务动作前依次检查：消息能否解析为 JSON、必填字段和类型是否正确、`schemaVersion` 是否支持、`roomId` 是否是当前房间，以及点对点消息的 `targetUserId` 是否是本端 UID。不满足条件的消息直接丢弃，不进入语聊房状态。

**TTL** 是 *Time To Live*，即消息允许存活的时间。本 Demo 发出的消息 TTL 固定为 15 秒：`expiresAt = sentAt + 15 秒`。接收时如果当前时间已经达到或超过 `expiresAt`，说明这个瞬时动作已经过时，例如用户不应在很久以后才收到一条旧的上麦邀请，因此直接丢弃。TTL 只决定“过期后不处理”，不保证消息一定送达。

**去重**是指本端记住最近已经接受的 `messageId`；再次收到相同 ID 时不重复执行业务动作。本 Demo 最多保留最近 500 个 ID，防止去重集合无限增长。

这个 Demo 不自动重试。`publish()` 成功只表示 SDK 的发布调用成功完成，不表示目标客户端已经执行了对应业务动作。

更完整的排麦、邀请、下麦、麦克风异常和房间解散链路见[时序文档](./docs/语聊房功能底层-RTM-API-事件与时序.md)。

## Demo 中由浏览器代替 App Server 的部分

这个仓库没有 App Server。为了让 Demo clone 后可以直接运行，以下能力临时放在浏览器中实现；接入真实业务时应替换，而不是照搬。

### 房间目录、成员准入和封禁

Demo 使用 Local Storage 保存房间目录、房间 `active/inactive` 状态和封禁名单，并把部分房间信息放进邀请 URL。

生产环境应由 App Server 提供房间创建与查询、成员准入、封禁、房间生命周期和邀请校验。邀请链接通常只携带房间 ID 或服务端签发的邀请凭证，不应把 Local Storage 当作跨用户的房间权威来源。

### 用户身份和 nickname

Demo 没有用户数据库，因此把 `displayName` 临时写入 Presence State，让其他客户端能显示 nickname。这只是为了完成演示，不是推荐的用户资料存储方式。

生产环境应由 App Server 维护身份关系。`App UID` 是业务系统中唯一标识一名用户的主键，同一条用户记录关联该用户的 nickname、avatar 和 RTM UID，例如：

```text
App UID（唯一主键）
├── nickname
├── avatar
└── RTM UID（唯一，用于登录 RTM 和反查 App 用户）
```

客户端登录业务账号后，App Server 根据 App UID 返回当前用户的 nickname、avatar、RTM UID 和相关 token。收到 RTM 事件时，客户端可以使用事件中的 publisher RTM UID，通过 App Server 接口或业务侧成员资料缓存反查 App UID，再取得 nickname 和 avatar。若 App UID 与 RTM UID 是一对一关系，数据库还应为 RTM UID 建立唯一索引，保证反向查询不会对应到多个 App 用户。

Presence 更适合承载 `muted`、`microphoneError` 这类在线临时状态，不应替代业务用户数据库。

### Token 与权限

本仓库不生成 token、不接收 App Certificate，也没有完整的 token 续期流程。生产环境应由 App Server 鉴权、签发和续期 RTM/RTC token，并在服务端执行真正的房间权限与治理规则。

踢出、封禁和强制麦控在本 Demo 中都是客户端协作行为，不构成服务端权限控制。

根目录 [`README.md`](../../../README.md) 提供运行、环境注入和整个场景实验室的说明。
