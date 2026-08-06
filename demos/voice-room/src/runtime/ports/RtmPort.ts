export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

export interface RtmCredentials {
  appId: string;
  userId: string;
  token?: string;
}

export interface RtmMessageEvent {
  channelType: 'MESSAGE' | 'USER';
  channelName: string;
  message: string;
  publisher: string;
  timestamp: number;
}

export interface RtmPresenceEvent {
  channelName: string;
  eventType: string;
  publisher?: string;
  users: string[];
}

export interface RtmStorageEvent {
  channelName: string;
  revision: number;
  values: Record<string, string>;
}

export interface RtmPortHandlers {
  connection: (state: ConnectionState, reason?: string) => void;
  message: (event: RtmMessageEvent) => void;
  presence: (event: RtmPresenceEvent) => void;
  storage: (event: RtmStorageEvent) => void;
  tokenExpiring: () => void;
}

export interface ChannelSnapshot {
  revision: number;
  values: Record<string, string>;
}

export interface SetMetadataOptions {
  majorRevision?: number;
  lockName?: string;
}

export interface RtmPort {
  registerEvents(handlers: RtmPortHandlers): void;
  connect(credentials: RtmCredentials): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(channelId: string): Promise<void>;
  unsubscribe(channelId: string): Promise<void>;
  publishChannel(channelId: string, message: string): Promise<void>;
  publishUser(userId: string, message: string): Promise<void>;
  getOnlineUsers(channelId: string): Promise<string[]>;
  getChannelMetadata(channelId: string): Promise<ChannelSnapshot>;
  setChannelMetadata(
    channelId: string,
    key: string,
    value: string,
    options?: SetMetadataOptions,
  ): Promise<void>;
  acquireLock(channelId: string, lockName: string): Promise<void>;
  releaseLock(channelId: string, lockName: string): Promise<void>;
}
