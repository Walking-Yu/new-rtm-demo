/**
 * 语聊房 · 听众端 RTM 单文件。**这个文件是可以整份拷进你自己项目的。**
 *
 * ## 拷走前要知道的三件事
 *
 * 1. **零 runtime 依赖。** 本文件只 import 两类东西：RTM SDK 本身，以及纯类型
 *    （`import type`，编译后消失）。没有任何共享工具模块、没有 import 同目录的
 *    转移函数 —— 业务规则经构造参数 `stateAdapter` 注入。
 *    这条是硬约束：**任何运行时的相对 import 都是 bug。**
 * 2. **本文件只写「调用顺序」，不写「业务规则」。** 「上麦要先抢锁、再读快照、
 *    再写回、再释放锁」属于调用顺序，写在这里；「joining 才能转 active」属于业务
 *    规则，全部在注入的 `stateAdapter.reduce` 里。
 * 3. **`createClient` 参数只为可测性存在。** 默认值就是真实的 SDK 构造函数，
 *    你拷走后不需要关心它。
 *
 * ## 与房主端文件的关系：**刻意重复，不要抽共享基类**
 *
 * 本文件与 `rtm-host.ts` 有约 250 行重复：连接与分阶段回滚、订阅、消息信封、
 * 去重、`mutate()`、trace 采集、重连重新拉取。**这是有意的设计，不是疏漏。**
 *
 * 理由：客户拷**一个**文件就能跑，比拷两个互相引用的文件有价值。抽出共享基类会
 * 让「可拷走」退化成「要拷一整个目录」，直接摧毁本设计的核心卖点。
 * 代价是维护时连接与订阅那段要改两处 —— 用「文件骨架模板 + 编写规程」控制，
 * 不用抽象控制。
 *
 * ## 听众端与房主端的四处真实差异
 *
 * 除了语义方法清单不同，机制上只有四处不一样：
 *
 * | 差异 | 听众端的做法 |
 * | --- | --- |
 * | 初始快照 | **不写。** 房间状态由房主创建；听众只读，读不到就等 Storage 事件 |
 * | 治理命令 | **收，不发。** 收到强制静音 / 强制下麦 / 踢出 / 封禁后**回 ack** |
 * | 自己的静音与下麦 | **不需要 ack** —— 对自己的操作，没有对端要确认 |
 * | 封禁检查 | 连接时若发现自己在封禁名单里，直接失败退出 |
 *
 * 所以本文件**没有** `ackTimers`（那是发命令方才需要的），而多了 `sendExecutedAck()`。
 *
 * ## 与 RTC 的分工
 *
 * 本文件**完全不碰 RTC**。麦位激活由媒体结果驱动，所以顺序是：
 * 房主同意申请 → 听众收到 `seat.approved`（麦位此时是 `joining`）→ 容器发布麦克风
 * → 成功则调 `activateOwnSeat()`，失败则调 `rollbackOwnSeat()`。
 *
 * 收到强制麦控命令时同理：容器先做 RTC 动作，再调对应的语义方法写 Storage 并回 ack。
 * 本文件通过 `handlers.command` 把命令交给容器，自己不假设 RTC 的存在。
 */

import AgoraRTM from 'agora-rtm';
import type { RTMConfig, RTMEvents } from 'agora-rtm';

import type { SeatRequest, VoiceRoomSnapshot } from './state';
import type { VoiceRoomStateAdapter } from './stateAdapter';

// ---------------------------------------------------------------------------
// 常量。全部是模块级，拷走后可自行调整。
// ---------------------------------------------------------------------------

/** channel metadata 的单一 key。房间权威状态就存这一个键。 */
const SNAPSHOT_KEY = 'voice-room-state';
/** 房间级互斥锁名。所有快照变更都要先拿到它。 */
const MUTATION_LOCK = 'room-state';
/** 消息默认存活时间。过期消息在接收端一律丢弃。 */
const MESSAGE_TTL_MS = 15_000;
/** 去重表上限，超出丢最旧。 */
const DEDUPE_LIMIT = 500;
/** trace 环形上限，超出静默丢最旧 —— 不插入任何「已截断」标记条目。 */
const TRACE_LIMIT = 500;
/** 协议版本号。收到不同版本的消息一律丢弃。 */
const SCHEMA_VERSION = 1;
/** 本文件固定的角色。trace 与 uid 前缀都用它。 */
const ROLE = 'audience';

/** 锁不存在。需要先 `setLock` 创建再重新获取。 */
const LOCK_NOT_EXIST = -14008;
/** 锁已存在。对端抢先创建导致的竞态，容忍即可。 */
const LOCK_ALREADY_EXIST = -14004;

/**
 * 静默吞掉一切写入的 Proxy handler，用于 trace 只读快照。
 *
 * 三个陷阱都返回 `true`（「已处理」）而不是 `false` —— 返回 `false` 会让严格模式
 * 下的赋值抛 `TypeError`，而这里要的是「改写无效」，不是「改写报错」。
 */
const IGNORE_WRITES: ProxyHandler<never> = {
  set: () => true,
  deleteProperty: () => true,
  defineProperty: () => true,
};

