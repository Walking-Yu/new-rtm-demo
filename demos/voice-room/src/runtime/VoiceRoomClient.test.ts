import { describe, expect, it, vi } from 'vitest';
import { createEnvelope } from '../domain/protocol';
import {
  activateSeat,
  approveRequest,
  createInitialSnapshot,
  requestSeat,
  updateAnnouncement,
} from '../domain/transitions';
import type { SeatRequest } from '../domain/types';
import { createVoiceRoomClient, type EndpointSettings } from './VoiceRoomClient';
import { MemoryRtcPort } from './testing/MemoryRtcPort';
import { MemoryRtmPort } from './testing/MemoryRtmPort';

const hostSettings: EndpointSettings = {
  role: 'host',
  appId: 'app-id',
  roomId: 'room-1',
  userId: 'host-1',
  displayName: '房主',
  rtmToken: 'host-rtm-token',
  rtcToken: 'host-rtc-token',
};

const audienceSettings: EndpointSettings = {
  role: 'audience',
  appId: 'app-id',
  roomId: 'room-1',
  userId: 'audience-1',
  displayName: '听众',
  rtmToken: 'audience-rtm-token',
  rtcToken: 'audience-rtc-token',
};

describe('VoiceRoomClient', () => {
  it('registers events, hydrates RTM, joins RTC, and publishes the host microphone in order', async () => {
    const operations: string[] = [];
    const initial = createInitialSnapshot('host-1', '房主');
    const rtm = new MemoryRtmPort(initial, operations);
    rtm.onlineUsers = ['host-1', 'audience-1'];
    const rtc = new MemoryRtcPort(operations);
    const client = createVoiceRoomClient({ rtm, rtc, settings: hostSettings, initialSnapshot: initial });

    await client.connect();

    expect(operations.slice(0, 8)).toEqual([
      'rtm:register-events',
      'rtc:register-events',
      'rtm:connect:host-1',
      'rtm:subscribe:room-1',
      'presence:get:room-1',
      'storage:get',
      'rtc:join:room-1:host-1',
      'rtc:publish-microphone',
    ]);
    expect(client.getState()).toMatchObject({
      rtmState: 'connected',
      rtcState: 'connected',
      hydrating: false,
      onlineUsers: ['host-1', 'audience-1'],
    });
    expect(client.getState().snapshot.seats['seat-0'].status).toBe('active');
  });

  it('unsubscribes and disconnects RTM when hydration fails after subscribing', async () => {
    const operations: string[] = [];
    const initial = createInitialSnapshot('host-1');
    const rtm = new MemoryRtmPort(initial, operations);
    const rtc = new MemoryRtcPort(operations);
    const hydrationError = new Error('snapshot hydration failed');
    vi.spyOn(rtm, 'getChannelMetadata').mockRejectedValueOnce(hydrationError);
    const client = createVoiceRoomClient({ rtm, rtc, settings: audienceSettings, initialSnapshot: initial });

    await expect(client.connect()).rejects.toBe(hydrationError);

    expect(operations).toContain('rtm:unsubscribe:room-1');
    expect(operations).toContain('rtm:disconnect');
    expect(operations).not.toContain('rtc:leave');
    expect(operations.indexOf('rtm:unsubscribe:room-1')).toBeLessThan(
      operations.indexOf('rtm:disconnect'),
    );
    expect(client.getState()).toMatchObject({
      rtmState: 'failed', rtcState: 'failed', hydrating: false,
    });
  });

  it('rolls back RTC and RTM in reverse order without masking the connect failure', async () => {
    const operations: string[] = [];
    const initial = createInitialSnapshot('host-1', '房主');
    const rtm = new MemoryRtmPort(initial, operations);
    const rtc = new MemoryRtcPort(operations);
    const publishError = new Error('microphone publish failed');
    vi.spyOn(rtc, 'publishMicrophone').mockImplementationOnce(async () => {
      operations.push('rtc:publish-microphone');
      throw publishError;
    });
    vi.spyOn(rtm, 'unsubscribe').mockImplementationOnce(async (channelId) => {
      operations.push(`rtm:unsubscribe:${channelId}`);
      throw new Error('unsubscribe cleanup failed');
    });
    const client = createVoiceRoomClient({ rtm, rtc, settings: hostSettings, initialSnapshot: initial });

    await expect(client.connect()).rejects.toBe(publishError);

    const leaveIndex = operations.indexOf('rtc:leave');
    const unsubscribeIndex = operations.indexOf('rtm:unsubscribe:room-1');
    const disconnectIndex = operations.indexOf('rtm:disconnect');
    expect(leaveIndex).toBeGreaterThan(-1);
    expect(leaveIndex).toBeLessThan(unsubscribeIndex);
    expect(unsubscribeIndex).toBeLessThan(disconnectIndex);
    expect(client.getState()).toMatchObject({
      rtmState: 'failed', rtcState: 'failed', hydrating: false,
    });
  });

  it('persists an audience request and lets the host reserve its seat', async () => {
    const initial = createInitialSnapshot('host-1');
    const audienceRtm = new MemoryRtmPort(initial);
    const audience = createVoiceRoomClient({
      rtm: audienceRtm,
      rtc: new MemoryRtcPort(),
      settings: audienceSettings,
      initialSnapshot: initial,
    });
    await audience.connect();
    await audience.execute({ type: 'seat.request', seatId: 'seat-1' });
    const queuedSnapshot = audience.getState().snapshot;

    const hostRtm = new MemoryRtmPort(queuedSnapshot);
    const host = createVoiceRoomClient({
      rtm: hostRtm,
      rtc: new MemoryRtcPort(),
      settings: hostSettings,
      initialSnapshot: queuedSnapshot,
    });
    await host.connect();
    const requestId = host.getState().snapshot.queue[0].id;
    await host.execute({ type: 'seat.request.approve', requestId });

    expect(audienceRtm.operations).toContain('rtm:publish:channel:room-1:seat.request');
    expect(hostRtm.operations).toContain('rtm:publish:user:audience-1:seat.approved');
    expect(host.getState().snapshot.seats['seat-1']).toMatchObject({
      userId: 'audience-1', status: 'joining',
    });
  });

  it('lets an audience cancel a request and the host reject another request', async () => {
    const firstRequest: SeatRequest = {
      id: 'request-1', userId: 'audience-1', displayName: '听众', seatId: 'seat-1', createdAt: 1,
    };
    const queued = requestSeat(createInitialSnapshot('host-1'), firstRequest);
    const audienceRtm = new MemoryRtmPort(queued);
    const audience = createVoiceRoomClient({
      rtm: audienceRtm, rtc: new MemoryRtcPort(), settings: audienceSettings, initialSnapshot: queued,
    });
    await audience.connect();
    await audience.execute({ type: 'seat.request.cancel' });

    expect(audience.getState().snapshot.queue).toEqual([]);
    expect(audienceRtm.operations).toContain('rtm:publish:channel:room-1:seat.request.cancelled');

    const secondRequest = { ...firstRequest, id: 'request-2' };
    const queuedAgain = requestSeat(audience.getState().snapshot, secondRequest);
    const hostRtm = new MemoryRtmPort(queuedAgain);
    const host = createVoiceRoomClient({
      rtm: hostRtm, rtc: new MemoryRtcPort(), settings: hostSettings, initialSnapshot: queuedAgain,
    });
    await host.connect();
    await host.execute({ type: 'seat.request.reject', requestId: secondRequest.id });

    expect(host.getState().snapshot.queue).toEqual([]);
    expect(hostRtm.operations).toContain('rtm:publish:user:audience-1:seat.rejected');
  });

  it('activates an approved audience seat only after RTC microphone publication succeeds', async () => {
    const request: SeatRequest = {
      id: 'request-1', userId: 'audience-1', displayName: '听众', seatId: 'seat-1', createdAt: 1,
    };
    const joining = approveRequest(requestSeat(createInitialSnapshot('host-1'), request), 'host-1', request.id);
    const rtm = new MemoryRtmPort(joining);
    const rtc = new MemoryRtcPort();
    const client = createVoiceRoomClient({ rtm, rtc, settings: audienceSettings, initialSnapshot: joining });
    await client.connect();

    rtm.emitMessage(createEnvelope({
      type: 'seat.approved', roomId: 'room-1', senderId: 'host-1', targetId: 'audience-1',
      requiresAck: true, payload: { seatId: 'seat-1' },
    }), 'host-1');

    await vi.waitFor(() => expect(client.getState().snapshot.seats['seat-1'].status).toBe('active'));
    expect(rtc.operations).toContain('rtc:publish-microphone');
    expect(rtm.operations).toContain('rtm:publish:channel:room-1:seat.media-ready');
  });

  it('rolls back a joining audience seat when RTC microphone publication fails', async () => {
    const request: SeatRequest = {
      id: 'request-1', userId: 'audience-1', displayName: '听众', seatId: 'seat-1', createdAt: 1,
    };
    const joining = approveRequest(requestSeat(createInitialSnapshot('host-1'), request), 'host-1', request.id);
    const rtm = new MemoryRtmPort(joining);
    const rtc = new MemoryRtcPort();
    rtc.failPublish = true;
    const client = createVoiceRoomClient({ rtm, rtc, settings: audienceSettings, initialSnapshot: joining });
    await client.connect();

    rtm.emitMessage(createEnvelope({
      type: 'seat.approved', roomId: 'room-1', senderId: 'host-1', targetId: 'audience-1',
      requiresAck: true, payload: { seatId: 'seat-1' },
    }), 'host-1');

    await vi.waitFor(() => expect(client.getState().snapshot.seats['seat-1'].status).toBe('empty'));
    expect(client.getState().events.at(-1)).toMatchObject({ kind: 'error' });
  });

  it('persists a host invitation and activates the seat after the audience accepts', async () => {
    const initial = createInitialSnapshot('host-1');
    const hostRtm = new MemoryRtmPort(initial);
    const host = createVoiceRoomClient({
      rtm: hostRtm, rtc: new MemoryRtcPort(), settings: hostSettings, initialSnapshot: initial,
    });
    await host.connect();
    await host.execute({
      type: 'seat.invite', userId: 'audience-1', displayName: '听众', seatId: 'seat-2',
    });

    expect(host.getState().snapshot.invitation).toMatchObject({ userId: 'audience-1', seatId: 'seat-2' });
    expect(hostRtm.operations).toContain('rtm:publish:user:audience-1:seat.invited');

    const audienceRtm = new MemoryRtmPort(host.getState().snapshot);
    const audienceRtc = new MemoryRtcPort();
    const audience = createVoiceRoomClient({
      rtm: audienceRtm, rtc: audienceRtc, settings: audienceSettings,
      initialSnapshot: host.getState().snapshot,
    });
    await audience.connect();
    await audience.execute({ type: 'seat.invite.accept' });

    expect(audience.getState().snapshot.invitation).toBeNull();
    expect(audience.getState().snapshot.seats['seat-2'].status).toBe('active');
    expect(audienceRtc.operations).toContain('rtc:publish-microphone');
  });

  it('lets the invited audience reject a pending invitation', async () => {
    const initial = createInitialSnapshot('host-1');
    const host = createVoiceRoomClient({
      rtm: new MemoryRtmPort(initial), rtc: new MemoryRtcPort(), settings: hostSettings, initialSnapshot: initial,
    });
    await host.connect();
    await host.execute({
      type: 'seat.invite', userId: 'audience-1', displayName: '听众', seatId: 'seat-2',
    });

    const audienceRtm = new MemoryRtmPort(host.getState().snapshot);
    const audience = createVoiceRoomClient({
      rtm: audienceRtm, rtc: new MemoryRtcPort(), settings: audienceSettings,
      initialSnapshot: host.getState().snapshot,
    });
    await audience.connect();
    await audience.execute({ type: 'seat.invite.reject' });

    expect(audience.getState().snapshot.invitation).toBeNull();
    expect(audienceRtm.operations).toContain('rtm:publish:user:host-1:seat.invitation.rejected');
  });

  it('reconciles an active audience seat, then supports self mute and leave', async () => {
    const request: SeatRequest = {
      id: 'request-1', userId: 'audience-1', displayName: '听众', seatId: 'seat-1', createdAt: 1,
    };
    const active = activateSeat(
      approveRequest(requestSeat(createInitialSnapshot('host-1'), request), 'host-1', request.id),
      'seat-1',
      'audience-1',
    );
    const rtm = new MemoryRtmPort(active);
    const rtc = new MemoryRtcPort();
    const client = createVoiceRoomClient({ rtm, rtc, settings: audienceSettings, initialSnapshot: active });
    await client.connect();
    await client.execute({ type: 'seat.mute', muted: true });
    await client.execute({ type: 'seat.leave' });

    expect(rtc.operations).toContain('rtc:publish-microphone');
    expect(rtc.operations).toContain('rtc:mute:true');
    expect(rtc.operations).toContain('rtc:unpublish-microphone');
    expect(client.getState().snapshot.seats['seat-1'].status).toBe('empty');
  });

  it('applies a cooperative ban and sends a targeted governance command', async () => {
    const request: SeatRequest = {
      id: 'request-1', userId: 'audience-1', displayName: '听众', seatId: 'seat-1', createdAt: 1,
    };
    const active = activateSeat(
      approveRequest(requestSeat(createInitialSnapshot('host-1'), request), 'host-1', request.id),
      'seat-1',
      'audience-1',
    );
    const rtm = new MemoryRtmPort(active);
    const host = createVoiceRoomClient({
      rtm, rtc: new MemoryRtcPort(), settings: hostSettings, initialSnapshot: active,
    });
    await host.connect();
    await host.execute({ type: 'member.ban', userId: 'audience-1' });

    expect(host.getState().snapshot.bannedUserIds).toContain('audience-1');
    expect(host.getState().snapshot.seats['seat-1'].status).toBe('empty');
    expect(rtm.operations).toContain('rtm:publish:user:audience-1:member.ban');
  });

  it('executes a targeted mute command once and returns an EXECUTED ACK', async () => {
    const request: SeatRequest = {
      id: 'request-1', userId: 'audience-1', displayName: '听众', seatId: 'seat-1', createdAt: 1,
    };
    const active = activateSeat(
      approveRequest(requestSeat(createInitialSnapshot('host-1'), request), 'host-1', request.id),
      'seat-1',
      'audience-1',
    );
    const rtm = new MemoryRtmPort(active);
    const rtc = new MemoryRtcPort();
    const audience = createVoiceRoomClient({ rtm, rtc, settings: audienceSettings, initialSnapshot: active });
    await audience.connect();
    const command = createEnvelope({
      type: 'seat.mute.command', roomId: 'room-1', senderId: 'host-1', targetId: 'audience-1',
      requiresAck: true, payload: { muted: true },
    });

    rtm.emitMessage(command, 'host-1');
    rtm.emitMessage(command, 'host-1');

    await vi.waitFor(() => expect(audience.getState().snapshot.seats['seat-1'].status).toBe('muted'));
    expect(rtc.operations.filter((operation) => operation === 'rtc:mute:true')).toHaveLength(1);
    expect(rtm.operations.filter((operation) => operation === 'rtm:publish:user:host-1:command.ack')).toHaveLength(1);
  });

  it('publishes social events once and lets only the host update the announcement', async () => {
    const initial = createInitialSnapshot('host-1');
    const rtm = new MemoryRtmPort(initial);
    const client = createVoiceRoomClient({
      rtm, rtc: new MemoryRtcPort(), settings: audienceSettings, initialSnapshot: initial,
    });
    await client.connect();
    await client.execute({ type: 'chat.send', text: '大家晚上好' });
    await client.execute({ type: 'emoji.send', emoji: '👏' });
    await client.execute({ type: 'gift.send', giftId: 'rose' });

    expect(client.getState().interactions.map((event) => event.value)).toEqual(['大家晚上好', '👏', 'rose']);
    expect(rtm.operations).toContain('rtm:publish:channel:room-1:chat.message');
    expect(rtm.operations).toContain('rtm:publish:channel:room-1:emoji.reaction');
    expect(rtm.operations).toContain('rtm:publish:channel:room-1:gift.sent');

    const host = createVoiceRoomClient({
      rtm: new MemoryRtmPort(initial), rtc: new MemoryRtcPort(), settings: hostSettings, initialSnapshot: initial,
    });
    await host.connect();
    await host.execute({ type: 'announcement.update', text: '今晚 8 点主题派对' });
    expect(host.getState().snapshot.announcement).toBe('今晚 8 点主题派对');
  });

  it('deduplicates the same incoming social message', async () => {
    const initial = createInitialSnapshot('host-1');
    const rtm = new MemoryRtmPort(initial);
    const audience = createVoiceRoomClient({
      rtm, rtc: new MemoryRtcPort(), settings: audienceSettings, initialSnapshot: initial,
    });
    await audience.connect();
    const message = createEnvelope({
      type: 'chat.message', roomId: 'room-1', senderId: 'host-1', requiresAck: false,
      payload: { value: '同一条消息', displayName: '房主' },
    });

    rtm.emitMessage(message, 'host-1', 'MESSAGE');
    rtm.emitMessage(message, 'host-1', 'MESSAGE');

    await vi.waitFor(() => expect(audience.getState().interactions).toHaveLength(1));
    expect(audience.getState().interactions[0].value).toBe('同一条消息');
  });

  it('does not append a locally sent social message again when RTM echoes it', async () => {
    const initial = createInitialSnapshot('host-1');
    const rtm = new MemoryRtmPort(initial);
    const audience = createVoiceRoomClient({
      rtm, rtc: new MemoryRtcPort(), settings: audienceSettings, initialSnapshot: initial,
    });
    await audience.connect();
    await audience.execute({ type: 'chat.send', text: '只显示一次' });
    const sent = rtm.publishedMessages.find(({ message }) => JSON.parse(message).type === 'chat.message');

    rtm.emitMessage(sent!.message, 'audience-1', 'MESSAGE');

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(audience.getState().interactions).toHaveLength(1);
  });

  it('refreshes the complete online-user list after a Presence delta', async () => {
    const initial = createInitialSnapshot('host-1');
    const rtm = new MemoryRtmPort(initial);
    rtm.onlineUsers = ['host-1'];
    const host = createVoiceRoomClient({
      rtm, rtc: new MemoryRtcPort(), settings: hostSettings, initialSnapshot: initial,
    });
    await host.connect();
    rtm.onlineUsers = ['host-1', 'audience-1'];

    rtm.handlers.presence({
      channelName: 'room-1', eventType: 'REMOTE_JOIN', users: ['audience-1'], publisher: 'audience-1',
    });

    await vi.waitFor(() => expect(host.getState().onlineUsers).toEqual(['host-1', 'audience-1']));
  });

  it('resubscribes and reconciles Presence, Storage, and microphone state after RTM reconnects', async () => {
    const initial = createInitialSnapshot('host-1');
    const rtm = new MemoryRtmPort(initial);
    const rtc = new MemoryRtcPort();
    const audience = createVoiceRoomClient({ rtm, rtc, settings: audienceSettings, initialSnapshot: initial });
    await audience.connect();
    const updated = updateAnnouncement(initial, 'host-1', '重连后的公告');
    rtm.onlineUsers = ['host-1', 'audience-1'];
    rtm.channelSnapshot = {
      revision: 2,
      values: { 'voice-room-state': JSON.stringify(updated) },
    };

    rtm.handlers.connection('reconnecting');
    rtm.handlers.connection('connected');

    await vi.waitFor(() => expect(audience.getState().snapshot.announcement).toBe('重连后的公告'));
    expect(audience.getState().onlineUsers).toEqual(['host-1', 'audience-1']);
    expect(rtm.operations.filter((operation) => operation === 'rtm:subscribe:room-1')).toHaveLength(2);
    expect(rtc.operations).toContain('rtc:unpublish-microphone');
    expect(audience.getState().hydrating).toBe(false);
  });

  it('disconnects an audience that becomes banned while RTM is reconnecting', async () => {
    const initial = createInitialSnapshot('host-1');
    const rtm = new MemoryRtmPort(initial);
    const rtc = new MemoryRtcPort();
    const audience = createVoiceRoomClient({ rtm, rtc, settings: audienceSettings, initialSnapshot: initial });
    await audience.connect();
    rtm.channelSnapshot = {
      revision: 2,
      values: { 'voice-room-state': JSON.stringify({ ...initial, revision: 1, bannedUserIds: ['audience-1'] }) },
    };

    rtm.handlers.connection('reconnecting');
    rtm.handlers.connection('connected');

    await vi.waitFor(() => expect(audience.getState().exitReason).toBe('banned'));
    expect(rtc.operations).toContain('rtc:leave');
    expect(audience.getState()).toMatchObject({ rtmState: 'disconnected', rtcState: 'disconnected' });
  });

  it('disconnects and destroys idempotently', async () => {
    const initial = createInitialSnapshot('host-1');
    const rtm = new MemoryRtmPort(initial);
    const rtc = new MemoryRtcPort();
    const client = createVoiceRoomClient({ rtm, rtc, settings: audienceSettings, initialSnapshot: initial });
    await client.connect();

    await client.disconnect();
    await client.disconnect();
    client.destroy();
    client.destroy();

    expect(rtc.operations.filter((operation) => operation === 'rtc:leave')).toHaveLength(1);
    expect(rtm.operations.filter((operation) => operation === 'rtm:disconnect')).toHaveLength(1);
  });

  it('marks an unacknowledged governance command as timed out', async () => {
    vi.useFakeTimers();
    const initial = createInitialSnapshot('host-1');
    const client = createVoiceRoomClient({
      rtm: new MemoryRtmPort(initial), rtc: new MemoryRtcPort(), settings: hostSettings,
      initialSnapshot: initial, commandTimeoutMs: 1000,
    });
    await client.connect();
    await client.execute({ type: 'seat.mute', userId: 'audience-1', muted: true });
    await vi.advanceTimersByTimeAsync(1001);

    expect(client.getState().events.at(-1)).toMatchObject({ kind: 'error', text: expect.stringContaining('超时') });
    client.destroy();
    vi.useRealTimers();
  });
});
