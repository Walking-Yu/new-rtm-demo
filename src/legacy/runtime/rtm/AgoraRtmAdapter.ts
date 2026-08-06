import AgoraRTM, { type RTMEvents } from 'agora-rtm';
import type {
  ChannelSnapshot,
  RtmConnectionState,
  RtmCredentials,
  RtmPort,
  RtmPortHandlers,
  SetMetadataOptions,
} from './RtmPort';

type AgoraClient = InstanceType<typeof AgoraRTM.RTM>;

const connectionStates: Record<string, RtmConnectionState> = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
  FAILED: 'failed',
};

const noopHandlers: RtmPortHandlers = {
  connection: () => undefined,
  message: () => undefined,
  presence: () => undefined,
  storage: () => undefined,
  tokenExpiring: () => undefined,
};

function storageValues(metadata: Record<string, { value: string }>): Record<string, string> {
  return Object.fromEntries(Object.entries(metadata).map(([key, detail]) => [key, detail.value]));
}

export class AgoraRtmAdapter implements RtmPort {
  private client: AgoraClient | null = null;
  private handlers = noopHandlers;

  registerEvents(handlers: RtmPortHandlers): void {
    this.handlers = handlers;
  }

  async connect(credentials: RtmCredentials): Promise<void> {
    if (this.client) await this.disconnect();
    this.client = new AgoraRTM.RTM(credentials.appId, credentials.userId, { logLevel: 'warn' });
    this.attachListeners(this.client);
    await this.client.login({ token: credentials.token });
  }

  async disconnect(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (client) await client.logout();
  }

  async subscribe(channelId: string): Promise<void> {
    await this.requireClient().subscribe(channelId, {
      withMessage: true,
      withPresence: true,
      withMetadata: true,
      withLock: true,
    });
  }

  async unsubscribe(channelId: string): Promise<void> {
    await this.requireClient().unsubscribe(channelId);
  }

  async publishChannel(channelId: string, message: string): Promise<void> {
    await this.requireClient().publish(channelId, message);
  }

  async publishUser(userId: string, message: string): Promise<void> {
    await this.requireClient().publish(userId, message, { channelType: 'USER' });
  }

  async getOnlineUsers(channelId: string): Promise<string[]> {
    const result = await this.requireClient().presence.getOnlineUsers(channelId, 'MESSAGE', {
      includedUserId: true,
      includedState: true,
    });
    return result.occupants.map((occupant) => occupant.userId);
  }

  async getChannelMetadata(channelId: string): Promise<ChannelSnapshot> {
    const result = await this.requireClient().storage.getChannelMetadata(channelId, 'MESSAGE');
    return { revision: result.majorRevision, values: storageValues(result.metadata) };
  }

  async setChannelMetadata(
    channelId: string,
    key: string,
    value: string,
    options: SetMetadataOptions = {},
  ): Promise<void> {
    await this.requireClient().storage.setChannelMetadata(
      channelId,
      'MESSAGE',
      [{ key, value, revision: -1 }],
      {
        majorRevision: options.majorRevision ?? -1,
        lockName: options.lockName,
        addTimeStamp: true,
        addUserId: true,
      },
    );
  }

  async acquireLock(channelId: string, lockName: string): Promise<void> {
    await this.requireClient().lock.acquireLock(channelId, 'MESSAGE', lockName, { retry: false });
  }

  async releaseLock(channelId: string, lockName: string): Promise<void> {
    await this.requireClient().lock.releaseLock(channelId, 'MESSAGE', lockName);
  }

  private requireClient(): AgoraClient {
    if (!this.client) throw new Error('RTM client is not connected');
    return this.client;
  }

  private attachListeners(client: AgoraClient): void {
    client.addEventListener('status', (event) => {
      this.handlers.connection(connectionStates[event.state] ?? 'disconnected', String(event.reason));
    });
    client.addEventListener('linkState', (event) => {
      const state = connectionStates[event.currentState] ?? (event.currentState === 'SUSPENDED' ? 'reconnecting' : 'disconnected');
      this.handlers.connection(state, event.reasonCode);
    });
    client.addEventListener('message', (event: RTMEvents.MessageEvent) => {
      if (event.channelType === 'STREAM' || typeof event.message !== 'string') return;
      this.handlers.message({
        channelType: event.channelType,
        channelName: event.channelName,
        message: event.message,
        publisher: event.publisher,
        timestamp: event.timestamp,
      });
    });
    client.addEventListener('presence', (event: RTMEvents.PresenceEvent) => {
      const users = event.snapshot?.map((user) => user.userId) ?? event.interval?.join.users ?? [];
      this.handlers.presence({
        channelName: event.channelName,
        eventType: event.eventType,
        publisher: event.publisher,
        users,
      });
    });
    client.addEventListener('storage', (event: RTMEvents.StorageEvent) => {
      this.handlers.storage({
        channelName: event.channelName,
        revision: event.data.majorRevision,
        values: storageValues(event.data.metadata),
      });
    });
    client.addEventListener('tokenPrivilegeWillExpire', () => this.handlers.tokenExpiring());
    client.addEventListener('token', () => this.handlers.tokenExpiring());
  }
}
