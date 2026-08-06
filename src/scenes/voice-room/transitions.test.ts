import { describe, expect, it } from 'vitest';
import {
  acceptInvitation,
  activateSeat,
  approveRequest,
  banMember,
  cancelSeatRequest,
  createInitialSnapshot,
  inviteToSeat,
  leaveSeat,
  rejectInvitation,
  rejectRequest,
  requestSeat,
  rollbackJoiningSeat,
  setSeatMuted,
  updateAnnouncement,
  VoiceRoomDomainError,
} from './transitions';
import type { SeatRequest } from './state';

const request: SeatRequest = {
  id: 'request-1',
  userId: 'audience-1',
  displayName: '听众小林',
  seatId: 'seat-1',
  createdAt: 100,
};

describe('voice-room transitions', () => {
  it('creates four seats with the host joining seat zero', () => {
    const snapshot = createInitialSnapshot('host-1', '房主阿声');

    expect(Object.keys(snapshot.seats)).toHaveLength(4);
    expect(snapshot.seats['seat-0']).toMatchObject({
      userId: 'host-1',
      displayName: '房主阿声',
      status: 'joining',
      muted: false,
    });
    expect(snapshot.seats['seat-1'].status).toBe('empty');
    expect(snapshot.seats['seat-3'].status).toBe('empty');
    expect(snapshot.seats['seat-4']).toBeUndefined();
  });

  it('moves a request through queue, approval, media activation, mute, and leave', () => {
    const initial = createInitialSnapshot('host-1', '房主');
    const queued = requestSeat(initial, request);
    const joining = approveRequest(queued, 'host-1', request.id);
    const active = activateSeat(joining, 'seat-1', 'audience-1');
    const muted = setSeatMuted(active, 'audience-1', true);
    const left = leaveSeat(muted, 'audience-1');

    expect(queued.queue).toEqual([request]);
    expect(joining.queue).toEqual([]);
    expect(joining.seats['seat-1'].status).toBe('joining');
    expect(active.seats['seat-1'].status).toBe('active');
    expect(muted.seats['seat-1']).toMatchObject({ status: 'muted', muted: true });
    expect(left.seats['seat-1'].status).toBe('empty');
    expect(left.revision).toBe(5);
    expect(initial.revision).toBe(0);
  });

  it('rolls back a joining seat when RTC publication fails', () => {
    const joining = approveRequest(requestSeat(createInitialSnapshot('host-1'), request), 'host-1', request.id);
    const rolledBack = rollbackJoiningSeat(joining, 'seat-1', 'audience-1');

    expect(rolledBack.seats['seat-1'].status).toBe('empty');
    expect(rolledBack.seats['seat-1'].userId).toBeUndefined();
  });

  it('supports invitation acceptance and rejection', () => {
    const initial = createInitialSnapshot('host-1');
    const invited = inviteToSeat(initial, 'host-1', {
      id: 'invite-1',
      hostUserId: 'host-1',
      userId: 'audience-1',
      displayName: '听众',
      seatId: 'seat-2',
      createdAt: 200,
    });

    expect(acceptInvitation(invited, 'audience-1').seats['seat-2'].status).toBe('joining');
    expect(rejectInvitation(invited, 'audience-1').invitation).toBeNull();
  });

  it('lets only the host reject requests, update announcements, and ban members', () => {
    const active = activateSeat(
      approveRequest(requestSeat(createInitialSnapshot('host-1'), request), 'host-1', request.id),
      'seat-1',
      'audience-1',
    );
    const announced = updateAnnouncement(active, 'host-1', '今晚 8 点主题派对');
    const banned = banMember(announced, 'host-1', 'audience-1');

    expect(announced.announcement).toBe('今晚 8 点主题派对');
    expect(banned.bannedUserIds).toContain('audience-1');
    expect(banned.seats['seat-1'].status).toBe('empty');
    expect(() => updateAnnouncement(active, 'audience-1', '伪造公告')).toThrow(VoiceRoomDomainError);
    expect(() => rejectRequest(requestSeat(createInitialSnapshot('host-1'), request), 'audience-1', request.id)).toThrow('只有房主');
  });

  it('rejects duplicate requests, occupied seats, banned users, and invalid cancellation', () => {
    const queued = requestSeat(createInitialSnapshot('host-1'), request);
    expect(() => requestSeat(queued, request)).toThrow('已经在排麦');

    const active = activateSeat(approveRequest(queued, 'host-1', request.id), 'seat-1', 'audience-1');
    const competing = { ...request, id: 'request-2', userId: 'audience-2' };
    expect(() => requestSeat(active, competing)).toThrow('麦位已被占用');

    const banned = banMember(active, 'host-1', 'audience-1');
    expect(() => requestSeat(banned, request)).toThrow('已被房间封禁');
    expect(() => cancelSeatRequest(banned, 'missing')).toThrow('没有待处理的排麦申请');
  });
});
