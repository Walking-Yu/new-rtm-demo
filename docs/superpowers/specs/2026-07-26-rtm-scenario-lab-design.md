# RTM 2.x Scenario Lab Design

## 1. Objective

Build a Chinese, clickable RTM 2.x scenario lab that makes the product's value visible through concrete business interactions.

The lab covers all 24 scenarios from the source material. Every scenario has its own route and a small interactive prototype. Two representative scenarios also support a real `agora-rtm@2.2.4` connection:

- Voice room seat management
- IoT remote device control

The first release is a product-capability prototype. It is not a production backend, a complete IM product, or an RTC media demo.

## 2. Scope

### 2.1 Included

- A Vite, React, and TypeScript single-page application.
- A grouped navigation covering 8 industries and 24 scenario routes.
- Clickable local simulations for every scenario.
- Distinct canvas templates for rooms, classrooms, devices, meetings, orders, calls, chat, and operations.
- Role switching, entity state, scenario actions, and an event timeline on every scenario page.
- A capability mapping drawer that maps business actions to RTM User Message, Message Channel, Presence, Storage, and Lock.
- A shared `ScenarioRuntime` contract used by local simulation and real RTM modes.
- Real RTM mode for voice room seat management and IoT remote device control.
- Session-only connection settings for App ID, User ID, and Token.
- Unit, component, and headless end-to-end tests.

### 2.2 Excluded

- A Token server or App Certificate handling in the browser.
- Real RTC audio or video tracks.
- A complete IM system, offline push, roaming history, or unread counters.
- A production authority service, database, content moderation backend, or monitoring platform.
- Production guarantees for message delivery, ordering, retry, or durable state.
- Real customer names and CIDs in the prototype UI.

## 3. Scenario Catalog

Each scenario is identified by a stable slug and belongs to one industry group.

| Group | Slug | Display name | Canvas | Key prototype actions |
| --- | --- | --- | --- | --- |
| Social and entertainment | `social-presence` | 在线、好友与忙闲状态 | chat | 上线、设为忙碌、关注上线 |
| Social and entertainment | `social-chat` | 私聊、群聊与消息回执 | chat | 发私信、发群消息、标记已读 |
| Social and entertainment | `voice-room-interaction` | 礼物、弹幕与房内互动 | room | 发弹幕、送礼物、发送表情 |
| Social and entertainment | `voice-room-seats` | 上下麦与麦位状态 | room | 举手、同意、拒绝、上麦、禁麦、下麦 |
| Social and entertainment | `live-social-pk` | 连麦、PK 与房间互动 | room | 发起 PK、接受、计分、结束回合 |
| Social and entertainment | `one-to-one-call` | 呼叫、接听与挂断 | call | 呼叫、接听、拒绝、挂断 |
| Social and entertainment | `room-moderation` | 禁言、踢人、举报与封禁 | room | 禁言、举报、踢出、解除限制 |
| Online education | `classroom-messaging` | 课堂 IM 与班级通知 | classroom | 提问、答疑、发送班级通知 |
| Online education | `classroom-stage` | 举手、上下麦与连麦 | classroom | 举手、点名、上台、结束发言 |
| Online education | `classroom-quiz` | 答题、抢答、投票与签到 | classroom | 发布题目、抢答、投票、签到 |
| Online education | `education-device` | 设备在线与远程指令 | device | 设备上线、绑定、下发控制指令 |
| Enterprise and vertical | `enterprise-collaboration` | 单聊、群聊与组织消息 | chat | 单聊、群发通知、更新传输状态 |
| Enterprise and vertical | `field-operations` | 设备状态、告警与调度 | operations | 上报告警、指派任务、确认处理 |
| Enterprise and vertical | `video-meeting` | 入会、举手、共享与会控 | meeting | 邀请、入会、举手、共享、结束会议 |
| IoT and smart hardware | `device-telemetry` | 在线状态与遥测上报 | device | 上线、上报电量、温度和位置 |
| IoT and smart hardware | `device-control` | 远程指令、任务与配置下发 | device | 开关、移动、配置下发、执行 ACK |
| IoT and smart hardware | `security-alerts` | 告警事件实时推送 | operations | 触发告警、通知多端、确认处置 |
| Content and live streaming | `live-chat-gifts` | 弹幕、公屏与礼物 | room | 发弹幕、点赞、送礼、聚合展示 |
| Content and live streaming | `live-operations` | 开播、进出房与主播状态 | room | 开播、进房、设为忙碌、关播 |
| Content and live streaming | `live-guests` | 连麦、上下麦与嘉宾控制 | room | 邀请嘉宾、接受、上麦、收回发言权 |
| Healthcare | `telemedicine-call` | 在线问诊呼叫与通话状态 | call | 邀请、振铃、接听、挂断 |
| Mobility and local services | `dispatch-order` | 派单与订单状态 | order | 派单、接单、开始服务、完成订单 |
| Mobility and local services | `driver-rider-messaging` | 司机、骑手与乘客通信 | call | 隐私呼叫、发消息、联系客服 |
| Gaming | `gaming-voice-social` | 游戏语音房与聊天 | room | 入房、好友上线、上麦、聊天 |

