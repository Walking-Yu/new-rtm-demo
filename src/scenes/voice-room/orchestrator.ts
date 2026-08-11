/**
 * 双客户端编排。
 *
 * 一个标签页里跑**两个真实客户端**（房主端 + 听众端），这是本 demo 的核心卖点：
 * 读者不用开两个浏览器，就能看到一个动作在两端引发的完整因果链。
 *
 * ## 为什么编排逻辑要单独成一个模块，而不是写在组件里
 *
 * 三件事必须能脱离 React 测试：连接顺序、生命周期守卫、麦位激活由媒体结果驱动。
 * 写在组件的 `useEffect` 里就只能靠渲染来驱动，异步时序断言会变得又慢又脆。
 *
 * ## 三条不能改的顺序
 *
 * **先连房主再连听众。** 房间快照由房主创建（听众端刻意不写初始快照），听众先连
 * 会读到空 Storage，只能等 Storage 事件补，白等一轮。
 *
 * **麦位激活由媒体结果驱动。** 房主同意申请后麦位先进 `joining`；只有听众端 RTC
 * `publishMicrophone()` 成功后才转 `active`；失败则回滚到空位。**顺序不能反** ——
 * 先置 `active` 再发布，失败时房间里就有了一个不出声的「在麦」用户。
 *
 * **踢出与封禁：先回 ack 再断开。** 反过来连接已断，ack 发不出去，房主必然超时报错。
 * 这条由听众端单文件内部保证，编排层只需在 `exit` 回调里断开。
 *
 * ## 生命周期守卫
 *
 * React StrictMode 会故意「挂载 → 卸载 → 再挂载」来暴露副作用泄漏。每个异步步骤
 * 之后都要检查 `generation` 是否还是自己那一代，不是就地放弃并清理 —— 否则第一代
 * 的连接会在第二代挂载后才完成，两份连接同时活着，谁都关不掉。
 */

import { createRtcHelper, type RtcHelper } from '../../shared/rtc';
import type { VoiceRoomSnapshot } from './state';
import { voiceRoomStateAdapter } from './stateAdapter';
import {
  createVoiceRoomHostClient,
  type InteractionEvent,
  type TraceEntry,
  type VoiceRoomHostHandlers,
  type VoiceRoomLinkState,
} from './rtm-host';
import {
  createVoiceRoomAudienceClient,
  type IncomingCommand,
  type VoiceRoomAudienceHandlers,
} from './rtm-audience';

/** 两端各自的可观察状态，供 UI 直接渲染。 */
export interface EndpointView {
  role: 'host' | 'audience';
  userId: string;
  displayName: string;
  linkState: VoiceRoomLinkState;
  snapshot: VoiceRoomSnapshot;
  onlineUsers: readonly string[];
  interactions: readonly InteractionEvent[];
  /** 音量表，uid → 0..100。用于麦位说话高亮。 */
  volumes: Readonly<Record<string, number>>;
  /** 最近一条错误。UI 用它给失败路径可见反馈。 */
  lastError?: string;
  /** 被踢出或被封禁后置上，UI 据此显示原因并停止操作。 */
  exitReason?: 'kicked' | 'banned';
}

export interface VoiceRoomView {
  host: EndpointView;
  audience: EndpointView;
}

/**
 * 编排层实际用到的房主端方法。
 *
 * **为什么不直接用 `VoiceRoomHostClient` 这个类。** 类里有 `private` 成员，TS 的
 * 结构化匹配会因此认定任何对象字面量都不兼容 —— 测试就只能去 `new` 真客户端或者
 * 强转，两条路都会把「注入假工厂」这个口子堵死。所以在这里按需声明结构接口，真类
 * 天然满足它。
 */
export interface VoiceRoomHostClientLike {
  getTraces(): readonly TraceEntry[];
  subscribeTraces(listener: () => void): () => void;
  clearTraces(): void;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  approveSeatRequest(requestId: string): Promise<void>;
  rejectSeatRequest(requestId: string): Promise<void>;
  inviteToSeat(userId: string, displayName: string, seatId: string): Promise<void>;
  forceMuteSeat(userId: string, muted: boolean): Promise<void>;
  forceLeaveSeat(userId: string): Promise<void>;
  kickMember(userId: string): Promise<void>;
  banMember(userId: string): Promise<void>;
  updateAnnouncement(text: string): Promise<void>;
  sendChatMessage(text: string): Promise<void>;
  sendEmoji(emoji: string): Promise<void>;
  sendGift(giftId: string): Promise<void>;
}

