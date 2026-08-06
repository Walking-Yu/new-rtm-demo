import type { ConnectionState } from './RtmPort';

export interface RtcPortHandlers {
  connection: (state: ConnectionState, reason?: string) => void;
  remoteAudioPublished: (userId: string) => void;
  remoteAudioUnpublished: (userId: string) => void;
  volume: (levels: Record<string, number>) => void;
}

export interface RtcJoinSettings {
  appId: string;
  roomId: string;
  userId: string;
  token?: string;
}

export interface RtcPort {
  registerEvents(handlers: RtcPortHandlers): void;
  join(settings: RtcJoinSettings): Promise<void>;
  leave(): Promise<void>;
  publishMicrophone(): Promise<void>;
  unpublishMicrophone(): Promise<void>;
  setMicrophoneMuted(muted: boolean): Promise<void>;
}
