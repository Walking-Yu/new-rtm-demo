/**
 * 语聊房的状态适配器。
 *
 * 角色 RTM 单文件只接受**一个适配器对象**，不接受十几个转移函数 ——
 * 逐个注入会让构造参数失控，且复制到新场景时注入点散在各处
 * （见 spec「注入一个 reducer，不注入十几个转移函数」）。
 *
 * 三个成员全是纯函数、全住在场景目录：
 * - `createInitial` 生成初始快照
 * - `parseStored`  把从 RTM Storage 读回的字符串校验归一
 * - `reduce`       动作 → 下一个快照
 *
 * RTM 文件只知道「调 reduce 得到下一个快照」，不知道任何权限或状态机规则。
 * 代价是语义方法内部多一层动作构造，收益是构造参数从 15 个函数降到 1 个对象。
 * **这是有意的取舍，不要「简化」成直接 import 转移函数模块。**
 */

import type { SeatInvitation, SeatRequest, VoiceRoomSnapshot } from './state';
import {
  acceptInvitation,
  activateSeat,
  approveRequest,
  banMember,
  cancelSeatRequest,
  createInitialSnapshot,
  inviteToSeat,
  kickMember,
  leaveSeat,
  rejectInvitation,
  rejectRequest,
  requestSeat,
  rollbackJoiningSeat,
  setSeatMuted,
  updateAnnouncement,
} from './transitions';

/**
 * 房间动作。语义方法在内部构造它，再交给 `reduce`。
 *
 * 静音与下麦**刻意分成语义不同的动作**：房主侧是强制（对他人），
 * 听众侧是自主（对自己）。不要合并成一个动作再靠「目标 uid 是否为空」
 * 区分 —— 那是隐式分支（见 spec「角色 RTM 单文件的契约」）。
 */
export type VoiceRoomAction =
  | { type: 'seat.request'; request: SeatRequest }
  | { type: 'seat.request.cancel'; userId: string }
  | { type: 'seat.approve'; actorId: string; requestId: string }
  | { type: 'seat.reject'; actorId: string; requestId: string }
  | { type: 'seat.invite'; actorId: string; invitation: SeatInvitation }
  | { type: 'seat.invite.accept'; userId: string }
  | { type: 'seat.invite.reject'; userId: string }
  | { type: 'seat.activate'; seatId: string; userId: string }
  | { type: 'seat.rollback'; seatId: string; userId: string }
  | { type: 'seat.mute'; userId: string; muted: boolean }
  | { type: 'seat.leave'; userId: string }
  | { type: 'member.kick'; actorId: string; userId: string }
  | { type: 'member.ban'; actorId: string; userId: string }
  | { type: 'announcement.update'; actorId: string; text: string };

export interface VoiceRoomStateAdapter {
  createInitial(hostUserId: string, hostDisplayName?: string): VoiceRoomSnapshot;
  /** 无效输入返回 `undefined`，兜底策略归调用方。 */
  parseStored(raw: string | undefined): VoiceRoomSnapshot | undefined;
  reduce(snapshot: VoiceRoomSnapshot, action: VoiceRoomAction): VoiceRoomSnapshot;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 校验归一。**无效返回 `undefined`，不返回兜底快照** ——
 * 归一函数只回答「这份数据能不能用」，由调用方决定兜底策略（见 spec）。
 */
function parseStored(raw: string | undefined): VoiceRoomSnapshot | undefined {
  if (!raw) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // 无效数据是常态而非异常：Storage 里可能残留旧版本或被手工改坏的值。
    return undefined;
  }

  if (!isPlainObject(parsed)) return undefined;

  const { revision, hostUserId, announcement, seats, queue, invitation, bannedUserIds } = parsed;

  if (typeof revision !== 'number' || !Number.isFinite(revision)) return undefined;
  if (typeof hostUserId !== 'string' || !hostUserId) return undefined;
  if (typeof announcement !== 'string') return undefined;
  if (!isPlainObject(seats)) return undefined;
  if (!Array.isArray(queue)) return undefined;
  if (invitation !== null && !isPlainObject(invitation)) return undefined;
  if (!Array.isArray(bannedUserIds)) return undefined;

  return parsed as unknown as VoiceRoomSnapshot;
}

/**
 * 动作 → 转移函数的分发。纯函数，不做 I/O。
 *
 * 领域错误（越权、状态非法）照常抛出 —— `reduce` 不吞规则违规，
 * 由调用方决定是回错误事件还是重试。
 */
function reduce(snapshot: VoiceRoomSnapshot, action: VoiceRoomAction): VoiceRoomSnapshot {
  switch (action.type) {
    case 'seat.request':
      return requestSeat(snapshot, action.request);
    case 'seat.request.cancel':
      return cancelSeatRequest(snapshot, action.userId);
    case 'seat.approve':
      return approveRequest(snapshot, action.actorId, action.requestId);
    case 'seat.reject':
      return rejectRequest(snapshot, action.actorId, action.requestId);
    case 'seat.invite':
      return inviteToSeat(snapshot, action.actorId, action.invitation);
    case 'seat.invite.accept':
      return acceptInvitation(snapshot, action.userId);
    case 'seat.invite.reject':
      return rejectInvitation(snapshot, action.userId);
    case 'seat.activate':
      return activateSeat(snapshot, action.seatId, action.userId);
    case 'seat.rollback':
      return rollbackJoiningSeat(snapshot, action.seatId, action.userId);
    case 'seat.mute':
      return setSeatMuted(snapshot, action.userId, action.muted);
    case 'seat.leave':
      return leaveSeat(snapshot, action.userId);
    case 'member.kick':
      return kickMember(snapshot, action.actorId, action.userId);
    case 'member.ban':
      return banMember(snapshot, action.actorId, action.userId);
    case 'announcement.update':
      return updateAnnouncement(snapshot, action.actorId, action.text);
  }
}

export const voiceRoomStateAdapter: VoiceRoomStateAdapter = {
  createInitial: createInitialSnapshot,
  parseStored,
  reduce,
};
