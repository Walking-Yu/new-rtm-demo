/**
 * 语聊房 · 房主端 RTM 单文件。**这个文件是可以整份拷进你自己项目的。**
 *
 * ## 拷走前要知道的三件事
 *
 * 1. **零 runtime 依赖。** 本文件只 import 两类东西：RTM SDK 本身，以及纯类型
 *    （`import type`，编译后消失）。没有任何共享工具模块、没有 import 同目录的
 *    转移函数 —— 业务规则经构造参数 `stateAdapter` 注入。
 *    这条是硬约束：**任何运行时的相对 import 都是 bug。**
 * 2. **本文件只写「调用顺序」，不写「业务规则」。** 「上麦要先抢锁、再读快照、
 *    再写回、再释放锁」属于调用顺序，写在这里；「只有房主能同意上麦」「joining
 *    才能转 active」属于业务规则，全部在注入的 `stateAdapter.reduce` 里。
 *    想换成你自己的规则，只需换掉 adapter，不用动本文件一行 RTM 代码。
 * 3. **`createClient` 参数只为可测性存在。** 默认值就是真实的 SDK 构造函数，
 *    你拷走后不需要关心它。测试传入记录调用轨迹的假实现，从而让整套房间逻辑
 *    脱离网络可测。
 *
 * ## 房主端的 RTM 用法总览
 *
 * | 机制 | 在哪 |
 * | --- | --- |
 * | 登录前注册事件 → 登录 → 订阅（四类能力一起订） | `connect()` |
 * | 分阶段回滚（逆序清理、吞掉清理异常、暴露最初失败原因） | `connect()` / `rollbackConnect()` |
 * | Storage 作房间权威状态 + Lock 乐观并发 | `mutate()` |
 * | Lock 必须先创建才能获取（-14008 → setLock → 重取，容忍 -14004） | `acquireRoomLock()` |
 * | 消息信封、TTL、去重 | `createEnvelope()` / `parseEnvelope()` / `acceptOnce()` |
 * | 治理命令的 ack 与超时 | `sendGovernanceCommand()` / `handleAck()` |
 * | 重连靠重新读取，不重放 | `rehydrateAfterReconnect()` |
 * | trace 采集（api 节点带耗时、event 节点、失败带错误码） | `track()` / `recordEvent()` |
 *
 * ## 与 RTC 的分工
 *
 * 本文件**完全不碰 RTC**。麦位激活由媒体结果驱动，所以顺序是：
 * `approveSeatRequest()` 把麦位写成 `joining` → 听众端发布麦克风 → 成功则听众端
 * 调 `activateOwnSeat()`，失败则调 `rollbackOwnSeat()`。房主自己的 seat-0 同理：
 * `connect()` 后由容器发布麦克风，成功再调 `activateOwnSeat('seat-0')`。
 */

import AgoraRTM from 'agora-rtm';
import type { RTMConfig, RTMEvents } from 'agora-rtm';

import type { SeatInvitation, VoiceRoomSnapshot } from './state';
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
/** 治理命令等待对端 ack 的超时。 */
const DEFAULT_COMMAND_TIMEOUT_MS = 6_000;
/** 协议版本号。收到不同版本的消息一律丢弃。 */
const SCHEMA_VERSION = 1;
/** 本文件固定的角色。trace 与 uid 前缀都用它。 */
const ROLE = 'host';

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

export interface VoiceRoomHostHandlers {
  /** 链路状态变化。只用 linkState，不用已废弃的旧状态事件。 */
  linkState(state: VoiceRoomLinkState, reason?: string): void;
  /** 房间快照更新。 */
  snapshot(snapshot: VoiceRoomSnapshot): void;
  /** 互动事件：公屏消息、表情、礼物。 */
  interaction(event: InteractionEvent): void;
  /** 在线用户列表变化。 */
  presence(userIds: readonly string[]): void;
  /** 错误。含 ack 超时。 */
  error(message: string): void;
}

export interface VoiceRoomHostOptions {
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
  handlers: VoiceRoomHostHandlers;
  commandTimeoutMs?: number;
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
// 房主端客户端
// ---------------------------------------------------------------------------

export class VoiceRoomHostClient {
  private readonly options: VoiceRoomHostOptions;
  private readonly adapter: VoiceRoomStateAdapter;
  private readonly handlers: VoiceRoomHostHandlers;
  private readonly createClient: RtmClientFactory;
  private readonly now: () => number;
  private readonly commandTimeoutMs: number;