/** 编排层实际用到的听众端方法。理由同 `VoiceRoomHostClientLike`。 */
export interface VoiceRoomAudienceClientLike {
  getTraces(): readonly TraceEntry[];
  subscribeTraces(listener: () => void): () => void;
  clearTraces(): void;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  requestSeat(seatId: string): Promise<void>;
  cancelSeatRequest(): Promise<void>;
  acceptInvitation(): Promise<void>;
  rejectInvitation(): Promise<void>;
  setOwnMuted(muted: boolean): Promise<void>;
  leaveOwnSeat(): Promise<void>;
  applyForcedMute(muted: boolean, commandId: string, hostUserId: string): Promise<void>;
  applyForcedLeave(commandId: string, hostUserId: string): Promise<void>;
  activateOwnSeat(seatId: string): Promise<void>;
  rollbackOwnSeat(seatId: string): Promise<void>;
  sendChatMessage(text: string): Promise<void>;
  sendEmoji(emoji: string): Promise<void>;
  sendGift(giftId: string): Promise<void>;
}

/** 两端客户端的抽象，测试注入假实现。 */
export interface VoiceRoomClients {
  host: VoiceRoomHostClientLike;
  audience: VoiceRoomAudienceClientLike;
}

/**
 * 编排所需的外部依赖，全部可注入。
 *
 * RTC 也做成工厂：测试里两端各要一个假 RTC，且要能让 `publishMicrophone` 失败，
 * 才能验证「麦位激活由媒体结果驱动」的失败回滚路径。
 */
export interface OrchestratorDeps {
  appId: string;
  roomId: string;
  hostUserId: string;
  audienceUserId: string;
  hostDisplayName?: string;
  audienceDisplayName?: string;
  /** 建两端 RTM 客户端。默认用两份真实单文件的工厂。 */
  createClients?: (config: ClientsConfig) => VoiceRoomClients;
  /** 建 RTC 辅助，每端一个。默认是共享 RTC 模块。 */
  createRtc?: () => RtcHelper;
}

/** 交给 `createClients` 的配置，把两端的 handlers 一并带上。 */
export interface ClientsConfig {
  appId: string;
  roomId: string;
  host: { userId: string; displayName: string; handlers: HostHandlers };
  audience: { userId: string; displayName: string; handlers: AudienceHandlers };
}

// handlers 的形状**以两份 RTM 单文件为准**，不在这里另写一份。
// 那两个文件是客户要拷走的成品，契约以它们导出的类型为唯一来源。
type HostHandlers = VoiceRoomHostHandlers;
type AudienceHandlers = VoiceRoomAudienceHandlers;

/** 说话高亮的音量阈值。与遗留 UI 一致。 */
const SPEAKING_THRESHOLD = 30;

/** 公屏只留最近这么多条 —— 无上限会让长时间演示吃掉内存。 */
const INTERACTION_LIMIT = 50;

function emptySnapshot(hostUserId: string): VoiceRoomSnapshot {
  return voiceRoomStateAdapter.createInitial(hostUserId);
}

/**
 * 语聊房编排器。
 *
 * 不是 React 组件，也不依赖 React —— 暴露 `getView()` + `subscribe()`，
 * 由容器用标准的外部 store 钩子接进去（与时间线面板同一套机制）。
 */
export class VoiceRoomOrchestrator {
  private readonly deps: OrchestratorDeps;
  private readonly clients: VoiceRoomClients;
  private readonly hostRtc: RtcHelper;
  private readonly audienceRtc: RtcHelper;
  private readonly listeners = new Set<() => void>();

  /**
   * 生命周期代数。`start()` 递增，`stop()` 也递增 ——
   * 每个异步步骤之后比对，不是自己那一代就放弃。
   */
  private generation = 0;
  private running = false;

  /**
   * 当前视图。
   *
   * `patch()` 每次都整体换新对象、绝不原地改 —— 所以 `this.view` 本身就满足外部
   * store 钩子的要求：**没变化时必须返回同一引用**，否则 `useSyncExternalStore`
   * 会无限重渲染。不要在 `getView()` 里再拷一层，那样每次读都是新引用，正好破坏
   * 这个性质。
   */
  private view: VoiceRoomView;

