/**
 * 语聊房场景的测试替身。
 *
 * ## 为什么需要单独一份
 *
 * 场景**一挂载就自动连接**（spec「身份推导」：零表单、点 tab 直接进房）。所以任何
 * 渲染到真实场景的测试 —— 外壳路由测试、场景 UI 测试 —— 如果不注入替身，就会去连
 * 真实 RTM，既慢又不确定。
 *
 * `orchestrator.test.ts` 里另有一份记录 `operations: string[]` 的假客户端，那是为了
 * 断言**跨端调用顺序**，与这里的用途不同：这里只要「不发网络请求、能被驱动」，
 * 所以做成无副作用的空实现加少量可控开关。两份刻意不合并 —— 合并出来的东西既要
 * 记轨迹又要给 UI 用，会同时被两批测试的需求拉扯。
 */

import type { RtcHandlers, RtcHelper } from '../../shared/rtc';
import type {
  ClientsConfig,
  VoiceRoomAudienceClientLike,
  VoiceRoomClients,
  VoiceRoomHostClientLike,
} from './orchestrator';
import type { VoiceRoomAudienceHandlers } from './rtm-audience';
import type { TraceEntry, VoiceRoomHostHandlers } from './rtm-host';

/** 测试可以拿到的把手：用来从「SDK 侧」把事件打回编排器。 */
export interface VoiceRoomFakes {
  /** 注入给场景/编排器的依赖。 */
  overrides: {
    createClients: (config: ClientsConfig) => VoiceRoomClients;
    createRtc: () => RtcHelper;
  };
  /** 房主端的事件回调，`createClients` 调用后可用。 */
  host: () => VoiceRoomHostHandlers;
  /** 听众端的事件回调。 */
  audience: () => VoiceRoomAudienceHandlers;
  /** 两端的 RTC 事件回调，按 `['host', 'audience']` 顺序。 */
  rtc: () => readonly RtcHandlers[];
}

function fakeTraceApi() {
  const entries: TraceEntry[] = [];
  return {
    getTraces: () => entries,
    subscribeTraces: () => () => undefined,
    clearTraces: () => {
      entries.length = 0;
    },
  };
}

function fakeRtc(): { helper: RtcHelper; handlers: () => RtcHandlers } {
  let registered: RtcHandlers | undefined;
  const noop = async () => undefined;
  return {
    helper: {
      registerEvents: (next) => {
        registered = next;
      },
      join: noop,
      leave: noop,
      publishMicrophone: noop,
      unpublishMicrophone: noop,
      setMicrophoneMuted: noop,
      publishCamera: noop,
      unpublishCamera: noop,
      setCameraMuted: noop,
      getLocalVideoTrack: () => undefined,
    },
    handlers: () => {
      if (!registered) throw new Error('registerEvents 还没被调用');
      return registered;
    },
  };
}

/**
 * 建一组语聊房替身。
 *
 * 所有方法都是空实现且立即 resolve —— 测试要观察的是**编排结果与 UI**，不是这里的
 * 调用轨迹（那是 `orchestrator.test.ts` 的职责）。要驱动状态就用返回的 `host()` /
 * `audience()` / `rtc()` 把事件打回去。
 */
export function createVoiceRoomFakes(): VoiceRoomFakes {
  const noop = async () => undefined;
  let hostHandlers: VoiceRoomHostHandlers | undefined;
  let audienceHandlers: VoiceRoomAudienceHandlers | undefined;
  const rtcs: Array<{ helper: RtcHelper; handlers: () => RtcHandlers }> = [];

  const createClients = (config: ClientsConfig): VoiceRoomClients => {
    hostHandlers = config.host.handlers;
    audienceHandlers = config.audience.handlers;

    const host: VoiceRoomHostClientLike = {
      ...fakeTraceApi(),
      connect: noop,
      disconnect: noop,
      approveSeatRequest: noop,
      rejectSeatRequest: noop,
      inviteToSeat: noop,
      forceMuteSeat: noop,
      forceLeaveSeat: noop,
      kickMember: noop,
      banMember: noop,
      updateAnnouncement: noop,
      sendChatMessage: noop,
      sendEmoji: noop,
      sendGift: noop,
    };

    const audience: VoiceRoomAudienceClientLike = {
      ...fakeTraceApi(),
      connect: noop,
      disconnect: noop,
      requestSeat: noop,
      cancelSeatRequest: noop,
      acceptInvitation: noop,
      rejectInvitation: noop,
      setOwnMuted: noop,
      leaveOwnSeat: noop,
      applyForcedMute: noop,
      applyForcedLeave: noop,
      activateOwnSeat: noop,
      rollbackOwnSeat: noop,
      sendChatMessage: noop,
      sendEmoji: noop,
      sendGift: noop,
    };

    return { host, audience };
  };

  const createRtc = (): RtcHelper => {
    const next = fakeRtc();
    rtcs.push(next);
    return next.helper;
  };

  return {
    overrides: { createClients, createRtc },
    host: () => {
      if (!hostHandlers) throw new Error('createClients 还没被调用');
      return hostHandlers;
    },
    audience: () => {
      if (!audienceHandlers) throw new Error('createClients 还没被调用');
      return audienceHandlers;
    },
    rtc: () => rtcs.map((entry) => entry.handlers()),
  };
}
