import type { RtcJoinSettings, RtcPort, RtcPortHandlers } from '../ports/RtcPort';

const noopHandlers: RtcPortHandlers = {
  connection: () => undefined,
  remoteAudioPublished: () => undefined,
  remoteAudioUnpublished: () => undefined,
  volume: () => undefined,
};

export class MemoryRtcPort implements RtcPort {
  handlers = noopHandlers;
  failPublish = false;

  constructor(public readonly operations: string[] = []) {}

  registerEvents(handlers: RtcPortHandlers) {
    this.operations.push('rtc:register-events');
    this.handlers = handlers;
  }
  async join(settings: RtcJoinSettings) {
    this.operations.push(`rtc:join:${settings.roomId}:${settings.userId}`);
  }
  async leave() { this.operations.push('rtc:leave'); }
  async publishMicrophone() {
    this.operations.push('rtc:publish-microphone');
    if (this.failPublish) throw new Error('microphone publish failed');
  }
  async unpublishMicrophone() { this.operations.push('rtc:unpublish-microphone'); }
  async setMicrophoneMuted(muted: boolean) {
    this.operations.push(`rtc:mute:${muted}`);
  }
}
