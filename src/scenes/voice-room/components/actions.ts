/**
 * 手机内各区块共用的动作面。
 *
 * 组件只发意图，**不碰客户端也不碰 RTC** —— 顺序敏感的编排（先 RTC 再写 Storage、
 * 发布麦克风成功才激活麦位）全在 `orchestrator.ts` 里，组件调不到，也就改不坏。
 *
 * 全部返回 `void` 而不是 `Promise`：编排层已经把失败转成该端的 `lastError`，
 * 组件不需要 await，也不该自己 catch。
 */
export interface PhoneActions {
  // 房主端
  approveSeatRequest(requestId: string): void;
  rejectSeatRequest(requestId: string): void;
  inviteToSeat(seatId: string): void;
  forceMuteSeat(userId: string, muted: boolean): void;
  forceLeaveSeat(userId: string): void;
  kickMember(userId: string): void;
  banMember(userId: string): void;
  updateAnnouncement(text: string): void;

  // 听众端
  requestSeat(seatId: string): void;
  cancelSeatRequest(): void;
  acceptInvitation(): void;
  rejectInvitation(): void;
  setOwnMuted(muted: boolean): void;
  leaveOwnSeat(): void;

  // 两端都有
  sendChat(text: string): void;
  sendEmoji(emoji: string): void;
  sendGift(giftId: string): void;
}

/** 麦位号从 0 开始，展示时从 1 开始。 */
export function seatNumber(seatId: string): number {
  return Number(seatId.replace('seat-', '')) + 1;
}