The catalog stores labels, roles, entities, actions, initial state, event copy, capability mappings, and the canvas type. It does not contain component implementations.

## 4. Information Architecture

### 4.1 Routes

- `/` redirects to `/scenarios/social-presence`.
- `/scenarios/:scenarioId` renders one catalog scenario.
- Unknown scenario IDs render a clear not-found state with a return action.

### 4.2 Application shell

The desktop layout has three working regions:

1. A left navigation grouped by industry.
2. A central scenario canvas showing the current business state.
3. A right rail containing actions and a chronological event timeline.

The top bar contains the scenario title, current role, runtime mode, connection state, and a connection settings button. On narrow screens, navigation becomes a drawer and the action/timeline rail moves below the canvas. No controls overlap or depend on viewport-scaled type.

### 4.3 Scenario page anatomy

Every scenario page contains:

- A compact context header with the business goal.
- A role selector with two or more relevant roles.
- A canvas selected from the scenario's canvas type.
- Three to six business actions with disabled, pending, success, and failure states where applicable.
- A stable state summary for the visible entities.
- An event timeline with local action, send, receive, ACK, state change, connection, and error categories.
- An "RTM 如何实现" drawer containing concise action-to-capability mappings.

The UI is a restrained operational tool rather than a marketing landing page. Cards are limited to repeated entities and genuinely framed tools. Industry color accents aid navigation but do not dominate the interface.

## 5. Component Boundaries

### 5.1 Catalog and routing

- `scenarioCatalog` is the single source of truth for group and route metadata.
- `ScenarioRoute` validates the route slug and obtains its scenario definition.
- `ScenarioNavigation` renders the grouped list without knowing scenario behavior.

### 5.2 Workbench

- `SceneWorkbench` composes the role selector, canvas, action panel, timeline, and capability drawer.
- Canvas components render typed view data and emit action IDs. They do not mutate state or call RTM.
- `ActionPanel` renders actions from the scenario definition and reports the selected action to the runtime.
- `EventTimeline` displays normalized runtime events in timestamp order.

### 5.3 Runtime boundary

Both runtime implementations expose the same conceptual operations:

- Start and stop a scenario session.
- Execute a declared business action.
- Subscribe to normalized events and state updates.
- Return the latest scenario snapshot.
- Report connection and operation errors.

`SimulationRuntime` applies deterministic local state transitions. `AgoraRtmRuntime` delegates transport operations to an RTM adapter and converts SDK callbacks into the same normalized events and snapshots. Only the two selected real scenarios can instantiate `AgoraRtmRuntime`; all others keep the real-mode control disabled with a concise availability label.

### 5.4 RTM adapter

The adapter is the only module that imports `agora-rtm`. It owns:

- RTM client creation and login/logout.
- Message Channel subscription and publication.
- User-targeted publication for device commands and ACKs.
- Presence queries and change events.
- Channel Storage reads and writes.
- Lock acquisition, release, and conflict errors.
- Connection state and SDK error normalization.

UI components and scenario reducers depend on the adapter contract, not SDK objects or event payloads.

## 6. Normalized Message Protocol

Simulation and real modes use the same message envelope:

```json
{
  "schemaVersion": 1,
  "messageId": "uuid",
  "sceneId": "voice-room-seats",
  "type": "mic.request",
  "senderId": "audience-1",
  "targetId": "host-1",
  "channelId": "voice-room-001",
  "sentAt": 0,
  "requiresAck": true,
  "payload": {}
}
```

Requirements:

- `messageId` is unique per action and correlates ACKs.
- `type` is namespaced by business domain, such as `mic.request` or `device.command`.
- `targetId` is omitted for broadcast events.
- Receivers ignore envelopes with an unsupported `schemaVersion` and record an error event.
- Receivers deduplicate previously processed `messageId` values for the lifetime of the page session.
- ACK payloads reference the original `messageId` and use `RECEIVED` or `EXECUTED` status.

## 7. Simulation Behavior

The simulation runtime is deterministic and does not use artificial random failures. Actions cause explicit state transitions and append events to the timeline. Role switching changes the perspective without resetting shared scenario state.

Representative flows include:

- Call: idle -> ringing -> connected or rejected -> ended.
- Order: pending -> offered -> accepted -> in service -> completed.
- Classroom stage: listening -> hand raised -> invited -> speaking -> seated.
- Alert: healthy -> alerting -> acknowledged -> resolved.
- Chat: composed -> sent -> delivered -> read.

Reset restores the scenario's declared initial state and clears its timeline after confirmation within the reset control. It does not alter connection credentials.

## 8. Real RTM Scenario: Voice Room Seats

### 8.1 Roles and setup

