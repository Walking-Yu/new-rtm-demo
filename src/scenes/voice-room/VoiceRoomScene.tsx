/**
 * 语聊房主容器。
 *
 * 职责边界：**只管 React 生命周期与视图订阅**。连接顺序、麦位激活时序、失败回滚
 * 全在 `orchestrator.ts` 里 —— 那些是能脱离 React 测试的部分，不该被 `useEffect`
 * 的调度细节缠住。
 *
 * ## StrictMode
 *
 * React 严格模式会故意「挂载 → 卸载 → 再挂载」。这里的对策是**每次挂载建一个新的
 * 编排器**，卸载时 `stop()` 掉自己那一个。编排器内部还有一层代数守卫，用来让第一代
 * 在飞的异步步骤失效。两层缺一不可：只有代数守卫的话，第二代会复用第一代已经 stop
 * 掉的客户端；只重建编排器的话，第一代的 `connect()` 仍会在后台跑完并留下连接。
 *
 * ## 为什么身份推导在这里，而不在编排器里
 *
 * `deriveIdentity` 属于实验室外壳（见 spec「身份推导」）。用 `useState` 的初始化
 * 函数存一次 —— 每次渲染重新推导会生成新的随机 uid，房间号也跟着变。
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { deriveIdentity } from '../../app/identity';
import type { ResolvedEnv } from '../../app/env';
import type { TraceSource } from '../../shared/timeline/useMergedTraces';
import type { TraceEntry } from './rtm-host';
import { ROLES } from './config';
import {
  VoiceRoomOrchestrator,
  type OrchestratorDeps,
  type VoiceRoomView,
} from './orchestrator';
import type { PhoneActions } from './components/actions';
import { PhoneFrame } from './components/PhoneFrame';
import { HeadphonesWarning, ProductionBoundaryWarning } from './components/Warnings';

export interface VoiceRoomSceneProps {
  env: Extract<ResolvedEnv, { configured: true }>;
  /** `location.search`，供 `?room=` / `?uid.<role>=` 覆盖。显式传入便于测试。 */
  search?: string;
  /** 注入的依赖，测试用假工厂替换两端客户端与 RTC。 */
  overrides?: Pick<OrchestratorDeps, 'createClients' | 'createRtc'>;
  /** 把两端的 trace 来源交给外壳的时间线面板。 */
  onTraceSources?: (sources: readonly TraceSource[]) => void;
}

/** 两端客户端共有的 trace 接口。房主端与听众端都满足它。 */
interface TraceCapableClient {
  getTraces(): readonly TraceEntry[];
  subscribeTraces(listener: () => void): () => void;
  clearTraces(): void;
}

/**
 * 把客户端的 trace 接口适配成时间线面板要的形状。
 *
 * 方法名不一致是刻意的：**不要为此去改角色 RTM 单文件的方法名** —— 那是客户要拷走
 * 的文件，命名以它为准，适配成本留在这一侧。
 */
function toTraceSource(client: TraceCapableClient): TraceSource {
  return {
    getEntries: () => client.getTraces(),
    subscribe: (listener) => client.subscribeTraces(listener),
    clear: () => client.clearTraces(),
  };
}

