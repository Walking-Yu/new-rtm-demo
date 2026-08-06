import { createEnvelope, createMessageDeduper, parseEnvelope } from '../domain/protocol';
import {
  acceptInvitation,
  activateSeat,
  approveRequest,
  banMember,
  cancelSeatRequest,
  inviteToSeat,
  kickMember,
  leaveSeat,
  rejectInvitation,
  rejectRequest,
  requestSeat,
  rollbackJoiningSeat,
  setSeatMuted,
  updateAnnouncement,
} from '../domain/transitions';
import type { EndpointRole, VoiceRoomSnapshot } from '../domain/types';
import { RoomStateRepository } from './RoomStateRepository';
import type { ConnectionState, RtmPort, RtmPortHandlers } from './ports/RtmPort';
import type { RtcPort, RtcPortHandlers } from './ports/RtcPort';

export interface EndpointSettings {
  role: EndpointRole;
  appId: string;
  roomId: string;
  userId: string;
  displayName: string;
  rtmToken?: string;
  rtcToken?: string;
}

export interface TimelineEvent {
  id: string;
  kind: 'connection' | 'sent' | 'received' | 'ack' | 'state' | 'error';
  text: string;
  timestamp: number;
}

export interface InteractionEvent {
  id: string;
  type: 'chat' | 'emoji' | 'gift';
  senderId: string;
  displayName: string;
  value: string;
  timestamp: number;
}

export interface VoiceRoomClientState {
  rtmState: ConnectionState;
  rtcState: ConnectionState;
  hydrating: boolean;
  snapshot: VoiceRoomSnapshot;
  onlineUsers: string[];
  interactions: InteractionEvent[];
  events: TimelineEvent[];
  remoteAudioUsers: string[];
  volumeLevels: Record<string, number>;
  exitReason?: 'kicked' | 'banned';
}

export type VoiceRoomCommand =
  | { type: 'seat.request'; seatId: string }
  | { type: 'seat.request.cancel' }
  | { type: 'seat.request.approve'; requestId: string }
  | { type: 'seat.request.reject'; requestId: string }
  | { type: 'seat.invite'; userId: string; displayName: string; seatId: string }
  | { type: 'seat.invite.accept' }
  | { type: 'seat.invite.reject' }
  | { type: 'seat.mute'; muted: boolean; userId?: string }
  | { type: 'seat.leave'; userId?: string }
  | { type: 'member.kick'; userId: string }
  | { type: 'member.ban'; userId: string }
  | { type: 'chat.send'; text: string }
  | { type: 'emoji.send'; emoji: string }
  | { type: 'gift.send'; giftId: 'rose' | 'applause' | 'rocket' }
  | { type: 'announcement.update'; text: string };

interface VoiceRoomClientOptions {
  rtm: RtmPort;
  rtc: RtcPort;
  settings: EndpointSettings;
  initialSnapshot: VoiceRoomSnapshot;
  commandTimeoutMs?: number;
}

export class VoiceRoomClient {
  private readonly repository: RoomStateRepository;
  private readonly deduper = createMessageDeduper();
  private readonly listeners = new Set<(state: VoiceRoomClientState) => void>();
  private readonly ackTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private state: VoiceRoomClientState;
  private connected = false;
  private rtmWasReconnecting = false;

  constructor(private readonly options: VoiceRoomClientOptions) {
    this.repository = new RoomStateRepository(
      options.rtm,
      options.settings.roomId,
      options.initialSnapshot,
    );
    this.state = {
      rtmState: 'disconnected',
      rtcState: 'disconnected',
      hydrating: false,
      snapshot: options.initialSnapshot,
      onlineUsers: [],
      interactions: [],
      events: [],
      remoteAudioUsers: [],
      volumeLevels: {},
    };
  }

  getState(): VoiceRoomClientState {
    return this.state;
  }