  constructor(deps: OrchestratorDeps) {
    this.deps = deps;
    const hostDisplayName = deps.hostDisplayName ?? '房主';
    const audienceDisplayName = deps.audienceDisplayName ?? '听众';

    this.view = {
      host: {
        role: 'host',
        userId: deps.hostUserId,
        displayName: hostDisplayName,
        linkState: 'disconnected',
        snapshot: emptySnapshot(deps.hostUserId),
        onlineUsers: [],
        interactions: [],
        volumes: {},
      },
      audience: {
        role: 'audience',
        userId: deps.audienceUserId,
        displayName: audienceDisplayName,
        linkState: 'disconnected',
        snapshot: emptySnapshot(deps.hostUserId),
        onlineUsers: [],
        interactions: [],
        volumes: {},
      },
    };

    const createRtc = deps.createRtc ?? (() => createRtcHelper());
    this.hostRtc = createRtc();
    this.audienceRtc = createRtc();

    const createClients = deps.createClients ?? defaultCreateClients;
    this.clients = createClients({
      appId: deps.appId,
      roomId: deps.roomId,
      host: {
        userId: deps.hostUserId,
        displayName: hostDisplayName,
        handlers: {
          linkState: (state, reason) => this.patch('host', { linkState: state, lastError: reason }),
          snapshot: (snapshot) => this.patch('host', { snapshot }),
          interaction: (event) => this.appendInteraction('host', event),
          presence: (userIds) => this.patch('host', { onlineUsers: userIds }),
          error: (message) => this.patch('host', { lastError: message }),
        },
      },
      audience: {
        userId: deps.audienceUserId,
        displayName: audienceDisplayName,
        handlers: {
          linkState: (state, reason) =>
            this.patch('audience', { linkState: state, lastError: reason }),
          snapshot: (snapshot) => this.patch('audience', { snapshot }),
          interaction: (event) => this.appendInteraction('audience', event),
          presence: (userIds) => this.patch('audience', { onlineUsers: userIds }),
          // 房主的命令要配合 RTC 动作，所以经编排层再落回听众端的语义方法。
          command: (command) => void this.handleAudienceCommand(command),
          exit: (reason) => void this.handleExit(reason),
          error: (message) => this.patch('audience', { lastError: message }),
        },
      },
    });

    this.registerRtcHandlers();
  }

  // ── 对外的只读视图 ──────────────────────────────────────────────