  private client: RtmClientLike | undefined;
  private snapshot: VoiceRoomSnapshot;
  private onlineUsers: readonly string[] = [];
  private linkState: VoiceRoomLinkState = 'disconnected';
  private connected = false;
  private wasReconnecting = false;

  /** 去重表。插入序即最旧序，超限从头丢。 */
  private readonly seenMessageIds = new Set<string>();
  /** 待 ack 的治理命令：messageId → 超时定时器。 */
  private readonly ackTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // --- 内联的 trace store（不 import 共享实现，这是零依赖的代价）---
  private readonly traces: TraceEntry[] = [];
  private readonly traceListeners = new Set<() => void>();
  private traceSeq = 0;
  private traceSnapshot: readonly TraceEntry[] | undefined;

  constructor(options: VoiceRoomHostOptions) {
    this.options = options;
    this.adapter = options.stateAdapter;
    this.handlers = options.handlers;
    this.createClient = options.createClient ?? defaultClientFactory;
    this.now = options.now ?? (() => Date.now());
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    this.snapshot = this.adapter.createInitial(options.userId, options.displayName);
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
   *    仍可被原地改写并污染这份缓存（缓存会被后续每次调用持续返回）。所以每条
   *    再包一层 Proxy 静默吞掉写入。
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
   * 连接房间。顺序是本文件最值得照抄的部分：
   *
   * 1. 创建客户端
   * 2. **注册事件（必须在 login 之前，否则会漏掉早期事件）**
   * 3. login
   * 4. subscribe（message / presence / metadata / lock 四类一起订）
   * 5. 拉 Presence 与 Storage；Storage 里没有房间状态则由房主写入初始快照
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

      const snapshot = await this.ensureRoomState();
      this.applySnapshot(snapshot);

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
    this.clearAckTimers();
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

  // === 房主的业务动作 ======================================================

  /** 同意上麦申请。麦位先进 `joining`，等听众端媒体发布成功才转 `active`。 */
  async approveSeatRequest(requestId: string): Promise<void> {
    const request = this.snapshot.queue.find((item) => item.id === requestId);
    if (!request) throw new Error('排麦申请不存在');
    await this.mutate({ type: 'seat.approve', actorId: this.options.userId, requestId });
    await this.publishToUser(request.userId, 'seat.approved', false, {
      requestId,
      seatId: request.seatId,
    });
  }

  /** 拒绝上麦申请。 */
  async rejectSeatRequest(requestId: string): Promise<void> {
    const request = this.snapshot.queue.find((item) => item.id === requestId);
    if (!request) throw new Error('排麦申请不存在');
    await this.mutate({ type: 'seat.reject', actorId: this.options.userId, requestId });
    await this.publishToUser(request.userId, 'seat.rejected', false, { requestId });
  }

  /** 邀请某个听众上麦。 */
  async inviteToSeat(userId: string, displayName: string, seatId: string): Promise<void> {
    const invitation: SeatInvitation = {
      id: newMessageId(),
      hostUserId: this.options.userId,
      userId,
      displayName,
      seatId,
      createdAt: this.now(),
    };
    await this.mutate({ type: 'seat.invite', actorId: this.options.userId, invitation });
    await this.publishToUser(userId, 'seat.invited', false, {
      invitationId: invitation.id,
      seatId,
    });
  }

  /**
   * 强制静音 / 解除静音某个麦位。**对他人、需要 ack。**
   *
   * 与听众端「给自己静音」是两个语义不同的方法 —— 不要用「目标 uid 是否为空」
   * 这种隐式分支把它们合成一个。
   */
  async forceMuteSeat(userId: string, muted: boolean): Promise<void> {
    await this.sendGovernanceCommand(userId, 'seat.mute.command', { muted });
  }

  /** 强制某人下麦。**对他人、需要 ack。** */
  async forceLeaveSeat(userId: string): Promise<void> {
    await this.sendGovernanceCommand(userId, 'seat.leave.command', {});
  }

  /** 踢出成员。先写权威状态，再发需要 ack 的命令。 */
  async kickMember(userId: string): Promise<void> {
    await this.mutate({ type: 'member.kick', actorId: this.options.userId, userId });
    await this.sendGovernanceCommand(userId, 'member.kick', {});
  }

  /** 封禁成员。 */
  async banMember(userId: string): Promise<void> {
    await this.mutate({ type: 'member.ban', actorId: this.options.userId, userId });
    await this.sendGovernanceCommand(userId, 'member.ban', {});
  }

  /** 更新房间公告 —— 纯 Storage 写入，没有配套消息。 */
  async updateAnnouncement(text: string): Promise<void> {
    await this.mutate({ type: 'announcement.update', actorId: this.options.userId, text });
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
    await this.mutate({ type: 'seat.activate', seatId, userId: this.options.userId });
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
  private async mutate(action: Parameters<VoiceRoomStateAdapter['reduce']>[1]): Promise<VoiceRoomSnapshot> {
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

  /** Storage 里没有房间状态时由房主写入初始快照，同样走锁。 */
  private async ensureRoomState(): Promise<VoiceRoomSnapshot> {
    const client = this.requireClient();
    const { roomId, userId, displayName } = this.options;
    let acquired = false;
    try {
      await this.acquireRoomLock(client);
      acquired = true;

      const stored = await this.track('storage.getChannelMetadata', SNAPSHOT_KEY, () =>
        client.storage.getChannelMetadata(roomId, 'MESSAGE'),
      );
      const existing = this.adapter.parseStored(stored.metadata[SNAPSHOT_KEY]?.value);
      if (existing) return existing;

      const initial = this.adapter.createInitial(userId, displayName);
      await this.track('storage.setChannelMetadata', `revision=${initial.revision}`, () =>
        client.storage.setChannelMetadata(
          roomId,
          'MESSAGE',
          [{ key: SNAPSHOT_KEY, value: JSON.stringify(initial), revision: -1 }],
          {
            majorRevision: stored.majorRevision,
            lockName: MUTATION_LOCK,
            addTimeStamp: true,
            addUserId: true,
          },
        ),
      );
      return initial;
    } finally {
      if (acquired) {
        await this.track('lock.releaseLock', MUTATION_LOCK, () =>
          client.lock.releaseLock(roomId, 'MESSAGE', MUTATION_LOCK),
        );
      }
    }
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
   * 治理命令：**标记需要 ack，并登记超时定时器**。
   *
   * 对端执行完会回一条 `command.ack`，`handleAck()` 负责清掉定时器；
   * 超时未收到则走 error 回调。治理动作是客户端协作行为，**不构成信任边界**。
   */
  private async sendGovernanceCommand(
    userId: string,
    type: 'seat.mute.command' | 'seat.leave.command' | 'member.kick' | 'member.ban',
    payload: Record<string, unknown>,
  ): Promise<void> {
    const envelope = await this.publishToUser(userId, type, true, payload);
    const timer = setTimeout(() => {
      this.ackTimers.delete(envelope.messageId);
      this.handlers.error(`${type} 执行 ACK 超时`);
    }, this.commandTimeoutMs);
    this.ackTimers.set(envelope.messageId, timer);
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
   */
  private async handleMessage(serialized: string): Promise<void> {
    const envelope = this.parseEnvelope(serialized);
    if (!envelope) return;
    if (!this.acceptOnce(envelope.messageId)) return;

    switch (envelope.type) {
      case 'command.ack':
        this.handleAck(envelope);
        return;
      case 'chat.message':
      case 'emoji.reaction':
      case 'gift.sent':
        this.handleInteraction(envelope);
        return;
      default:
        // 其余（seat.request / seat.request.cancelled / seat.invitation.rejected /
        // seat.media-ready）都只是通知：权威状态由 Storage 事件同步，无需本地推断。
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

  private handleAck(envelope: Envelope): void {
    const commandId = typeof envelope.payload.commandId === 'string' ? envelope.payload.commandId : '';
    const timer = this.ackTimers.get(commandId);
    if (timer) clearTimeout(timer);
    this.ackTimers.delete(commandId);
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

      const stored = await this.track('storage.getChannelMetadata', SNAPSHOT_KEY, () =>
        client.storage.getChannelMetadata(this.options.roomId, 'MESSAGE'),
      );
      const next = this.adapter.parseStored(stored.metadata[SNAPSHOT_KEY]?.value);
      if (next) this.applySnapshot(next);
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

  private clearAckTimers(): void {
    this.ackTimers.forEach((timer) => clearTimeout(timer));
    this.ackTimers.clear();
  }

  /**
   * 包住每一次 RTM API 调用：成功记一条带耗时的 api 节点，失败额外带错误码与
   * 错误信息。**所有对 SDK 的调用都必须经过它**，否则时间线会缺节点。
   */
  private async track<T>(name: string, summary: string | undefined, run: () => Promise<T>): Promise<T> {
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

export function createVoiceRoomHostClient(options: VoiceRoomHostOptions): VoiceRoomHostClient {
  return new VoiceRoomHostClient(options);
}

// ---------------------------------------------------------------------------
// SDK 错误归一。内联在此 —— 客户拷走后同样需要认这两个锁错误码。
// ---------------------------------------------------------------------------

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
