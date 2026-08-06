import type { VoiceRoomSnapshot } from '../../domain/types';
import type {
  ChannelSnapshot,
  RtmCredentials,
  RtmMessageEvent,
  RtmPort,
  RtmPortHandlers,
  SetMetadataOptions,
} from '../ports/RtmPort';

const noopHandlers: RtmPortHandlers = {
  connection: () => undefined,
  message: () => undefined,
  presence: () => undefined,
  storage: () => undefined,
  tokenExpiring: () => undefined,
};

export class MemoryRtmPort implements RtmPort {
  handlers = noopHandlers;
  onlineUsers: string[] = [];
  publishedMessages: Array<{ destination: string; message: string }> = [];
  failSet = false;
  channelSnapshot: ChannelSnapshot;

  constructor(
    snapshot: VoiceRoomSnapshot,
    public readonly operations: string[] = [],
  ) {
    this.channelSnapshot = {
      revision: 1,
      values: { 'voice-room-state': JSON.stringify(snapshot) },
    };
  }

  registerEvents(handlers: RtmPortHandlers) {
    this.operations.push('rtm:register-events');
    this.handlers = handlers;
  }
  async connect(credentials: RtmCredentials) {
    this.operations.push(`rtm:connect:${credentials.userId}`);
  }
  async disconnect() { this.operations.push('rtm:disconnect'); }
  async subscribe(channelId: string) { this.operations.push(`rtm:subscribe:${channelId}`); }
  async unsubscribe(channelId: string) { this.operations.push(`rtm:unsubscribe:${channelId}`); }
  async publishChannel(channelId: string, message: string) {
    const envelope = JSON.parse(message) as { type: string };
    this.operations.push(`rtm:publish:channel:${channelId}:${envelope.type}`);
    this.publishedMessages.push({ destination: channelId, message });
  }
  async publishUser(userId: string, message: string) {
    const envelope = JSON.parse(message) as { type: string };
    this.operations.push(`rtm:publish:user:${userId}:${envelope.type}`);
    this.publishedMessages.push({ destination: userId, message });
  }
  async getOnlineUsers(channelId: string) {
    this.operations.push(`presence:get:${channelId}`);
    return this.onlineUsers;
  }
  async getChannelMetadata(_channelId: string) {
    this.operations.push('storage:get');
    return this.channelSnapshot;
  }
  async setChannelMetadata(
    channelId: string,
    _key: string,
    value: string,
    options?: SetMetadataOptions,
  ) {
    const snapshot = JSON.parse(value) as VoiceRoomSnapshot;
    this.operations.push(`storage:set:${snapshot.revision}:${options?.lockName ?? ''}`);
    if (this.failSet) throw new Error('storage failed');
    this.channelSnapshot = {
      revision: this.channelSnapshot.revision + 1,
      values: { 'voice-room-state': value },
    };
    this.handlers.storage({
      channelName: channelId,
      revision: this.channelSnapshot.revision,
      values: this.channelSnapshot.values,
    });
  }
  async acquireLock(_channelId: string, lockName: string) {
    this.operations.push(`lock:acquire:${lockName}`);
  }
  async releaseLock(_channelId: string, lockName: string) {
    this.operations.push(`lock:release:${lockName}`);
  }

  emitMessage(message: string | object, publisher: string, channelType: 'MESSAGE' | 'USER' = 'USER') {
    const event: RtmMessageEvent = {
      channelType,
      channelName: channelType === 'USER' ? publisher : 'room-1',
      message: typeof message === 'string' ? message : JSON.stringify(message),
      publisher,
      timestamp: Date.now(),
    };
    this.handlers.message(event);
  }
}