  getView(): VoiceRoomView {
    return this.view;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 两端客户端，供容器取 trace 来源。 */
  getClients(): VoiceRoomClients {
    return this.clients;
  }

  // ── 生命周期 ────────────────────────────────────────────────────

  /**
   * 连接两端。**先房主再听众。**
   *
   * 每个 await 之后都检查代数：StrictMode 的第一代在这里被卸载时，后续步骤全部
   * 放弃，且已经连上的那一端会被 `stop()` 关掉。
   */
  async start(): Promise<void> {
    const generation = ++this.generation;
    this.running = true;

    try {
      await this.clients.host.connect();
      if (!this.isCurrent(generation)) return;

      // 房主的 RTC：房主默认在麦（seat-0），要能出声。
      await this.hostRtc.join({
        appId: this.deps.appId,
        roomId: this.deps.roomId,
        userId: this.deps.hostUserId,
      });
      if (!this.isCurrent(generation)) return;

      await this.clients.audience.connect();
      if (!this.isCurrent(generation)) return;

      // 听众的 RTC 先加入频道但不发布麦克风 —— 上麦成功才发布。
      await this.audienceRtc.join({
        appId: this.deps.appId,
        roomId: this.deps.roomId,
        userId: this.deps.audienceUserId,
      });
    } catch (error) {
      if (!this.isCurrent(generation)) return;
      this.patch('host', { lastError: describeError(error) });
    }
  }

  /**
   * 断开两端并清理 RTC。
   *
   * 递增代数让所有在飞的异步步骤失效。每一步都吞掉异常 —— 卸载路径上再抛只会
   * 掩盖真正的问题，且会让另一端漏关。
   */
  async stop(): Promise<void> {
    this.generation += 1;
    this.running = false;

    await Promise.all([
      swallow(() => this.audienceRtc.leave()),
      swallow(() => this.hostRtc.leave()),
      swallow(() => this.clients.audience.disconnect()),
      swallow(() => this.clients.host.disconnect()),
    ]);
  }

  // ── 麦位激活由媒体结果驱动 ──────────────────────────────────────

  /**
   * 房主同意上麦申请。
   *
   * 只做「置 joining」这一步 —— 转 `active` 由听众端发布麦克风成功后驱动，
   * 那条路径走 `handleAudienceCommand` 的 `seat.approved` 分支。
   */
  async approveSeatRequest(requestId: string): Promise<void> {
    await this.guarded('host', () => this.clients.host.approveSeatRequest(requestId));
  }

  async rejectSeatRequest(requestId: string): Promise<void> {
    await this.guarded('host', () => this.clients.host.rejectSeatRequest(requestId));
  }

  async inviteToSeat(seatId: string): Promise<void> {
    await this.guarded('host', () =>
      this.clients.host.inviteToSeat(
        this.view.audience.userId,
        this.view.audience.displayName,
        seatId,
      ),
    );
  }

  /**
   * 处理房主发来的命令。**这里是「麦位激活由媒体结果驱动」的落点。**
   *
   * `seat.approved` 与 `seat.invited` 两条路径都一样：先发布麦克风，成功才调
   * `activateOwnSeat`，失败调 `rollbackOwnSeat` 并留下错误让 UI 可见。
   */
  private async handleAudienceCommand(command: IncomingCommand): Promise<void> {
    switch (command.type) {
      case 'seat.approved':
        await this.activateAudienceSeat(command.seatId);
        return;

      case 'seat.invited':
        // 邀请只是通知，接不接由听众自己点（`acceptInvitation`）。
        return;

      case 'seat.mute':
        // 先做 RTC 动作，再让听众端写 Storage 并回 ack。
        await this.guarded('audience', async () => {
          await this.audienceRtc.setMicrophoneMuted(command.muted);
          await this.clients.audience.applyForcedMute(command.muted, command.commandId, command.from);
        });
        return;

      case 'seat.leave':
        await this.guarded('audience', async () => {
          await this.audienceRtc.unpublishMicrophone();
          await this.clients.audience.applyForcedLeave(command.commandId, command.from);
        });
        return;
    }
  }

  /** 听众接受邀请：同样是发布成功才激活。 */
  async acceptInvitation(): Promise<void> {
    const seatId = this.view.audience.snapshot.invitation?.seatId;
    await this.guarded('audience', () => this.clients.audience.acceptInvitation());
    if (seatId) await this.activateAudienceSeat(seatId);
  }

  async rejectInvitation(): Promise<void> {
    await this.guarded('audience', () => this.clients.audience.rejectInvitation());
  }

  async requestSeat(seatId: string): Promise<void> {
    await this.guarded('audience', () => this.clients.audience.requestSeat(seatId));
  }

  async cancelSeatRequest(): Promise<void> {
    await this.guarded('audience', () => this.clients.audience.cancelSeatRequest());
  }

  /**
   * 麦位从 `joining` 转 `active` 的唯一通道。
   *
   * **发布麦克风成功才激活，失败必须回滚。** 这条顺序 UI 与 e2e 都依赖，
   * 不要为了「少一次 Storage 写」把它改成先激活后发布。
   */
  private async activateAudienceSeat(seatId: string): Promise<void> {
    try {
      await this.audienceRtc.publishMicrophone();
    } catch (error) {
      // 失败回滚到空位，并留下错误 —— UI 必须给可见反馈，否则用户只看到麦位闪一下。
      this.patch('audience', { lastError: `上麦失败：${describeError(error)}` });
      await swallow(() => this.clients.audience.rollbackOwnSeat(seatId));
      return;
    }
    await this.guarded('audience', () => this.clients.audience.activateOwnSeat(seatId));
  }

  // ── 自己的静音与下麦（不需要 ack）────────────────────────────────

  async setOwnMuted(muted: boolean): Promise<void> {
    await this.guarded('audience', async () => {
      await this.audienceRtc.setMicrophoneMuted(muted);
      await this.clients.audience.setOwnMuted(muted);
    });
  }

  async leaveOwnSeat(): Promise<void> {
    await this.guarded('audience', async () => {
      await this.audienceRtc.unpublishMicrophone();
      await this.clients.audience.leaveOwnSeat();
    });
  }

  // ── 治理动作（客户端协作行为，不构成信任边界）──────────────────

  async forceMuteSeat(userId: string, muted: boolean): Promise<void> {
    await this.guarded('host', () => this.clients.host.forceMuteSeat(userId, muted));
  }

  async forceLeaveSeat(userId: string): Promise<void> {
    await this.guarded('host', () => this.clients.host.forceLeaveSeat(userId));
  }

  async kickMember(userId: string): Promise<void> {
    await this.guarded('host', () => this.clients.host.kickMember(userId));
  }

  async banMember(userId: string): Promise<void> {
    await this.guarded('host', () => this.clients.host.banMember(userId));
  }

  async updateAnnouncement(text: string): Promise<void> {
    await this.guarded('host', () => this.clients.host.updateAnnouncement(text));
  }

  // ── 互动 ────────────────────────────────────────────────────────

  async sendChatMessage(role: 'host' | 'audience', text: string): Promise<void> {
    await this.guarded(role, () => this.endpointClient(role).sendChatMessage(text));
  }

  async sendEmoji(role: 'host' | 'audience', emoji: string): Promise<void> {
    await this.guarded(role, () => this.endpointClient(role).sendEmoji(emoji));
  }

  async sendGift(role: 'host' | 'audience', giftId: string): Promise<void> {
    await this.guarded(role, () => this.endpointClient(role).sendGift(giftId));
  }

  // ── 内部 ────────────────────────────────────────────────────────

  private endpointClient(role: 'host' | 'audience') {
    return role === 'host' ? this.clients.host : this.clients.audience;
  }

  /** 被踢或被封：听众端已经回过 ack，这里只负责断开并留下原因。 */
  private async handleExit(reason: 'kicked' | 'banned'): Promise<void> {
    this.patch('audience', { exitReason: reason });
    await swallow(() => this.audienceRtc.leave());
    await swallow(() => this.clients.audience.disconnect());
  }

  private registerRtcHandlers(): void {
    this.hostRtc.registerEvents({
      connection: () => undefined,
      remoteAudioPublished: () => undefined,
      remoteAudioUnpublished: () => undefined,
      remoteVideoTrack: () => undefined,
      remoteVideoUnpublished: () => undefined,
      volume: (levels) => this.patch('host', { volumes: levels }),
    });

    this.audienceRtc.registerEvents({
      connection: () => undefined,
      remoteAudioPublished: () => undefined,
      remoteAudioUnpublished: () => undefined,
      remoteVideoTrack: () => undefined,
      remoteVideoUnpublished: () => undefined,
      volume: (levels) => this.patch('audience', { volumes: levels }),
    });
  }

  /** 包一层：失败不抛给 UI，转成该端的 `lastError` 让界面能显示。 */
  private async guarded(role: 'host' | 'audience', action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      this.patch(role, { lastError: describeError(error) });
    }
  }