export function VoiceRoomScene({
  env,
  search = '',
  overrides,
  onTraceSources,
}: VoiceRoomSceneProps) {
  // 身份只推导一次。重新推导会换掉房间号与 uid，等于换了个房间。
  const [identity] = useState(() =>
    deriveIdentity({ sceneId: 'voice-room', roles: ROLES, search }),
  );

  /*
   * 注入的依赖也只取首次渲染那一份。
   *
   * 它进了下面 `useMemo` 的依赖数组，而调用方几乎一定是写成内联对象字面量
   * （`overrides={{ createClients }}`）—— 每次渲染都是新引用，编排器就会被反复重建，
   * 连上又断开。用 `useState` 钉住引用比要求每个调用方自己 `useMemo` 可靠。
   */
  const [pinnedOverrides] = useState(() => overrides);

  // 编排器只建一次。StrictMode 的第二次挂载会走 effect，不会重建这个实例 ——
  // 重建会丢掉第一次挂载已经建好的客户端，且旧实例没人 stop。
  const orchestrator = useMemo(
    () =>
      new VoiceRoomOrchestrator({
        appId: env.appId,
        roomId: identity.roomId,
        hostUserId: identity.uids.host,
        audienceUserId: identity.uids.audience,
        createClients: pinnedOverrides?.createClients,
        createRtc: pinnedOverrides?.createRtc,
      }),
    [env.appId, identity, pinnedOverrides],
  );

  const view = useSyncExternalStore<VoiceRoomView>(
    (listener) => orchestrator.subscribe(listener),
    () => orchestrator.getView(),
  );

  useEffect(() => {
    void orchestrator.start();
    return () => {
      // 卸载必须断开两端 —— 否则 StrictMode 的第一代连接会一直挂着。
      void orchestrator.stop();
    };
  }, [orchestrator]);

  // 时间线来源：两端客户端各一个。`onTraceSources` 只在编排器变化时回调一次。
  useEffect(() => {
    if (!onTraceSources) return;
    const clients = orchestrator.getClients();
    onTraceSources([toTraceSource(clients.host), toTraceSource(clients.audience)]);
    return () => onTraceSources([]);
  }, [orchestrator, onTraceSources]);

  // 选中麦位是纯 UI 状态，两端各自一份 —— 房主选的位子用于邀请，听众选的用于申请。
  const [hostSeatId, setHostSeatId] = useState('seat-1');
  const [audienceSeatId, setAudienceSeatId] = useState('seat-1');

  const hostActions = useMemo(
    () => createActions(orchestrator, 'host'),
    [orchestrator],
  );
  const audienceActions = useMemo(
    () => createActions(orchestrator, 'audience'),
    [orchestrator],
  );

  return (
    <div className="vr-scene">
      <div className="vr-warnings">
        <HeadphonesWarning />
        <ProductionBoundaryWarning />
      </div>

      <div className="vr-phones">
        <PhoneFrame
          view={view.host}
          peer={view.audience}
          roomId={identity.roomId}
          selectedSeatId={hostSeatId}
          onSelectSeat={setHostSeatId}
          actions={hostActions}
        />
        <PhoneFrame
          view={view.audience}
          peer={view.host}
          roomId={identity.roomId}
          selectedSeatId={audienceSeatId}
          onSelectSeat={setAudienceSeatId}
          actions={audienceActions}
        />
      </div>
    </div>
  );
}

/**
 * 把编排器的异步方法包成组件要的 `void` 动作面。
 *
 * 这里刻意不 catch —— 编排器内部已经把失败转成该端的 `lastError`，
 * 再加一层 catch 只会让错误消失在两个地方。
 */
function createActions(
  orchestrator: VoiceRoomOrchestrator,
  role: 'host' | 'audience',
): PhoneActions {
  return {
    approveSeatRequest: (requestId) => void orchestrator.approveSeatRequest(requestId),
    rejectSeatRequest: (requestId) => void orchestrator.rejectSeatRequest(requestId),
    inviteToSeat: (seatId) => void orchestrator.inviteToSeat(seatId),
    forceMuteSeat: (userId, muted) => void orchestrator.forceMuteSeat(userId, muted),
    forceLeaveSeat: (userId) => void orchestrator.forceLeaveSeat(userId),
    kickMember: (userId) => void orchestrator.kickMember(userId),
    banMember: (userId) => void orchestrator.banMember(userId),
    updateAnnouncement: (text) => void orchestrator.updateAnnouncement(text),

    requestSeat: (seatId) => void orchestrator.requestSeat(seatId),
    cancelSeatRequest: () => void orchestrator.cancelSeatRequest(),
    acceptInvitation: () => void orchestrator.acceptInvitation(),
    rejectInvitation: () => void orchestrator.rejectInvitation(),
    setOwnMuted: (muted) => void orchestrator.setOwnMuted(muted),
    leaveOwnSeat: () => void orchestrator.leaveOwnSeat(),

    sendChat: (text) => void orchestrator.sendChatMessage(role, text),
    sendEmoji: (emoji) => void orchestrator.sendEmoji(role, emoji),
    sendGift: (giftId) => void orchestrator.sendGift(role, giftId),
  };
}
