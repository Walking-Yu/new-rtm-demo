# 时间线数据模型与 uid 前缀

Type: grilling
Status: resolved
Blocked by: 02

## Question

时间线面板消费的数据长什么样？

需要定：

- trace 条目的字段（时间戳、方向 api/event、RTM 方法名或事件名、uid、参数摘要、耗时、成功/失败）。
- `rtm.ts` 内部 trace 数组的导出形状：直接导出数组、还是导出一个可订阅的对象（业务层要能实时刷新 UI，纯数组需要轮询）。
- 多用户时 uid 前缀怎么来：`rtm.ts` 实例自己知道自己的 uid，还是由业务层在读取时贴上。
- 条目上限与清理策略（长时间运行的 demo 不能无限增长）。
- 一个页面内多个 `rtm.ts` 实例的 trace 如何汇聚成一条时间线。

已定前提：采集在 `rtm.ts` 内部，底层 RTM API 粒度，`rtm.ts` 零依赖不能 import 共享 trace 模块。

## Answer

### 前置修正：一个角色一份 `rtm-<role>.ts`，各自维护自己的 trace

用户确认 **RTM 支持一个页面内多个 client 实例**，只要 uid 不同。RTC 则只由「实际开音视频的那个用户」创建。

因此文件形态从「一场景一份 `rtm.ts`」修正为 **一场景一角色一份 `rtm-<role>.ts`**：语聊房是 `rtm-host.ts` + `rtm-audience.ts`。命名用**角色**，不用 uid —— uid 是运行时值，不能进文件名。

每份 `rtm-<role>.ts` 自己维护自己的 trace；**业务层负责按时间戳归并**成一条时间线。所以不存在「多实例 trace 如何汇聚」的 SDK 层问题，只有业务层的归并问题。

### ⚠️ 与官方文档冲突，需在 README 声明

官方文档的表述与「多实例」相反：

- migration guide 写明 RTM 2.x 事件回调**绑定到 client 实例、全局生效**（全局范围是该实例下所有 channel 与 topic），跨实例行为**无任何说明**。
- 来源：<https://docs.agora.io/en/realtime-media/rtm/reference/migration-guide/web>
- 对比 RTC：文档明确教 `createClient` 两次做上下行测速，且 4.6.0 release notes 修过「一个页面多个 client 导致异常」，属隐性支持。

即：多 RTM 实例是**实测可行但文档未保证**。本项目开源给客户，多实例又是核心做法，README 必须写明这一状态，否则客户照抄进生产、日后 SDK 行为变化时会误判归因。此条记入 `04`、`11`。

### trace 条目字段

```ts
type TraceKind = 'api' | 'event';

interface TraceEntry {
  /** 单实例内单调递增，归并时作为同毫秒的稳定次序 */
  seq: number;
  /** Date.now()，业务层归并的主排序键 */
  at: number;
  kind: TraceKind;
  /** 该实例的角色，如 'host' / 'audience'，UI 前缀用 */
  role: string;
  /** 该实例登录用的 uid，UI 前缀用 */
  uid: string;
  /** api: RTM 方法名，如 'setChannelMetadata'；event: 事件名，如 'presence' */
  name: string;
  /** 参数/负载摘要，短字符串，不放完整对象 */
  detail?: string;
  /** 仅 api：耗时毫秒 */
  durationMs?: number;
  /** 仅 api：失败时的错误码与信息 */
  error?: { code?: number; message: string };
}
```

`kind` 只有两个值，对应你的原始要求：调 RTM API 出一个 api 节点，收到 RTM 事件出一个 event 节点。

uid 前缀由 **`rtm-<role>.ts` 实例自己贴**（它知道自己的 role 与 uid），不由业务层在读取时补 —— 归并后来源不能丢。

### 导出形状：可订阅对象

```ts
export interface TraceStore {
  getEntries(): readonly TraceEntry[];
  subscribe(listener: () => void): () => void;
}
export const trace: TraceStore;
```

选它而非裸数组轮询的理由：时间线是本 demo 的核心展示物，「API 被调用的瞬间节点就出现」值得那约 25 行订阅样板；React 侧配 `useSyncExternalStore` 即可，无需轮询与整数组 diff。23 个场景共用同一套样板，模板化后复制成本为零。

`getEntries()` 返回 `readonly` 快照，业务层不得改写。

### 条目上限与清理

单实例环形上限 **500 条**，超出丢弃最旧的。理由：长会话（尤其高频 presence/message 场景）不能无限增长；500 条足够覆盖一次完整演示，且归并后 UI 侧仍可再截断显示。上限作为模块常量，客户拷走后可自行调整。

### 未决，留给后续票

- **`rtm-<role>.ts` 之间的重复代码**：语聊房 host 与 audience 两份文件的 RTM 调用序列大量重叠，叠加 `02` 定的「场景语义方法」后重复会很多；且文件数将按角色数膨胀（会议室主持人/参会者、课堂老师/学生/助教）。这是否是想要的形态，交给 `10` 正面处理。
- 时间线的视觉密度与交互（折叠、按 uid/role 筛选、长会话截断显示）交给 `09` 原型。
