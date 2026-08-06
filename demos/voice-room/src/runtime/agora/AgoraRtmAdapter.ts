import AgoraRTM, { type RTMConfig, type RTMEvents } from 'agora-rtm';
import type {
  ChannelSnapshot,
  ConnectionState,
  RtmCredentials,
  RtmPort,
  RtmPortHandlers,
  SetMetadataOptions,
} from '../ports/RtmPort';
import { rtmError } from './errorMap';

type AgoraClient = InstanceType<typeof AgoraRTM.RTM>;
type AgoraClientFactory = (appId: string, userId: string, config: RTMConfig) => AgoraClient;

const noopHandlers: RtmPortHandlers = {
  connection: () => undefined,
  message: () => undefined,
  presence: () => undefined,
  storage: () => undefined,
  tokenExpiring: () => undefined,
};

function connectionState(event: RTMEvents.LinkStateEvent): ConnectionState {
  if (event.currentState === 'CONNECTED') return 'connected';
  if (event.currentState === 'FAILED') return 'failed';
  if (event.currentState === 'IDLE') return 'disconnected';
  if (event.currentState === 'DISCONNECTED' || event.currentState === 'SUSPENDED') {
    return 'reconnecting';
  }
  return event.operation === 'AUTO_RECONNECT' ? 'reconnecting' : 'connecting';
}

function storageValues(metadata: Record<string, { value: string }>): Record<string, string> {
  return Object.fromEntries(Object.entries(metadata).map(([key, detail]) => [key, detail.value]));
}

function matchesSdkError(error: unknown, errorCode: number, marker: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const detail = error as Record<string, unknown>;
  if (detail.errorCode === errorCode || detail.code === errorCode) return true;
  return [detail.code, detail.name, detail.message, detail.reason]
    .filter((value) => typeof value === 'string')
    .join(' ')
    .toUpperCase()
    .includes(marker);
}

export class AgoraRtmAdapter implements RtmPort {
  private client: AgoraClient | null = null;
  private handlers = noopHandlers;

  constructor(
    private readonly createClient: AgoraClientFactory = (appId, userId, config) =>
      new AgoraRTM.RTM(appId, userId, config),
  ) {}

  registerEvents(handlers: RtmPortHandlers): void {
    this.handlers = handlers;
  }

  async connect(credentials: RtmCredentials): Promise<void> {
    let clientToClean: AgoraClient | null = null;
    try {
      if (this.client) await this.disconnect();
      const client = this.createClient(credentials.appId, credentials.userId, {
        logLevel: 'debug',
        useStringUserId: true,
      });
      clientToClean = client;
      this.client = client;
      this.attachListeners(client);
      await client.login({ token: credentials.token });
    } catch (error) {
      const originalError = rtmError(error);
      if (this.client === clientToClean) this.client = null;
      if (clientToClean) {
        try {
          await clientToClean.logout();
        } catch {
          // A failed login can also reject logout; keep the login error authoritative.
        }
      }
      throw originalError;
    }
  }

  async disconnect(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (!client) return;
    try {
      await client.logout();
    } catch (error) {
      throw rtmError(error);
    }
  }

  async subscribe(channelId: string): Promise<void> {
    await this.run(() => this.requireClient().subscribe(channelId, {
      withMessage: true,
      withPresence: true,
      withMetadata: true,
      withLock: true,
    }));
  }

  async unsubscribe(channelId: string): Promise<void> {
    await this.run(() => this.requireClient().unsubscribe(channelId));
  }

  async publishChannel(channelId: string, message: string): Promise<void> {
    await this.run(() => this.requireClient().publish(channelId, message));
  }

  async publishUser(userId: string, message: string): Promise<void> {
    await this.run(() => this.requireClient().publish(userId, message, { channelType: 'USER' }));
  }

  async getOnlineUsers(channelId: string): Promise<string[]> {
    return this.run(async () => {
      const userIds = new Set<string>();
      let page: string | undefined;
      do {
        const result = await this.requireClient().presence.getOnlineUsers(channelId, 'MESSAGE', {
          includedUserId: true,
          includedState: false,
          ...(page ? { page } : {}),
        });
        result.occupants.forEach((occupant) => userIds.add(occupant.userId));
        page = result.nextPage || undefined;
      } while (page);
      return Array.from(userIds);
    });
  }

  async getChannelMetadata(channelId: string): Promise<ChannelSnapshot> {
    return this.run(async () => {
      const result = await this.requireClient().storage.getChannelMetadata(channelId, 'MESSAGE');
      return { revision: result.majorRevision, values: storageValues(result.metadata) };
    });
  }

  async setChannelMetadata(
    channelId: string,
    key: string,
    value: string,
    options: SetMetadataOptions = {},
  ): Promise<void> {
    await this.run(() => this.requireClient().storage.setChannelMetadata(
      channelId,
      'MESSAGE',
      [{ key, value, revision: -1 }],
      {
        majorRevision: options.majorRevision ?? -1,
        lockName: options.lockName,
        addTimeStamp: true,
        addUserId: true,
      },
    ));
  }

  async acquireLock(channelId: string, lockName: string): Promise<void> {
    await this.run(async () => {
      const lock = this.requireClient().lock;
      try {
        await lock.acquireLock(channelId, 'MESSAGE', lockName, { retry: false });
      } catch (error) {
        if (!matchesSdkError(error, -14008, 'LOCK_NOT_EXIST')) throw error;
        try {
          await lock.setLock(channelId, 'MESSAGE', lockName);
        } catch (setError) {
          if (!matchesSdkError(setError, -14004, 'LOCK_ALREADY_EXIST')) throw setError;
        }
        await lock.acquireLock(channelId, 'MESSAGE', lockName, { retry: false });
      }
    });
  }

  async releaseLock(channelId: string, lockName: string): Promise<void> {
    await this.run(() => this.requireClient().lock.releaseLock(channelId, 'MESSAGE', lockName));
  }

  private requireClient(): AgoraClient {
    if (!this.client) throw new Error('RTM 尚未连接');
    return this.client;
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof Error && error.message === 'RTM 尚未连接') throw error;
      throw rtmError(error);
    }
  }

  private attachListeners(client: AgoraClient): void {
    client.addEventListener('linkState', (event) => {
      this.handlers.connection(connectionState(event), event.reasonCode);
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
      const intervalUsers = event.interval
        ? [...event.interval.join.users, ...event.interval.leave.users, ...event.interval.timeout.users]
        : [];
      this.handlers.presence({
        channelName: event.channelName,
        eventType: event.eventType,
        publisher: event.publisher,
        users: event.snapshot?.map((user) => user.userId) ?? intervalUsers,
      });
    });
    client.addEventListener('storage', (event: RTMEvents.StorageEvent) => {
      this.handlers.storage({
        channelName: event.channelName,
        revision: event.data.majorRevision,
        values: storageValues(event.data.metadata),
      });
    });
    client.addEventListener('token', (event) => {
      if (event.eventType === 'WILL_EXPIRE') this.handlers.tokenExpiring();
    });
  }
}