  subscribe(listener: (state: VoiceRoomClientState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    const { rtm, rtc, settings } = this.options;
    let rtmConnected = false;
    let rtmSubscribed = false;
    let rtcJoined = false;
    this.patch({ hydrating: true, rtmState: 'connecting', rtcState: 'connecting', exitReason: undefined });
    rtm.registerEvents(this.createRtmHandlers());
    rtc.registerEvents(this.createRtcHandlers());
    try {
      await rtm.connect({ appId: settings.appId, userId: settings.userId, token: settings.rtmToken });
      rtmConnected = true;
      this.patch({ rtmState: 'connected' });
      await rtm.subscribe(settings.roomId);
      rtmSubscribed = true;
      const [onlineUsers, snapshot] = await Promise.all([
        rtm.getOnlineUsers(settings.roomId),
        this.repository.read(),
      ]);
      if (snapshot.bannedUserIds.includes(settings.userId)) throw new Error('该用户已被房间封禁');
      this.patch({ onlineUsers, snapshot });
      await rtc.join({
        appId: settings.appId,
        roomId: settings.roomId,
        userId: settings.userId,
        token: settings.rtcToken,
      });
      rtcJoined = true;
      this.patch({ rtcState: 'connected' });
      if (settings.role === 'host') {
        await rtc.publishMicrophone();
        if (snapshot.seats['seat-0']?.status === 'joining') {
          const active = await this.repository.mutate((current) =>
            activateSeat(current, 'seat-0', settings.userId),
          );
          this.patch({ snapshot: active });
        }
      } else {
        const ownSeat = Object.values(snapshot.seats).find((seat) => seat.userId === settings.userId);
        if (ownSeat && (ownSeat.status === 'active' || ownSeat.status === 'muted')) {
          await rtc.publishMicrophone();
          if (ownSeat.muted) await rtc.setMicrophoneMuted(true);
        }
      }
      this.connected = true;
      this.patch({ hydrating: false });
      this.addEvent('connection', 'RTM 与 RTC 已连接');
    } catch (error) {
      await this.rollbackConnect({ rtmConnected, rtmSubscribed, rtcJoined });
      this.patch({ hydrating: false, rtmState: 'failed', rtcState: 'failed' });
      this.addEvent('error', this.errorMessage(error));
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected && this.state.rtmState === 'disconnected' && this.state.rtcState === 'disconnected') return;
    this.connected = false;
    try {
      await this.options.rtc.leave();
    } finally {
      try {
        await this.options.rtm.unsubscribe(this.options.settings.roomId);
      } finally {
        await this.options.rtm.disconnect();
        this.patch({ rtmState: 'disconnected', rtcState: 'disconnected', hydrating: false });
      }
    }
  }

  private async rollbackConnect(stages: {
    rtmConnected: boolean;
    rtmSubscribed: boolean;
    rtcJoined: boolean;
  }): Promise<void> {
    this.connected = false;
    if (stages.rtcJoined) {
      try {
        await this.options.rtc.leave();
      } catch {
        // Preserve the original connection failure.
      }
    }
    if (stages.rtmSubscribed) {
      try {
        await this.options.rtm.unsubscribe(this.options.settings.roomId);
      } catch {
        // Continue releasing the RTM session.
      }
    }
    if (stages.rtmConnected) {
      try {
        await this.options.rtm.disconnect();
      } catch {
        // Preserve the original connection failure.
      }
    }
  }

  async execute(command: VoiceRoomCommand): Promise<void> {
    if (!this.connected) {
      this.addEvent('error', '请先连接 RTM 与 RTC');
      return;
    }
    try {
      switch (command.type) {
        case 'seat.request': await this.submitSeatRequest(command.seatId); break;
        case 'seat.request.cancel': await this.cancelRequest(); break;
        case 'seat.request.approve': await this.approveSeatRequest(command.requestId); break;
        case 'seat.request.reject': await this.rejectSeatRequest(command.requestId); break;
        case 'seat.invite': await this.inviteMember(command); break;
        case 'seat.invite.accept': await this.acceptCurrentInvitation(); break;
        case 'seat.invite.reject': await this.rejectCurrentInvitation(); break;
        case 'seat.mute': await this.changeMute(command.muted, command.userId); break;
        case 'seat.leave': await this.removeFromSeat(command.userId); break;
        case 'member.kick': await this.governMember('member.kick', command.userId); break;
        case 'member.ban': await this.governMember('member.ban', command.userId); break;
        case 'chat.send': await this.sendSocial('chat.message', 'chat', command.text); break;
        case 'emoji.send': await this.sendSocial('emoji.reaction', 'emoji', command.emoji); break;
        case 'gift.send': await this.sendSocial('gift.sent', 'gift', command.giftId); break;
        case 'announcement.update': await this.updateRoomAnnouncement(command.text); break;
      }
    } catch (error) {
      this.addEvent('error', this.errorMessage(error));
    }
  }

  destroy(): void {
    this.connected = false;
    this.clearAckTimers();
    this.listeners.clear();
    this.deduper.clear();
  }

  private async submitSeatRequest(seatId: string): Promise<void> {
    const { settings, rtm } = this.options;
    if (settings.role !== 'audience') throw new Error('只有听众可以申请上麦');
    const request = {
      id: crypto.randomUUID(),
      userId: settings.userId,
      displayName: settings.displayName,
      seatId,
      createdAt: Date.now(),
    };
    const snapshot = await this.repository.mutate((current) => requestSeat(current, request));
    this.patch({ snapshot });
    await rtm.publishChannel(settings.roomId, JSON.stringify(createEnvelope({
      type: 'seat.request',
      roomId: settings.roomId,
      senderId: settings.userId,
      targetId: snapshot.hostUserId,
      requiresAck: true,
      payload: { requestId: request.id, seatId },
    })));
    this.addEvent('sent', `已申请 ${seatId.replace('seat-', '')} 号麦位`);
  }

  private async approveSeatRequest(requestId: string): Promise<void> {
    const { settings, rtm } = this.options;
    if (settings.role !== 'host') throw new Error('只有房主可以同意排麦');
    const request = this.state.snapshot.queue.find((item) => item.id === requestId);
    if (!request) throw new Error('排麦申请不存在');
    const snapshot = await this.repository.mutate((current) =>
      approveRequest(current, settings.userId, requestId),
    );
    this.patch({ snapshot });
    await rtm.publishUser(request.userId, JSON.stringify(createEnvelope({
      type: 'seat.approved',
      roomId: settings.roomId,
      senderId: settings.userId,
      targetId: request.userId,
      requiresAck: true,
      payload: { requestId, seatId: request.seatId },
    })));
    this.addEvent('sent', `已同意 ${request.displayName} 上麦`);
  }

  private async cancelRequest(): Promise<void> {
    const { settings, rtm } = this.options;
    if (settings.role !== 'audience') throw new Error('只有听众可以取消排麦');
    const snapshot = await this.repository.mutate((current) =>
      cancelSeatRequest(current, settings.userId),
    );
    this.patch({ snapshot });
    await rtm.publishChannel(settings.roomId, JSON.stringify(createEnvelope({
      type: 'seat.request.cancelled', roomId: settings.roomId, senderId: settings.userId,
      targetId: snapshot.hostUserId, requiresAck: false, payload: {},
    })));
    this.addEvent('sent', '已取消排麦申请');
  }

  private async rejectSeatRequest(requestId: string): Promise<void> {
    const { settings, rtm } = this.options;
    if (settings.role !== 'host') throw new Error('只有房主可以拒绝排麦');
    const request = this.state.snapshot.queue.find((item) => item.id === requestId);
    if (!request) throw new Error('排麦申请不存在');
    const snapshot = await this.repository.mutate((current) =>
      rejectRequest(current, settings.userId, requestId),
    );
    this.patch({ snapshot });
    await rtm.publishUser(request.userId, JSON.stringify(createEnvelope({
      type: 'seat.rejected', roomId: settings.roomId, senderId: settings.userId,
      targetId: request.userId, requiresAck: false, payload: { requestId },
    })));
    this.addEvent('sent', `已拒绝 ${request.displayName} 的排麦申请`);
  }

  private async inviteMember(command: Extract<VoiceRoomCommand, { type: 'seat.invite' }>): Promise<void> {
    const { settings, rtm } = this.options;
    if (settings.role !== 'host') throw new Error('只有房主可以邀请上麦');
    const invitation = {
      id: crypto.randomUUID(),
      hostUserId: settings.userId,
      userId: command.userId,
      displayName: command.displayName,
      seatId: command.seatId,
      createdAt: Date.now(),
    };
    const snapshot = await this.repository.mutate((current) =>
      inviteToSeat(current, settings.userId, invitation),
    );
    this.patch({ snapshot });
    await rtm.publishUser(command.userId, JSON.stringify(createEnvelope({
      type: 'seat.invited', roomId: settings.roomId, senderId: settings.userId,
      targetId: command.userId, requiresAck: true,
      payload: { invitationId: invitation.id, seatId: command.seatId },
    })));
    this.addEvent('sent', `已邀请 ${command.displayName} 上麦`);
  }

  private async acceptCurrentInvitation(): Promise<void> {
    const { settings } = this.options;
    if (settings.role !== 'audience') throw new Error('只有听众可以接受邀请');
    const invitation = this.state.snapshot.invitation;
    if (!invitation || invitation.userId !== settings.userId) throw new Error('没有待处理的上麦邀请');
    const joining = await this.repository.mutate((current) => acceptInvitation(current, settings.userId));
    this.patch({ snapshot: joining });
    await this.publishReservedSeat(invitation.seatId, invitation.hostUserId, '邀请已接受');
  }

  private async rejectCurrentInvitation(): Promise<void> {
    const { settings, rtm } = this.options;
    if (settings.role !== 'audience') throw new Error('只有听众可以拒绝邀请');
    const invitation = this.state.snapshot.invitation;
    if (!invitation || invitation.userId !== settings.userId) throw new Error('没有待处理的上麦邀请');
    const snapshot = await this.repository.mutate((current) => rejectInvitation(current, settings.userId));
    this.patch({ snapshot });
    await rtm.publishUser(invitation.hostUserId, JSON.stringify(createEnvelope({
      type: 'seat.invitation.rejected', roomId: settings.roomId, senderId: settings.userId,
      targetId: invitation.hostUserId, requiresAck: false, payload: { invitationId: invitation.id },
    })));
    this.addEvent('sent', '已拒绝上麦邀请');
  }

  private async publishReservedSeat(seatId: string, targetId: string, eventText: string): Promise<void> {
    const { settings, rtc, rtm } = this.options;
    try {
      await rtc.publishMicrophone();
      const snapshot = await this.repository.mutate((current) => activateSeat(current, seatId, settings.userId));
      this.patch({ snapshot });
      await rtm.publishChannel(settings.roomId, JSON.stringify(createEnvelope({
        type: 'seat.media-ready', roomId: settings.roomId, senderId: settings.userId,
        targetId, requiresAck: false, payload: { seatId },
      })));
      this.addEvent('state', `${eventText}，麦克风已发布`);
    } catch (error) {
      const snapshot = await this.repository.mutate((current) =>
        rollbackJoiningSeat(current, seatId, settings.userId),
      );
      this.patch({ snapshot });
      throw new Error(`上麦失败，麦位已释放：${this.errorMessage(error)}`);
    }
  }

  private async changeMute(muted: boolean, targetUserId?: string): Promise<void> {
    const { settings, rtc, rtm } = this.options;
    if (targetUserId && targetUserId !== settings.userId) {
      if (settings.role !== 'host') throw new Error('只有房主可以控制其他成员');
      await this.sendGovernanceCommand(targetUserId, 'seat.mute.command', { muted });
      return;
    }
    await rtc.setMicrophoneMuted(muted);
    const snapshot = await this.repository.mutate((current) =>
      setSeatMuted(current, settings.userId, muted),
    );
    this.patch({ snapshot });
    await rtm.publishChannel(settings.roomId, JSON.stringify(createEnvelope({
      type: 'seat.mute.changed', roomId: settings.roomId, senderId: settings.userId,
      requiresAck: false, payload: { muted },
    })));
    this.addEvent('state', muted ? '麦克风已静音' : '麦克风已解除静音');
  }

  private async removeFromSeat(targetUserId?: string): Promise<void> {
    const { settings, rtc, rtm } = this.options;
    if (targetUserId && targetUserId !== settings.userId) {
      if (settings.role !== 'host') throw new Error('只有房主可以强制成员下麦');
      await this.sendGovernanceCommand(targetUserId, 'seat.leave.command', {});
      return;
    }
    if (settings.role === 'host') throw new Error('房主不能通过此操作离开主持位');
    await rtc.unpublishMicrophone();
    const snapshot = await this.repository.mutate((current) => leaveSeat(current, settings.userId));
    this.patch({ snapshot });
    await rtm.publishChannel(settings.roomId, JSON.stringify(createEnvelope({
      type: 'seat.left', roomId: settings.roomId, senderId: settings.userId,
      requiresAck: false, payload: {},
    })));
    this.addEvent('state', '已主动下麦');
  }

  private async governMember(type: 'member.kick' | 'member.ban', userId: string): Promise<void> {
    const { settings } = this.options;
    if (settings.role !== 'host') throw new Error('只有房主可以治理成员');
    const snapshot = await this.repository.mutate((current) =>
      type === 'member.ban'
        ? banMember(current, settings.userId, userId)
        : kickMember(current, settings.userId, userId),
    );
    this.patch({ snapshot });
    await this.sendGovernanceCommand(userId, type, {});
    this.addEvent('sent', type === 'member.ban' ? '封禁命令已发送' : '踢出命令已发送');
  }

  private async sendGovernanceCommand(
    userId: string,
    type: 'seat.mute.command' | 'seat.leave.command' | 'member.kick' | 'member.ban',
    payload: Record<string, unknown>,
  ): Promise<void> {
    const { settings, rtm } = this.options;
    const envelope = createEnvelope({
      type, roomId: settings.roomId, senderId: settings.userId, targetId: userId,
      requiresAck: true, payload,
    });
    await rtm.publishUser(userId, JSON.stringify(envelope));
    const timeout = setTimeout(() => {
      this.ackTimers.delete(envelope.messageId);
      this.addEvent('error', `${type} 执行 ACK 超时`);
    }, this.options.commandTimeoutMs ?? 6000);
    this.ackTimers.set(envelope.messageId, timeout);
  }

  private async sendSocial(
    messageType: 'chat.message' | 'emoji.reaction' | 'gift.sent',
    interactionType: InteractionEvent['type'],
    rawValue: string,
  ): Promise<void> {
    const { settings, rtm } = this.options;
    const value = rawValue.trim();
    if (!value) throw new Error('互动内容不能为空');
    const envelope = createEnvelope({
      type: messageType, roomId: settings.roomId, senderId: settings.userId,
      requiresAck: false, payload: { value, displayName: settings.displayName },
    });
    await rtm.publishChannel(settings.roomId, JSON.stringify(envelope));
    this.deduper.accept(envelope.messageId);
    this.appendInteraction({
      id: envelope.messageId,
      type: interactionType,
      senderId: settings.userId,
      displayName: settings.displayName,
      value,
      timestamp: envelope.sentAt,
    });
    this.addEvent('sent', `${interactionType} 互动已广播`);
  }

  private async updateRoomAnnouncement(text: string): Promise<void> {
    const { settings } = this.options;
    if (settings.role !== 'host') throw new Error('只有房主可以更新公告');
    const snapshot = await this.repository.mutate((current) =>
      updateAnnouncement(current, settings.userId, text),
    );
    this.patch({ snapshot });
    this.addEvent('state', '房间公告已更新');
  }

  private createRtmHandlers(): RtmPortHandlers {
    return {
      connection: (state, reason) => {
        this.patch({ rtmState: state });
        if (state === 'reconnecting') {
          this.rtmWasReconnecting = true;
          this.addEvent('connection', 'RTM 正在重连');
        }
        if (state === 'connected' && this.connected && this.rtmWasReconnecting) {
          this.rtmWasReconnecting = false;
          void this.rehydrateAfterReconnect();
        }
        if (state === 'failed') this.addEvent('error', reason || 'RTM 连接失败');
      },
      message: (event) => {
        void this.handleMessage(event.message).catch((error) => this.addEvent('error', this.errorMessage(error)));
      },
      presence: (event) => {
        this.addEvent('received', `Presence 更新：${event.eventType}`);
        void this.options.rtm.getOnlineUsers(this.options.settings.roomId)
          .then((onlineUsers) => this.patch({ onlineUsers }))
          .catch((error) => this.addEvent('error', `Presence 恢复失败：${this.errorMessage(error)}`));
      },
      storage: (event) => {
        const snapshot = this.repository.parseSnapshot(event.values['voice-room-state']);
        if (snapshot.revision >= this.state.snapshot.revision) this.patch({ snapshot });
      },
      tokenExpiring: () => this.addEvent('error', 'RTM Token 即将过期'),
    };
  }

  private createRtcHandlers(): RtcPortHandlers {
    return {
      connection: (rtcState, reason) => {
        this.patch({ rtcState });
        if (rtcState === 'failed') this.addEvent('error', reason || 'RTC 连接失败');
      },
      remoteAudioPublished: (userId) => {
        this.patch({ remoteAudioUsers: Array.from(new Set([...this.state.remoteAudioUsers, userId])) });
        this.addEvent('received', `${userId} 的远端音频已订阅并播放`);
      },
      remoteAudioUnpublished: (userId) => {
        this.patch({ remoteAudioUsers: this.state.remoteAudioUsers.filter((id) => id !== userId) });
      },
      volume: (volumeLevels) => this.patch({ volumeLevels }),
    };
  }

  private async handleMessage(serialized: string): Promise<void> {
    const { settings, rtc, rtm } = this.options;
    const message = parseEnvelope(serialized, { roomId: settings.roomId, userId: settings.userId });
    if (!this.deduper.accept(message.messageId)) return;
    if (message.type === 'seat.approved' && settings.role === 'audience') {
      const seatId = typeof message.payload.seatId === 'string' ? message.payload.seatId : '';
      try {
        await this.publishReservedSeat(seatId, message.senderId, '排麦申请已通过');
      } catch (error) {
        this.addEvent('error', this.errorMessage(error));
      }
      return;
    }
    if (message.type === 'seat.mute.command' && settings.role === 'audience') {
      const muted = message.payload.muted === true;
      await rtc.setMicrophoneMuted(muted);
      const snapshot = await this.repository.mutate((current) => setSeatMuted(current, settings.userId, muted));
      this.patch({ snapshot });
      await this.sendExecutedAck(message.messageId, message.senderId);
      this.addEvent('state', muted ? '房主已将你静音' : '房主已解除你的静音');
      return;
    }
    if (message.type === 'seat.leave.command' && settings.role === 'audience') {
      await rtc.unpublishMicrophone();
      const snapshot = await this.repository.mutate((current) => leaveSeat(current, settings.userId));
      this.patch({ snapshot });
      await this.sendExecutedAck(message.messageId, message.senderId);
      this.addEvent('state', '房主已将你移出麦位');
      return;
    }
    if ((message.type === 'member.kick' || message.type === 'member.ban') && settings.role === 'audience') {
      await this.sendExecutedAck(message.messageId, message.senderId);
      this.patch({ exitReason: message.type === 'member.ban' ? 'banned' : 'kicked' });
      await this.disconnect();
      return;
    }
    if (message.type === 'command.ack' && settings.role === 'host') {
      const commandId = typeof message.payload.commandId === 'string' ? message.payload.commandId : '';
      const timer = this.ackTimers.get(commandId);
      if (timer) clearTimeout(timer);
      this.ackTimers.delete(commandId);
      this.addEvent('ack', '成员已执行治理命令');
      return;
    }
    const socialTypes: Record<string, InteractionEvent['type']> = {
      'chat.message': 'chat',
      'emoji.reaction': 'emoji',
      'gift.sent': 'gift',
    };
    const interactionType = socialTypes[message.type];
    if (interactionType) {
      const value = typeof message.payload.value === 'string' ? message.payload.value : '';
      const displayName = typeof message.payload.displayName === 'string' ? message.payload.displayName : message.senderId;
      if (value) {
        this.appendInteraction({
          id: message.messageId,
          type: interactionType,
          senderId: message.senderId,
          displayName,
          value,
          timestamp: message.sentAt,
        });
      }
      this.addEvent('received', `收到 ${interactionType} 互动`);
    }
  }

  private async sendExecutedAck(commandId: string, targetId: string): Promise<void> {
    const { settings, rtm } = this.options;
    await rtm.publishUser(targetId, JSON.stringify(createEnvelope({
      type: 'command.ack', roomId: settings.roomId, senderId: settings.userId,
      targetId, requiresAck: false, payload: { commandId, status: 'EXECUTED' },
    })));
  }

  private async rehydrateAfterReconnect(): Promise<void> {
    const { rtm, rtc, settings } = this.options;
    this.patch({ hydrating: true });
    try {
      await rtm.subscribe(settings.roomId);
      const [onlineUsers, snapshot] = await Promise.all([
        rtm.getOnlineUsers(settings.roomId),
        this.repository.read(),
      ]);
      this.patch({ onlineUsers, snapshot });
      if (snapshot.bannedUserIds.includes(settings.userId)) {
        this.patch({ exitReason: 'banned', hydrating: false });
        await this.disconnect();
        return;
      }

      const ownSeat = Object.values(snapshot.seats).find((seat) => seat.userId === settings.userId);
      if (settings.role === 'host' || ownSeat?.status === 'active' || ownSeat?.status === 'muted') {
        await rtc.publishMicrophone();
        if (ownSeat?.muted) await rtc.setMicrophoneMuted(true);
      } else {
        await rtc.unpublishMicrophone();
      }
      this.patch({ hydrating: false, rtmState: 'connected' });
      this.addEvent('connection', 'RTM 重连完成，房间状态已恢复');
    } catch (error) {
      this.patch({ hydrating: false, rtmState: 'failed' });
      this.addEvent('error', `RTM 重连恢复失败：${this.errorMessage(error)}`);
    }
  }

  private appendInteraction(event: InteractionEvent): void {
    this.patch({ interactions: [...this.state.interactions, event].slice(-100) });
  }

  private patch(next: Partial<VoiceRoomClientState>): void {
    this.state = { ...this.state, ...next };
    this.listeners.forEach((listener) => listener(this.state));
  }

  private addEvent(kind: TimelineEvent['kind'], text: string): void {
    this.patch({
      events: [
        ...this.state.events,
        { id: crypto.randomUUID(), kind, text, timestamp: Date.now() },
      ],
    });
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : '语聊房操作失败';
  }

  private clearAckTimers(): void {
    this.ackTimers.forEach((timer) => clearTimeout(timer));
    this.ackTimers.clear();
  }
}

export function createVoiceRoomClient(options: VoiceRoomClientOptions): VoiceRoomClient {
  return new VoiceRoomClient(options);
}