// ---------------------------------------------------------------------------
// SDK 边界的结构化类型。
//
// 刻意不写 `InstanceType<typeof AgoraRTM.RTM>`：那会把整个 SDK 类形状拖进签名，
// 测试就没法只实现被用到的部分。这里只声明本文件真正调用的方法。
// ---------------------------------------------------------------------------

interface OnlineUsersPage {
  occupants: Array<{ userId: string }>;
  nextPage: string;
}

interface ChannelMetadataResult {
  majorRevision: number;
  metadata: Record<string, { value: string }>;
}

export interface RtmClientLike {
  addEventListener<EventName extends keyof RTMEvents.RTMClientEventMap>(
    eventName: EventName,
    listener: RTMEvents.RTMClientEventMap[EventName],
  ): void;
  login(options?: { token?: string }): Promise<unknown>;
  logout(): Promise<unknown>;
  subscribe(
    channelName: string,
    options?: {
      withMessage?: boolean;
      withPresence?: boolean;
      withMetadata?: boolean;
      withLock?: boolean;
    },
  ): Promise<unknown>;
  unsubscribe(channelName: string): Promise<unknown>;
  publish(
    channelName: string,
    message: string,
    options?: { channelType?: 'MESSAGE' | 'USER' },
  ): Promise<unknown>;
  presence: {
    getOnlineUsers(
      channelName: string,
      channelType: 'MESSAGE',
      options?: { includedUserId?: boolean; includedState?: boolean; page?: string },
    ): Promise<OnlineUsersPage>;
  };
  storage: {
    getChannelMetadata(channelName: string, channelType: 'MESSAGE'): Promise<ChannelMetadataResult>;
    setChannelMetadata(
      channelName: string,
      channelType: 'MESSAGE',
      data: Array<{ key: string; value: string; revision?: number }>,
      options?: {
        majorRevision?: number;
        lockName?: string;
        addTimeStamp?: boolean;
        addUserId?: boolean;
      },
    ): Promise<unknown>;
  };
  lock: {
    setLock(channelName: string, channelType: 'MESSAGE', lockName: string): Promise<unknown>;
    acquireLock(
      channelName: string,
      channelType: 'MESSAGE',
      lockName: string,
      options?: { retry?: boolean },
    ): Promise<unknown>;
    releaseLock(channelName: string, channelType: 'MESSAGE', lockName: string): Promise<unknown>;
  };
}

/** 默认值是真实 SDK 构造函数；测试传假实现。 */
export type RtmClientFactory = (appId: string, userId: string, config: RTMConfig) => RtmClientLike;

const defaultClientFactory: RtmClientFactory = (appId, userId, config) =>
  new AgoraRTM.RTM(appId, userId, config) as unknown as RtmClientLike;

// ---------------------------------------------------------------------------
// 对外类型
// ---------------------------------------------------------------------------

/** 与 RTM 的 linkState 对齐后的链路状态。 */
export type VoiceRoomLinkState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed';

export type TraceKind = 'api' | 'event';

export interface TraceEntry {
  /** 实例内单调递增序号。归并时作同毫秒的稳定次序。 */
  seq: number;
  /** 时间戳，归并主排序键。 */
  at: number;
  kind: TraceKind;
  /** 由实例自己贴 —— 归并后来源不能丢。 */
  uid: string;
  role: string;
  /** API 方法名或事件名。 */
  name: string;
  /** 短摘要，不放完整对象。 */
  summary?: string;
  /** 仅 api 条目。 */
  durationMs?: number;
  /** 仅 api 条目，失败时才有。 */
  errorCode?: number;
  errorMessage?: string;
}

export interface InteractionEvent {
  id: string;
  type: 'chat' | 'emoji' | 'gift';
  senderId: string;
  displayName: string;
  value: string;
  timestamp: number;
}

/**
 * 房主发来的、需要本端配合 RTC 动作的命令。
 *
 * 本文件不碰 RTC，所以把命令交给容器：容器做完 RTC 动作后调对应的语义方法
 * （`applyForcedMute` / `applyForcedLeave`），语义方法内部写 Storage 并回 ack。
 */
export type IncomingCommand =
  | { type: 'seat.mute'; muted: boolean; commandId: string; from: string }
  | { type: 'seat.leave'; commandId: string; from: string }
  | { type: 'seat.approved'; seatId: string; from: string }
  | { type: 'seat.invited'; seatId: string; invitationId: string; from: string };

export interface VoiceRoomAudienceHandlers {
  /** 链路状态变化。只用 linkState，不用已废弃的旧状态事件。 */
  linkState(state: VoiceRoomLinkState, reason?: string): void;
  /** 房间快照更新。 */
  snapshot(snapshot: VoiceRoomSnapshot): void;
  /** 互动事件：公屏消息、表情、礼物。 */
  interaction(event: InteractionEvent): void;
  /** 在线用户列表变化。 */
  presence(userIds: readonly string[]): void;
  /** 需要本端配合 RTC 动作的命令。 */
  command(command: IncomingCommand): void;
  /** 被踢出或被封禁 —— 容器据此断开连接并展示原因。 */
  exit(reason: 'kicked' | 'banned'): void;
  /** 错误。 */
  error(message: string): void;
}