Two browser windows use the same App ID and channel ID but distinct User IDs and matching temporary Tokens. One selects the host role and the other selects the audience role.

### 8.2 Transport and state mapping

- Message Channel carries hand raise, approval, rejection, mute, and leave-seat events.
- Presence supplies the currently connected room members.
- Channel Storage stores the latest seat snapshot and its revision.
- A named Lock per seat protects seat assignment from concurrent acquisition.

### 8.3 Flow

1. Both users log in and subscribe to the room Message Channel.
2. The audience sends `mic.request` with a unique `messageId`.
3. The host sends `mic.accept` or `mic.reject` referencing the request.
4. On acceptance, the seat mutation path obtains the seat Lock, reads the current Storage snapshot, applies the next revision, writes Storage, publishes the state-change event, and releases the Lock.
5. Both windows render the Storage-backed seat state. The page labels the media indicator as simulated because no RTC stream is connected.
6. A late join or restored connection reads Presence and Storage before accepting new actions.

Lock acquisition failure produces a visible conflict event and refreshes the Storage snapshot. It does not overwrite the existing seat holder.

## 9. Real RTM Scenario: IoT Device Control

### 9.1 Roles and setup

Two browser windows use distinct User IDs. One selects controller and the other selects device. The controller enters the target device User ID.

### 9.2 Flow

1. Both users log in; the controller checks device presence before enabling commands.
2. The controller sends a targeted `device.command` envelope with `requiresAck: true`.
3. The device records the command once, immediately returns a `device.ack` with `RECEIVED`, applies the command to its local device state, and returns `EXECUTED` with the resulting state.
4. The controller correlates both ACKs by the original `messageId` and updates the command row.
5. If `EXECUTED` is not received within the configured prototype timeout, the row becomes timed out and offers an explicit retry action. Retrying creates a new envelope while retaining the original command reference.

The prototype does not claim durable device state. Reloading either page resets its local device model.

## 10. Credentials and Security

The connection dialog accepts App ID, User ID, temporary Token, and the scenario-specific channel or target identifier. Values are saved only to `sessionStorage` for the current browser tab.

The UI never asks for or stores an App Certificate. Source code contains no real App ID, Token, certificate, or fallback credential. Documentation states that Tokens must be generated by a trusted service for production use.

## 11. Connection Recovery and Errors

The runtime normalizes these conditions into Chinese, actionable UI states:

- Missing connection fields.
- Invalid or expired Token.
- Login, subscription, publish, Presence, Storage, or Lock failure.
- Duplicate User ID login.
- Network interruption and restored connection.
- Unsupported message schema.
- Duplicate message ignored.
- ACK timeout.
- Seat Lock conflict.

During interruption, the last snapshot remains visible and mutating actions are disabled. After recovery, real scenarios resubscribe as required, reload Presence and the authoritative scene snapshot, and then re-enable actions. The event timeline records the interruption and recovery.

## 12. Testing and Acceptance

### 12.1 Unit tests

- The catalog contains exactly 24 unique slugs across 8 groups.
- Every scenario has roles, initial state, three to six actions, a valid canvas type, and capability mappings.
- Message parsing validates required fields and schema version.
- Deduplication ignores a repeated `messageId`.
- Simulation reducers implement each declared state transition.
- ACK tracking distinguishes received, executed, and timed-out commands.
- SDK errors map to stable Chinese error records.

### 12.2 Component tests

- Navigation opens the selected scenario route.
- Role switching preserves shared scenario state.
- Actions update the canvas and timeline.
- Reset restores the declared initial state.
- Only the two selected scenarios enable real mode.
- Connection settings are scoped to `sessionStorage`.

### 12.3 RTM contract tests

A deterministic in-memory test adapter verifies the application-side call order for login, event registration, subscription, publish, Presence, Storage, Lock, and logout. Automated tests do not require live credentials or network access.

### 12.4 Headless end-to-end tests

Playwright runs headlessly and:

- Visits all 24 routes.
- Executes at least one primary action per route.
- Confirms no uncaught page or console error.
- Checks desktop and mobile navigation behavior.
- Captures representative desktop and mobile screenshots for visual inspection.

### 12.5 Manual real-RTM smoke test

With valid per-user Tokens:

- Two voice-room windows complete request, approval, seat synchronization, mute, and leave-seat flows.
- Two IoT windows complete presence discovery, command delivery, RECEIVED ACK, EXECUTED ACK, and resulting state display.
- Refresh or reconnect restores voice-room Presence and seat Storage state.

## 13. Completion Criteria

The first release is complete when:

- All 24 scenario routes are navigable and interactive.
- The eight canvas families are visually distinguishable and responsive.
- Voice room seats and device control can switch between simulation and real RTM mode.
- No secret material is bundled or persisted beyond the tab session.
- Unit and component tests pass.
- Headless Playwright coverage passes on desktop and mobile viewports.
- The production build succeeds without TypeScript errors.
- The local development server is running and its URL is provided for review.
