import type { SeatInvitation, SeatRequest, SeatState, VoiceRoomSnapshot } from './state';

export type VoiceRoomDomainErrorCode =
  | 'HOST_ONLY'
  | 'BANNED'
  | 'SEAT_NOT_FOUND'
  | 'SEAT_OCCUPIED'
  | 'REQUEST_EXISTS'
  | 'REQUEST_NOT_FOUND'
  | 'INVITATION_EXISTS'
  | 'INVITATION_NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'MEMBER_NOT_SEATED';

export class VoiceRoomDomainError extends Error {
  constructor(public readonly code: VoiceRoomDomainErrorCode, message: string) {
    super(message);
    this.name = 'VoiceRoomDomainError';
  }
}

function emptySeat(seatId: string): SeatState {
  return { seatId, status: 'empty', muted: false };
}

function nextSnapshot(
  snapshot: VoiceRoomSnapshot,
  patch: Partial<Omit<VoiceRoomSnapshot, 'revision'>>,
): VoiceRoomSnapshot {
  return { ...snapshot, ...patch, revision: snapshot.revision + 1 };
}

function requireHost(snapshot: VoiceRoomSnapshot, actorId: string): void {
  if (snapshot.hostUserId !== actorId) {
    throw new VoiceRoomDomainError('HOST_ONLY', '只有房主可以执行此操作');
  }
}

function requireSeat(snapshot: VoiceRoomSnapshot, seatId: string): SeatState {
  const seat = snapshot.seats[seatId];
  if (!seat) throw new VoiceRoomDomainError('SEAT_NOT_FOUND', '麦位不存在');
  return seat;
}

function findSeatByUser(snapshot: VoiceRoomSnapshot, userId: string): SeatState | undefined {
  return Object.values(snapshot.seats).find((seat) => seat.userId === userId);
}

function ensureCanOccupy(snapshot: VoiceRoomSnapshot, userId: string, seatId: string): SeatState {
  if (snapshot.bannedUserIds.includes(userId)) {
    throw new VoiceRoomDomainError('BANNED', '该用户已被房间封禁');
  }
  if (findSeatByUser(snapshot, userId)) {
    throw new VoiceRoomDomainError('INVALID_TRANSITION', '该用户已经在麦位上');
  }
  const seat = requireSeat(snapshot, seatId);
  if (seat.status !== 'empty') {
    throw new VoiceRoomDomainError('SEAT_OCCUPIED', '麦位已被占用');
  }
  return seat;
}

export function createInitialSnapshot(hostUserId: string, hostDisplayName = '房主'): VoiceRoomSnapshot {
  const seats = Object.fromEntries(
    Array.from({ length: 4 }, (_, index) => {
      const seatId = `seat-${index}`;
      return [seatId, emptySeat(seatId)];
    }),
  );
  seats['seat-0'] = {
    seatId: 'seat-0',
    userId: hostUserId,
    displayName: hostDisplayName,
    status: 'joining',
    muted: false,
  };
  return {
    revision: 0,
    hostUserId,
    announcement: '欢迎来到语聊房',
    seats,
    queue: [],
    invitation: null,
    bannedUserIds: [],
  };
}

export function requestSeat(snapshot: VoiceRoomSnapshot, request: SeatRequest): VoiceRoomSnapshot {
  ensureCanOccupy(snapshot, request.userId, request.seatId);
  if (snapshot.queue.some((item) => item.userId === request.userId)) {
    throw new VoiceRoomDomainError('REQUEST_EXISTS', '该用户已经在排麦');
  }
  return nextSnapshot(snapshot, { queue: [...snapshot.queue, { ...request }] });
}

export function cancelSeatRequest(snapshot: VoiceRoomSnapshot, userId: string): VoiceRoomSnapshot {
  if (!snapshot.queue.some((item) => item.userId === userId)) {
    throw new VoiceRoomDomainError('REQUEST_NOT_FOUND', '该用户没有待处理的排麦申请');
  }
  return nextSnapshot(snapshot, { queue: snapshot.queue.filter((item) => item.userId !== userId) });
}

export function approveRequest(
  snapshot: VoiceRoomSnapshot,
  actorId: string,
  requestId: string,
): VoiceRoomSnapshot {
  requireHost(snapshot, actorId);
  const request = snapshot.queue.find((item) => item.id === requestId);
  if (!request) throw new VoiceRoomDomainError('REQUEST_NOT_FOUND', '排麦申请不存在');
  ensureCanOccupy(snapshot, request.userId, request.seatId);
  return nextSnapshot(snapshot, {
    queue: snapshot.queue.filter((item) => item.id !== requestId),
    seats: {
      ...snapshot.seats,
      [request.seatId]: {
        seatId: request.seatId,
        userId: request.userId,
        displayName: request.displayName,
        status: 'joining',
        muted: false,
      },
    },
  });
}

export function rejectRequest(
  snapshot: VoiceRoomSnapshot,
  actorId: string,
  requestId: string,
): VoiceRoomSnapshot {
  requireHost(snapshot, actorId);
  if (!snapshot.queue.some((item) => item.id === requestId)) {
    throw new VoiceRoomDomainError('REQUEST_NOT_FOUND', '排麦申请不存在');
  }
  return nextSnapshot(snapshot, { queue: snapshot.queue.filter((item) => item.id !== requestId) });
}

