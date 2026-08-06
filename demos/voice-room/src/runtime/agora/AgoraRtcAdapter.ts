import AgoraRTC, {
  type ConnectionState as AgoraConnectionState,
  type IAgoraRTCClient,
  type IAgoraRTCRemoteUser,
  type IMicrophoneAudioTrack,
} from 'agora-rtc-sdk-ng';
import type { ConnectionState } from '../ports/RtmPort';
import type { RtcJoinSettings, RtcPort, RtcPortHandlers } from '../ports/RtcPort';
import { mapRtcError, rtcError } from './errorMap';

interface AgoraRtcDependencies {
  createClient: typeof AgoraRTC.createClient;
  createMicrophoneAudioTrack: typeof AgoraRTC.createMicrophoneAudioTrack;
}

const noopHandlers: RtcPortHandlers = {
  connection: () => undefined,
  remoteAudioPublished: () => undefined,
  remoteAudioUnpublished: () => undefined,
  volume: () => undefined,
};

function connectionState(state: AgoraConnectionState): ConnectionState {
  const states: Record<AgoraConnectionState, ConnectionState> = {
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    RECONNECTING: 'reconnecting',
    DISCONNECTING: 'disconnected',
    DISCONNECTED: 'disconnected',
  };
  return states[state];
}

export class AgoraRtcAdapter implements RtcPort {
  private client: IAgoraRTCClient | null = null;
  private microphone: IMicrophoneAudioTrack | null = null;
  private handlers = noopHandlers;
  private joined = false;
  private published = false;

  constructor(private readonly sdk: AgoraRtcDependencies = AgoraRTC) {}

  registerEvents(handlers: RtcPortHandlers): void {
    this.handlers = handlers;
  }

  async join(settings: RtcJoinSettings): Promise<void> {
    if (this.joined || this.client) await this.leave();
    const client = this.sdk.createClient({ mode: 'rtc', codec: 'vp8' });
    this.client = client;
    this.attachListeners(client);
    try {
      await client.join(settings.appId, settings.roomId, settings.token || null, settings.userId);
      this.joined = true;
      client.enableAudioVolumeIndicator();
    } catch (error) {
      this.client = null;
      throw rtcError(error);
    }
  }

  async leave(): Promise<void> {
    const client = this.client;
    const microphone = this.microphone;
    const wasJoined = this.joined;
    this.client = null;
    this.microphone = null;
    this.joined = false;
    this.published = false;
    try {
      if (client && microphone && wasJoined) await client.unpublish(microphone);
      if (client && wasJoined) await client.leave();
    } catch (error) {
      throw rtcError(error);
    } finally {
      microphone?.close();
    }
  }

  async publishMicrophone(): Promise<void> {
    if (this.published) return;
    const client = this.requireJoinedClient();
    try {
      const microphone = this.microphone ?? await this.sdk.createMicrophoneAudioTrack();
      this.microphone = microphone;
      await client.publish(microphone);
      this.published = true;
    } catch (error) {
      throw rtcError(error);
    }
  }

  async unpublishMicrophone(): Promise<void> {
    if (!this.published || !this.client || !this.microphone) return;
    try {
      await this.client.unpublish(this.microphone);
      this.published = false;
    } catch (error) {
      throw rtcError(error);
    }
  }

  async setMicrophoneMuted(muted: boolean): Promise<void> {
    if (!this.microphone) throw new Error('麦克风尚未发布');
    try {
      await this.microphone.setMuted(muted);
    } catch (error) {
      throw rtcError(error);
    }
  }

  private requireJoinedClient(): IAgoraRTCClient {
    if (!this.client || !this.joined) throw new Error('RTC 尚未加入房间');
    return this.client;
  }

  private attachListeners(client: IAgoraRTCClient): void {
    client.on('connection-state-change', (currentState, _previousState, reason) => {
      const state = connectionState(currentState);
      const failed = currentState === 'DISCONNECTED' && reason && reason !== 'LEAVE';
      this.handlers.connection(failed ? 'failed' : state, failed ? mapRtcError(reason) : reason);
    });
    client.on('user-published', (user, mediaType) => {
      if (mediaType !== 'audio') return;
      void this.subscribeAndPlay(client, user);
    });
    client.on('user-unpublished', (user, mediaType) => {
      if (mediaType === 'audio') this.handlers.remoteAudioUnpublished(String(user.uid));
    });
    client.on('volume-indicator', (levels) => {
      this.handlers.volume(Object.fromEntries(levels.map((item) => [String(item.uid), item.level])));
    });
  }

  private async subscribeAndPlay(client: IAgoraRTCClient, user: IAgoraRTCRemoteUser): Promise<void> {
    try {
      const track = await client.subscribe(user, 'audio');
      track.play();
      this.handlers.remoteAudioPublished(String(user.uid));
    } catch (error) {
      this.handlers.connection('failed', mapRtcError(error));
    }
  }
}