  private isCurrent(generation: number): boolean {
    return this.running && generation === this.generation;
  }

  private patch(role: 'host' | 'audience', changes: Partial<EndpointView>): void {
    this.view = { ...this.view, [role]: { ...this.view[role], ...changes } };
    this.notify();
  }

  private appendInteraction(role: 'host' | 'audience', event: InteractionEvent): void {
    const next = [...this.view[role].interactions, event].slice(-INTERACTION_LIMIT);
    this.patch(role, { interactions: next });
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

/** 说话判定。UI 与测试共用同一个阈值，不各写一份。 */
export function isSpeaking(volumes: Readonly<Record<string, number>>, userId?: string): boolean {
  if (!userId) return false;
  return (volumes[userId] ?? 0) > SPEAKING_THRESHOLD;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function swallow(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch {
    // 清理路径上的异常一律吞掉：再抛只会掩盖最初的失败原因，且会让另一端漏关。
  }
}

/** 默认工厂：真实的两份单文件客户端。 */
function defaultCreateClients(config: ClientsConfig): VoiceRoomClients {
  return {
    host: createVoiceRoomHostClient({
      appId: config.appId,
      roomId: config.roomId,
      userId: config.host.userId,
      displayName: config.host.displayName,
      stateAdapter: voiceRoomStateAdapter,
      handlers: config.host.handlers,
    }),
    audience: createVoiceRoomAudienceClient({
      appId: config.appId,
      roomId: config.roomId,
      userId: config.audience.userId,
      displayName: config.audience.displayName,
      stateAdapter: voiceRoomStateAdapter,
      handlers: config.audience.handlers,
    }),
  };
}

// 说明：本文件对 `shared/rtc` 的运行时 import 是**规则三**允许的那一处 ——
// RTC 共享一份、RTM 一角色一份，理由见 `shared/rtc.ts` 顶部注释。
// 编排器不属于「客户要拷走的单文件」，所以它跨目录 import 不违反规则一。