export interface VoiceRoomAudienceOptions {
  appId: string;
  roomId: string;
  userId: string;
  displayName: string;
  /**
   * 可选 token。默认体验用 appId 不开鉴权 —— 参数位保留，本项目不含 token 生成器。
   */
  token?: string;
  /** 注入的状态适配器。本文件不知道任何业务规则。 */
  stateAdapter: VoiceRoomStateAdapter;
  handlers: VoiceRoomAudienceHandlers;
  /** 唯一为可测性开的口子。默认是真实 SDK。 */
  createClient?: RtmClientFactory;
  /** 时钟。默认 `Date.now`，注入便于断言耗时与过期。 */
  now?: () => number;
}

// ---------------------------------------------------------------------------
// 消息信封。内联在此，因为「怎么用 RTM 发一条可校验的消息」正是要拷走的机制。
// ---------------------------------------------------------------------------

interface Envelope {
  schemaVersion: number;
  messageId: string;
  type: string;
  roomId: string;
  senderId: string;
  targetId?: string;
  sentAt: number;
  expiresAt: number;
  requiresAck: boolean;
  payload: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function newMessageId(): string {
  // `crypto.randomUUID` 在浏览器与 Node 18+ 均可用；退化路径只为极老环境兜底。
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// 听众端客户端
// ---------------------------------------------------------------------------

export class VoiceRoomAudienceClient {
  private readonly options: VoiceRoomAudienceOptions;
  private readonly adapter: VoiceRoomStateAdapter;
  private readonly handlers: VoiceRoomAudienceHandlers;
  private readonly createClient: RtmClientFactory;
  private readonly now: () => number;

  private client: RtmClientLike | undefined;
  private snapshot: VoiceRoomSnapshot;
  private onlineUsers: readonly string[] = [];
  private linkState: VoiceRoomLinkState = 'disconnected';
  private connected = false;
  private wasReconnecting = false;

  /** 去重表。插入序即最旧序，超限从头丢。 */
  private readonly seenMessageIds = new Set<string>();

  // --- 内联的 trace store（不 import 共享实现，这是零依赖的代价）---
  private readonly traces: TraceEntry[] = [];
  private readonly traceListeners = new Set<() => void>();
  private traceSeq = 0;
  private traceSnapshot: readonly TraceEntry[] | undefined;

  constructor(options: VoiceRoomAudienceOptions) {
    this.options = options;
    this.adapter = options.stateAdapter;
    this.handlers = options.handlers;
    this.createClient = options.createClient ?? defaultClientFactory;
    this.now = options.now ?? (() => Date.now());
    // 本端不是房主，所以这只是个占位起点 —— 真实状态从 Storage 读回。
    this.snapshot = this.adapter.createInitial('', '');
  }

  // === 读取接口 ============================================================

  getSnapshot(): VoiceRoomSnapshot {
    return this.snapshot;
  }

  getOnlineUsers(): readonly string[] {
    return this.onlineUsers;
  }

  getLinkState(): VoiceRoomLinkState {
    return this.linkState;
  }

  /**
   * trace 只读快照。
   *
   * 两个约束要同时满足，少任何一个都会出问题：
   * 1. **未变时返回同一引用** —— 外部 store 订阅钩子的硬要求，每次新建数组会让它
   *    判定「变了」而无限重渲染。所以缓存，写入时经 `notifyTraces()` 置空。
   * 2. **调用方改写返回值不影响内部状态** —— 元素逐个复制还不够，复制出来的对象
   *    仍可被原地改写并污染这份缓存。所以每条再包一层 Proxy 静默吞掉写入。
   *
   * 用 Proxy 而不是 `Object.freeze`：冻结在严格模式下会让调用方的赋值**抛错**，
   * 而这里要的语义是「改写无效」，不是「改写报错」。
   */
  getTraces(): readonly TraceEntry[] {
    this.traceSnapshot ??= new Proxy(
      this.traces.map((entry) => new Proxy({ ...entry }, IGNORE_WRITES)),
      IGNORE_WRITES,
    );
    return this.traceSnapshot;
  }

  /** 返回退订函数。 */
  subscribeTraces(listener: () => void): () => void {
    this.traceListeners.add(listener);
    return () => this.traceListeners.delete(listener);
  }

  clearTraces(): void {
    this.traces.length = 0;
    this.notifyTraces();
  }

  // === 连接 ================================================================

  /**
   * 连接房间。顺序与房主端一致（这是刻意的重复）：
   *
   * 1. 创建客户端
   * 2. **注册事件（必须在 login 之前，否则会漏掉早期事件）**
   * 3. login
   * 4. subscribe（message / presence / metadata / lock 四类一起订）
   * 5. 拉 Presence 与 Storage
   *
   * 与房主端的差异：**读不到房间状态时不写初始快照** —— 房间由房主创建，听众只读。
   * 另外会检查自己是否在封禁名单里。
   *
   * 任一步失败都逆序清理已完成的步骤，并**保留最初的失败原因**。
   */
  async connect(): Promise<void> {
    if (this.connected) return;
    const { appId, roomId, userId, token } = this.options;

    let loggedIn = false;
    let subscribed = false;

    this.setLinkState('connecting');
    const client = this.createClient(appId, userId, { logLevel: 'debug', useStringUserId: true });
    this.client = client;
    // 事件注册必须先于 login —— SDK 的事件是全局的，晚注册就会漏。
    this.attachListeners(client);

    try {
      await this.track('rtm.login', userId, () => client.login({ token }));
      loggedIn = true;
      this.setLinkState('connected');

      await this.track('rtm.subscribe', roomId, () =>
        client.subscribe(roomId, {
          withMessage: true,
          withPresence: true,
          withMetadata: true,
          withLock: true,
        }),
      );
      subscribed = true;

      this.onlineUsers = await this.fetchOnlineUsers();
      this.handlers.presence(this.onlineUsers);

      const snapshot = await this.readRoomState();
      // 读不到就保持占位快照，等房主写入后的 Storage 事件补上 —— **不写初始快照**。
      if (snapshot) {
        if (snapshot.bannedUserIds.includes(userId)) throw new Error('该用户已被房间封禁');
        this.applySnapshot(snapshot);
      }

      this.connected = true;
    } catch (error) {
      await this.rollbackConnect({ loggedIn, subscribed });
      this.client = undefined;
      this.setLinkState('failed');
      // 抛出最初的失败原因 —— 清理过程中的异常在 rollbackConnect 里被吞掉了。
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    const client = this.client;
    this.connected = false;
    this.client = undefined;
    if (!client) {
      this.setLinkState('disconnected');
      return;
    }
    try {
      await this.track('rtm.unsubscribe', this.options.roomId, () =>
        client.unsubscribe(this.options.roomId),
      );
    } finally {
      await this.track('rtm.logout', this.options.userId, () => client.logout());
      this.setLinkState('disconnected');
    }
  }

  /**
   * 逆序清理，**每一步的异常都吞掉**。
   *
   * 吞掉不是偷懒：清理失败是次要信息，让它冒泡会顶掉最初那个真正有诊断价值的
   * 失败原因。这条最容易在重构时写丢。
   */
  private async rollbackConnect(stages: { loggedIn: boolean; subscribed: boolean }): Promise<void> {
    const client = this.client;
    if (!client) return;
    if (stages.subscribed) {
      try {
        await client.unsubscribe(this.options.roomId);
      } catch {
        // 保留最初的失败原因。
      }
    }
    if (stages.loggedIn) {
      try {
        await client.logout();
      } catch {
        // 同上。
      }
    }
  }

  // === 听众的业务动作 ======================================================

  /** 申请上麦。写排麦队列后点对点通知房主。 */
  async requestSeat(seatId: string): Promise<void> {
    const request: SeatRequest = {
      id: newMessageId(),
      userId: this.options.userId,
      displayName: this.options.displayName,
      seatId,
      createdAt: this.now(),
    };
    const next = await this.mutate({ type: 'seat.request', request });
    await this.publishToUser(next.hostUserId, 'seat.request', false, {
      requestId: request.id,
      seatId,
    });
  }

  /** 取消上麦申请。 */
  async cancelSeatRequest(): Promise<void> {
    const next = await this.mutate({ type: 'seat.request.cancel', userId: this.options.userId });
    await this.publishToUser(next.hostUserId, 'seat.request.cancelled', false, {});
  }

  /**
   * 接受房主的上麦邀请。麦位先进 `joining`。
   *
   * 与房主同意申请后的路径一致：容器随后发布麦克风，成功调 `activateOwnSeat()`，
   * 失败调 `rollbackOwnSeat()`。**这个顺序不能改。**
   */
  async acceptInvitation(): Promise<void> {
    await this.mutate({ type: 'seat.invite.accept', userId: this.options.userId });
  }

  /** 拒绝房主的上麦邀请。 */
  async rejectInvitation(): Promise<void> {
    const invitation = this.snapshot.invitation;
    const hostUserId = invitation?.hostUserId ?? this.snapshot.hostUserId;
    const invitationId = invitation?.id ?? '';
    await this.mutate({ type: 'seat.invite.reject', userId: this.options.userId });
    await this.publishToUser(hostUserId, 'seat.invitation.rejected', false, { invitationId });
  }

  /**
   * 给自己静音 / 取消静音。**对自己、不需要 ack。**
   *
   * 与房主端的「强制静音」是两个语义不同的方法 —— 房主那边是对他人、需要 ack。
   * 不要用「目标 uid 是否为空」这种隐式分支把它们合成一个。
   *
   * 容器先做 RTC 的 `setMicrophoneMuted()`，成功后调本方法写 Storage。
   */
  async setOwnMuted(muted: boolean): Promise<void> {
    await this.mutate({ type: 'seat.mute', userId: this.options.userId, muted });
    await this.publishToChannel('seat.mute.changed', false, { muted });
  }

  /** 主动下麦。**对自己、不需要 ack。** */
  async leaveOwnSeat(): Promise<void> {
    await this.mutate({ type: 'seat.leave', userId: this.options.userId });
    await this.publishToChannel('seat.left', false, {});
  }

  /**
   * 执行房主的强制静音命令，**并回 ack**。
   *
   * 容器先做 RTC 动作，再调本方法。这是房主端 ack 机制的对端 —— 两边要配上，
   * 否则房主那边一定超时。
   */
  async applyForcedMute(muted: boolean, commandId: string, hostUserId: string): Promise<void> {
    await this.mutate({ type: 'seat.mute', userId: this.options.userId, muted });
    await this.sendExecutedAck(commandId, hostUserId);
  }

  /** 执行房主的强制下麦命令，**并回 ack**。 */
  async applyForcedLeave(commandId: string, hostUserId: string): Promise<void> {
    await this.mutate({ type: 'seat.leave', userId: this.options.userId });
    await this.sendExecutedAck(commandId, hostUserId);
  }

  async sendChatMessage(text: string): Promise<void> {
    await this.broadcastInteraction('chat.message', 'chat', text);
  }

  async sendEmoji(emoji: string): Promise<void> {
    await this.broadcastInteraction('emoji.reaction', 'emoji', emoji);
  }

  async sendGift(giftId: string): Promise<void> {
    await this.broadcastInteraction('gift.sent', 'gift', giftId);
  }

  /**
   * 媒体发布成功后把自己的麦位转 `active`。
   *
   * 本文件不碰 RTC，所以这一步由容器在 `publishMicrophone()` 成功后调用。
   * 这是唯一一处 RTC 结果反向驱动 RTM 写入的地方。
   */
  async activateOwnSeat(seatId: string): Promise<void> {
    const next = await this.mutate({ type: 'seat.activate', seatId, userId: this.options.userId });
    await this.publishToChannel('seat.media-ready', false, { seatId });
    void next;
  }

  /** 媒体发布失败时回滚自己的麦位。 */
  async rollbackOwnSeat(seatId: string): Promise<void> {
    await this.mutate({ type: 'seat.rollback', seatId, userId: this.options.userId });
  }

  // === Storage + Lock：房间权威状态的唯一变更通道 ==========================

  /**
   * 变更房间快照。**禁止在本方法之外改快照。**
   *
   * 完整顺序：获取锁 → 重新读快照（不用本地缓存，本地可能已过期）→ 过 reducer
   * → 带 `majorRevision` 写入（乐观并发）→ **在 finally 中释放锁**。
   *
   * reducer 抛异常（越权、状态非法）时锁依然会被释放 —— 否则一次业务错误就会
   * 把房间锁死。
   */
  private async mutate(
    action: Parameters<VoiceRoomStateAdapter['reduce']>[1],
  ): Promise<VoiceRoomSnapshot> {
    const client = this.requireClient();
    const { roomId } = this.options;
    let acquired = false;
    try {
      await this.acquireRoomLock(client);
      acquired = true;

      const stored = await this.track('storage.getChannelMetadata', SNAPSHOT_KEY, () =>
        client.storage.getChannelMetadata(roomId, 'MESSAGE'),
      );
      const current =
        this.adapter.parseStored(stored.metadata[SNAPSHOT_KEY]?.value) ?? this.snapshot;

      const next = this.adapter.reduce(current, action);

      await this.track('storage.setChannelMetadata', `revision=${next.revision}`, () =>
        client.storage.setChannelMetadata(
          roomId,
          'MESSAGE',
          [{ key: SNAPSHOT_KEY, value: JSON.stringify(next), revision: -1 }],
          {
            majorRevision: stored.majorRevision,
            lockName: MUTATION_LOCK,
            addTimeStamp: true,
            addUserId: true,
          },
        ),
      );

      this.applySnapshot(next);
      return next;
    } finally {
      if (acquired) {
        await this.track('lock.releaseLock', MUTATION_LOCK, () =>
          client.lock.releaseLock(roomId, 'MESSAGE', MUTATION_LOCK),
        );
      }
    }
  }

  /**
   * 获取房间锁。**锁必须先创建才能获取** —— 这是实测踩出来的路径。
   *
   * 遇到 `LOCK_NOT_EXIST`（-14008）先 `setLock` 创建再重新获取；创建时遇到
   * `LOCK_ALREADY_EXIST`（-14004）说明对端抢先建好了，忽略即可继续获取。
   * **改动锁相关代码时必须保留这两条路径。**
   */
  private async acquireRoomLock(client: RtmClientLike): Promise<void> {
    const { roomId } = this.options;
    await this.track('lock.acquireLock', MUTATION_LOCK, async () => {
      try {
        await client.lock.acquireLock(roomId, 'MESSAGE', MUTATION_LOCK, { retry: false });
        return;
      } catch (error) {
        if (!matchesSdkError(error, LOCK_NOT_EXIST, 'LOCK_NOT_EXIST')) throw error;
      }
      try {
        await client.lock.setLock(roomId, 'MESSAGE', MUTATION_LOCK);
      } catch (error) {
        // 对端抢先创建 —— 竞态，不是错误。
        if (!matchesSdkError(error, LOCK_ALREADY_EXIST, 'LOCK_ALREADY_EXIST')) throw error;
      }
      await client.lock.acquireLock(roomId, 'MESSAGE', MUTATION_LOCK, { retry: false });
    });
  }

  /**
   * 只读房间状态，**不写初始快照**。
   *
   * 这是与房主端 `ensureRoomState()` 的关键差异：房间由房主创建，听众读不到就
   * 等 Storage 事件。让听众也写初始快照会造成两端各写一份、revision 打架。
   * 因为不写，也就不需要抢锁 —— 纯读不用互斥。
   */
  private async readRoomState(): Promise<VoiceRoomSnapshot | undefined> {
    const client = this.requireClient();
    const stored = await this.track('storage.getChannelMetadata', SNAPSHOT_KEY, () =>
      client.storage.getChannelMetadata(this.options.roomId, 'MESSAGE'),
    );
    return this.adapter.parseStored(stored.metadata[SNAPSHOT_KEY]?.value);
  }

  // === 消息发布 ============================================================

  private createEnvelope(
    type: string,
    requiresAck: boolean,
    payload: Record<string, unknown>,
    targetId?: string,
  ): Envelope {
    const sentAt = this.now();
    return {
      schemaVersion: SCHEMA_VERSION,
      messageId: newMessageId(),
      type,
      roomId: this.options.roomId,
      senderId: this.options.userId,
      targetId,
      sentAt,
      expiresAt: sentAt + MESSAGE_TTL_MS,
      requiresAck,
      payload,
    };
  }

  private async publishToUser(
    userId: string,
    type: string,
    requiresAck: boolean,
    payload: Record<string, unknown>,
  ): Promise<Envelope> {
    const envelope = this.createEnvelope(type, requiresAck, payload, userId);
    const client = this.requireClient();
    await this.track('rtm.publish', `user:${userId}:${type}`, () =>
      client.publish(userId, JSON.stringify(envelope), { channelType: 'USER' }),
    );
    return envelope;
  }

  private async publishToChannel(
    type: string,
    requiresAck: boolean,
    payload: Record<string, unknown>,
  ): Promise<Envelope> {
    const envelope = this.createEnvelope(type, requiresAck, payload);
    const client = this.requireClient();
    await this.track('rtm.publish', `channel:${this.options.roomId}:${type}`, () =>
      client.publish(this.options.roomId, JSON.stringify(envelope)),
    );
    return envelope;
  }

  /**
   * 回执：告诉房主「命令已执行」。
   *
   * 这是房主端 ack 机制的对端。房主发治理命令时登记了超时定时器，收到这条才清掉。
   * **两边必须配上**，否则房主那边一定超时报错。
   */
  private async sendExecutedAck(commandId: string, targetId: string): Promise<void> {
    await this.publishToUser(targetId, 'command.ack', false, { commandId, status: 'EXECUTED' });
  }

  private async broadcastInteraction(
    type: 'chat.message' | 'emoji.reaction' | 'gift.sent',
    interactionType: InteractionEvent['type'],
    rawValue: string,
  ): Promise<void> {
    const value = rawValue.trim();
    if (!value) throw new Error('互动内容不能为空');
    const envelope = await this.publishToChannel(type, false, {
      value,
      displayName: this.options.displayName,
    });
    // 自己发的也进去重表：频道消息会回显给发送者，否则本地会重复一条。
    this.acceptOnce(envelope.messageId);
    this.handlers.interaction({
      id: envelope.messageId,
      type: interactionType,
      senderId: this.options.userId,
      displayName: this.options.displayName,
      value,
      timestamp: envelope.sentAt,
    });
  }

  // === 事件接收 ============================================================

  private attachListeners(client: RtmClientLike): void {
    client.addEventListener('linkState', (event) => {
      const next = mapLinkState(event);
      this.recordEvent('linkState', `${event.previousState}→${event.currentState}`);
      this.setLinkState(next, event.reasonCode);
      if (next === 'reconnecting') this.wasReconnecting = true;
      if (next === 'connected' && this.connected && this.wasReconnecting) {
        this.wasReconnecting = false;
        void this.rehydrateAfterReconnect();
      }
    });

    client.addEventListener('message', (event) => {
      if (typeof event.message !== 'string') return;
      this.recordEvent('message', `from:${event.publisher}`);
      void this.handleMessage(event.message).catch((error) =>
        this.handlers.error(errorMessage(error)),
      );
    });

    client.addEventListener('presence', (event) => {
      this.recordEvent('presence', event.eventType);
      void this.fetchOnlineUsers()
        .then((userIds) => {
          this.onlineUsers = userIds;
          this.handlers.presence(userIds);
        })
        .catch((error) => this.handlers.error(`Presence 恢复失败：${errorMessage(error)}`));
    });

    client.addEventListener('storage', (event) => {
      this.recordEvent('storage', `revision=${event.data.majorRevision}`);
      const next = this.adapter.parseStored(event.data.metadata[SNAPSHOT_KEY]?.value);
      // 只接受不比本地旧的快照 —— 乱序到达的事件不应把状态拉回去。
      if (next && next.revision >= this.snapshot.revision) this.applySnapshot(next);
    });

    client.addEventListener('lock', (event) => {
      this.recordEvent('lock', event.eventType);
    });

    client.addEventListener('token', (event) => {
      this.recordEvent('token', event.eventType);
      // 只把 WILL_EXPIRE 当作即将过期。
      if (event.eventType === 'WILL_EXPIRE') this.handlers.error('RTM Token 即将过期');
    });
  }

  /**
   * 接收路径固定为：解析信封 → 去重判定 → 分发。
   *
   * 房间不匹配、目标不是自己、已过期、版本不符的消息一律丢弃。
   *
   * 听众端要处理的命令比房主端多 —— 治理命令是「收」的一方。
   */
  private async handleMessage(serialized: string): Promise<void> {
    const envelope = this.parseEnvelope(serialized);
    if (!envelope) return;
    if (!this.acceptOnce(envelope.messageId)) return;

    switch (envelope.type) {
      case 'seat.approved':
        // 麦位此时已是 joining（房主写的）。交给容器发布麦克风。
        this.handlers.command({
          type: 'seat.approved',
          seatId: readString(envelope.payload.seatId),
          from: envelope.senderId,
        });
        return;

      case 'seat.invited':
        this.handlers.command({
          type: 'seat.invited',
          seatId: readString(envelope.payload.seatId),
          invitationId: readString(envelope.payload.invitationId),
          from: envelope.senderId,
        });
        return;

      case 'seat.mute.command':
        // 交给容器：先做 RTC 静音，再调 applyForcedMute() 写 Storage 并回 ack。
        this.handlers.command({
          type: 'seat.mute',
          muted: envelope.payload.muted === true,
          commandId: envelope.messageId,
          from: envelope.senderId,
        });
        return;

      case 'seat.leave.command':
        this.handlers.command({
          type: 'seat.leave',
          commandId: envelope.messageId,
          from: envelope.senderId,
        });
        return;

      case 'member.kick':
      case 'member.ban':
        // 踢出与封禁：**先回 ack 再退出**。反过来的话连接已断，ack 发不出去，
        // 房主那边必然超时报错。
        await this.sendExecutedAck(envelope.messageId, envelope.senderId);
        this.handlers.exit(envelope.type === 'member.ban' ? 'banned' : 'kicked');
        return;

      case 'chat.message':
      case 'emoji.reaction':
      case 'gift.sent':
        this.handleInteraction(envelope);
        return;

      default:
        // 其余（seat.rejected / seat.mute.changed / seat.left / seat.media-ready）
        // 只是通知：权威状态由 Storage 事件同步，无需本地推断。
        return;
    }
  }

  private parseEnvelope(serialized: string): Envelope | undefined {
    let value: unknown;
    try {
      value = JSON.parse(serialized);
    } catch {
      return undefined;
    }
    if (!isRecord(value)) return undefined;
    if (value.schemaVersion !== SCHEMA_VERSION) return undefined;
    if (
      !isNonEmptyString(value.messageId) ||
      !isNonEmptyString(value.type) ||
      !isNonEmptyString(value.roomId) ||
      !isNonEmptyString(value.senderId) ||
      (value.targetId !== undefined && !isNonEmptyString(value.targetId)) ||
      typeof value.sentAt !== 'number' ||
      typeof value.expiresAt !== 'number' ||
      typeof value.requiresAck !== 'boolean' ||
      !isRecord(value.payload)
    ) {
      return undefined;
    }
    const envelope = value as unknown as Envelope;
    if (envelope.roomId !== this.options.roomId) return undefined;
    if (envelope.targetId && envelope.targetId !== this.options.userId) return undefined;
    if (this.now() > envelope.expiresAt) return undefined;
    return envelope;
  }

  /** 去重。返回 false 表示这条已处理过。 */
  private acceptOnce(messageId: string): boolean {
    if (this.seenMessageIds.has(messageId)) return false;
    while (this.seenMessageIds.size >= DEDUPE_LIMIT) {
      const oldest = this.seenMessageIds.values().next().value;
      if (oldest === undefined) break;
      this.seenMessageIds.delete(oldest);
    }
    this.seenMessageIds.add(messageId);
    return true;
  }

  private handleInteraction(envelope: Envelope): void {
    const map: Record<string, InteractionEvent['type']> = {
      'chat.message': 'chat',
      'emoji.reaction': 'emoji',
      'gift.sent': 'gift',
    };
    const type = map[envelope.type];
    const value = typeof envelope.payload.value === 'string' ? envelope.payload.value : '';
    if (!type || !value) return;
    this.handlers.interaction({
      id: envelope.messageId,
      type,
      senderId: envelope.senderId,
      displayName:
        typeof envelope.payload.displayName === 'string'
          ? envelope.payload.displayName
          : envelope.senderId,
      value,
      timestamp: envelope.sentAt,
    });
  }

  /**
   * 重连**靠重新读取，不靠重放**。
   *
   * 链路从 reconnecting 回到 connected 时：重新订阅 → 重新拉 Presence → 重新拉
   * Storage。不重放任何历史消息 —— 重放会把过期的意图重新执行一遍。
   *
   * 听众端多一步：重连后发现自己已被封禁则退出。
   */
  private async rehydrateAfterReconnect(): Promise<void> {
    const client = this.client;
    if (!client) return;
    try {
      await this.track('rtm.subscribe', this.options.roomId, () =>
        client.subscribe(this.options.roomId, {
          withMessage: true,
          withPresence: true,
          withMetadata: true,
          withLock: true,
        }),
      );
      this.onlineUsers = await this.fetchOnlineUsers();
      this.handlers.presence(this.onlineUsers);

      const next = await this.readRoomState();
      if (next) {
        this.applySnapshot(next);
        if (next.bannedUserIds.includes(this.options.userId)) {
          this.handlers.exit('banned');
        }
      }
    } catch (error) {
      this.handlers.error(`RTM 重连恢复失败：${errorMessage(error)}`);
    }
  }

  /** Presence 查询要沿 `nextPage` 翻页取全部在线用户 —— 单页拿不全。 */
  private async fetchOnlineUsers(): Promise<string[]> {
    const client = this.requireClient();
    return this.track('presence.getOnlineUsers', this.options.roomId, async () => {
      const userIds = new Set<string>();
      let page: string | undefined;
      do {
        const result = await client.presence.getOnlineUsers(this.options.roomId, 'MESSAGE', {
          includedUserId: true,
          includedState: false,
          ...(page ? { page } : {}),
        });
        result.occupants.forEach((occupant) => userIds.add(occupant.userId));
        page = result.nextPage || undefined;
      } while (page);
      return Array.from(userIds);
    });
  }

  // === 内部工具 ============================================================

  private requireClient(): RtmClientLike {
    if (!this.client) throw new Error('RTM 尚未连接');
    return this.client;
  }

  private applySnapshot(snapshot: VoiceRoomSnapshot): void {
    this.snapshot = snapshot;
    this.handlers.snapshot(snapshot);
  }

  private setLinkState(state: VoiceRoomLinkState, reason?: string): void {
    this.linkState = state;
    this.handlers.linkState(state, reason);
  }

  /**
   * 包住每一次 RTM API 调用：成功记一条带耗时的 api 节点，失败额外带错误码与
   * 错误信息。**所有对 SDK 的调用都必须经过它**，否则时间线会缺节点。
   */
  private async track<T>(
    name: string,
    summary: string | undefined,
    run: () => Promise<T>,
  ): Promise<T> {
    const at = this.now();
    try {
      const result = await run();
      this.recordTrace({ at, kind: 'api', name, summary, durationMs: this.now() - at });
      return result;
    } catch (error) {
      const code = sdkErrorCode(error);
      this.recordTrace({
        at,
        kind: 'api',
        name,
        summary,
        durationMs: this.now() - at,
        ...(code === undefined ? {} : { errorCode: code }),
        errorMessage: errorMessage(error),
      });
      throw error;
    }
  }

  private recordEvent(name: string, summary?: string): void {
    this.recordTrace({ at: this.now(), kind: 'event', name, summary });
  }

  private recordTrace(input: Omit<TraceEntry, 'seq' | 'uid' | 'role'>): void {
    this.traceSeq += 1;
    // uid 与 role 由实例自己贴 —— 归并后来源不能丢。
    this.traces.push({ ...input, seq: this.traceSeq, uid: this.options.userId, role: ROLE });
    // 超限静默丢最旧，不插入「已截断」标记。
    if (this.traces.length > TRACE_LIMIT) {
      this.traces.splice(0, this.traces.length - TRACE_LIMIT);
    }
    this.notifyTraces();
  }

  private notifyTraces(): void {
    this.traceSnapshot = undefined;
    for (const listener of this.traceListeners) listener();
  }
}

export function createVoiceRoomAudienceClient(
  options: VoiceRoomAudienceOptions,
): VoiceRoomAudienceClient {
  return new VoiceRoomAudienceClient(options);
}

// ---------------------------------------------------------------------------
// SDK 错误归一。内联在此 —— 客户拷走后同样需要认这两个锁错误码。
// ---------------------------------------------------------------------------

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function sdkErrorCode(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  const code = error.errorCode ?? error.code;
  return typeof code === 'number' ? code : undefined;
}

function matchesSdkError(error: unknown, errorCode: number, marker: string): boolean {
  if (!isRecord(error)) return false;
  if (error.errorCode === errorCode || error.code === errorCode) return true;
  return [error.code, error.name, error.message, error.reason]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toUpperCase()
    .includes(marker);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (isRecord(error)) {
    const detail = [error.reason, error.message]
      .filter((value): value is string => typeof value === 'string')
      .join(' ')
      .trim();
    if (detail) return detail;
  }
  return 'RTM 操作失败';
}

function mapLinkState(event: RTMEvents.LinkStateEvent): VoiceRoomLinkState {
  if (event.currentState === 'CONNECTED') return 'connected';
  if (event.currentState === 'FAILED') return 'failed';
  if (event.currentState === 'IDLE') return 'disconnected';
  if (event.currentState === 'DISCONNECTED' || event.currentState === 'SUSPENDED') {
    return 'reconnecting';
  }
  return event.operation === 'AUTO_RECONNECT' ? 'reconnecting' : 'connecting';
}