export function inviteToSeat(
  snapshot: VoiceRoomSnapshot,
  actorId: string,
  invitation: SeatInvitation,
): VoiceRoomSnapshot {
  requireHost(snapshot, actorId);
  ensureCanOccupy(snapshot, invitation.userId, invitation.seatId);
  if (snapshot.invitation) {
    throw new VoiceRoomDomainError('INVITATION_EXISTS', '已有待处理的上麦邀请');
  }
  return nextSnapshot(snapshot, { invitation: { ...invitation } });
}

export function acceptInvitation(snapshot: VoiceRoomSnapshot, userId: string): VoiceRoomSnapshot {
  const invitation = snapshot.invitation;
  if (!invitation || invitation.userId !== userId) {
    throw new VoiceRoomDomainError('INVITATION_NOT_FOUND', '上麦邀请不存在');
  }
  ensureCanOccupy(snapshot, invitation.userId, invitation.seatId);
  return nextSnapshot(snapshot, {
    invitation: null,
    seats: {
      ...snapshot.seats,
      [invitation.seatId]: {
        seatId: invitation.seatId,
        userId: invitation.userId,
        displayName: invitation.displayName,
        status: 'joining',
        muted: false,
      },
    },
  });
}

export function rejectInvitation(snapshot: VoiceRoomSnapshot, userId: string): VoiceRoomSnapshot {
  if (!snapshot.invitation || snapshot.invitation.userId !== userId) {
    throw new VoiceRoomDomainError('INVITATION_NOT_FOUND', '上麦邀请不存在');
  }
  return nextSnapshot(snapshot, { invitation: null });
}

export function activateSeat(
  snapshot: VoiceRoomSnapshot,
  seatId: string,
  userId: string,
): VoiceRoomSnapshot {
  const seat = requireSeat(snapshot, seatId);
  if (seat.status !== 'joining' || seat.userId !== userId) {
    throw new VoiceRoomDomainError('INVALID_TRANSITION', '麦位不处于等待媒体发布状态');
  }
  return nextSnapshot(snapshot, {
    seats: { ...snapshot.seats, [seatId]: { ...seat, status: 'active', muted: false } },
  });
}

export function rollbackJoiningSeat(
  snapshot: VoiceRoomSnapshot,
  seatId: string,
  userId: string,
): VoiceRoomSnapshot {
  const seat = requireSeat(snapshot, seatId);
  if (seat.status !== 'joining' || seat.userId !== userId) {
    throw new VoiceRoomDomainError('INVALID_TRANSITION', '没有可回滚的麦位占用');
  }
  return nextSnapshot(snapshot, {
    seats: { ...snapshot.seats, [seatId]: emptySeat(seatId) },
  });
}

export function setSeatMuted(
  snapshot: VoiceRoomSnapshot,
  userId: string,
  muted: boolean,
): VoiceRoomSnapshot {
  const seat = findSeatByUser(snapshot, userId);
  if (!seat || (seat.status !== 'active' && seat.status !== 'muted')) {
    throw new VoiceRoomDomainError('MEMBER_NOT_SEATED', '该用户当前不在麦上');
  }
  return nextSnapshot(snapshot, {
    seats: {
      ...snapshot.seats,
      [seat.seatId]: { ...seat, muted, status: muted ? 'muted' : 'active' },
    },
  });
}

export function leaveSeat(snapshot: VoiceRoomSnapshot, userId: string): VoiceRoomSnapshot {
  const seat = findSeatByUser(snapshot, userId);
  if (!seat) throw new VoiceRoomDomainError('MEMBER_NOT_SEATED', '该用户当前不在麦上');
  return nextSnapshot(snapshot, {
    seats: { ...snapshot.seats, [seat.seatId]: emptySeat(seat.seatId) },
  });
}

export function kickMember(
  snapshot: VoiceRoomSnapshot,
  actorId: string,
  userId: string,
): VoiceRoomSnapshot {
  requireHost(snapshot, actorId);
  const seat = findSeatByUser(snapshot, userId);
  return nextSnapshot(snapshot, {
    seats: seat ? { ...snapshot.seats, [seat.seatId]: emptySeat(seat.seatId) } : snapshot.seats,
    queue: snapshot.queue.filter((item) => item.userId !== userId),
    invitation: snapshot.invitation?.userId === userId ? null : snapshot.invitation,
  });
}

export function banMember(
  snapshot: VoiceRoomSnapshot,
  actorId: string,
  userId: string,
): VoiceRoomSnapshot {
  const kicked = kickMember(snapshot, actorId, userId);
  return {
    ...kicked,
    revision: snapshot.revision + 1,
    bannedUserIds: Array.from(new Set([...snapshot.bannedUserIds, userId])),
  };
}

export function updateAnnouncement(
  snapshot: VoiceRoomSnapshot,
  actorId: string,
  announcement: string,
): VoiceRoomSnapshot {
  requireHost(snapshot, actorId);
  const normalized = announcement.trim();
  if (!normalized) throw new VoiceRoomDomainError('INVALID_TRANSITION', '房间公告不能为空');
  return nextSnapshot(snapshot, { announcement: normalized });
}
