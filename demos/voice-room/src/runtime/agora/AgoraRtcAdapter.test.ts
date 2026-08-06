import { describe, expect, it, vi } from 'vitest';
import { AgoraRtcAdapter } from './AgoraRtcAdapter';

describe('AgoraRtcAdapter', () => {
  it('converts an undefined runtime token to null only at the RTC SDK join boundary', async () => {
    const join = vi.fn(async () => 'host-1');
    const client = {
      on: vi.fn(),
      join,
      enableAudioVolumeIndicator: vi.fn(),
    };
    const adapter = new AgoraRtcAdapter({
      createClient: () => client as never,
      createMicrophoneAudioTrack: async () => ({}) as never,
    });

    await adapter.join({ appId: 'app-id', roomId: 'room-1', userId: 'host-1' });

    expect(join).toHaveBeenCalledWith('app-id', 'room-1', null, 'host-1');
  });

  it('subscribes and plays remote audio, then owns the microphone lifecycle', async () => {
    const listeners = new Map<string, (...args: never[]) => void>();
    const remoteTrack = { play: vi.fn() };
    const localTrack = { setMuted: vi.fn(async () => undefined), close: vi.fn() };
    const client = {
      on: (name: string, listener: (...args: never[]) => void) => listeners.set(name, listener),
      join: vi.fn(async () => 'host-1'),
      leave: vi.fn(async () => undefined),
      publish: vi.fn(async () => undefined),
      unpublish: vi.fn(async () => undefined),
      subscribe: vi.fn(async () => remoteTrack),
      enableAudioVolumeIndicator: vi.fn(),
    };
    const adapter = new AgoraRtcAdapter({
      createClient: () => client as never,
      createMicrophoneAudioTrack: async () => localTrack as never,
    });
    const remoteAudioPublished = vi.fn();
    adapter.registerEvents({
      connection: vi.fn(), remoteAudioPublished, remoteAudioUnpublished: vi.fn(), volume: vi.fn(),
    });

    await adapter.join({ appId: 'app-id', roomId: 'room-1', userId: 'host-1', token: 'rtc-token' });
    listeners.get('user-published')?.({ uid: 'audience-1' } as never, 'audio' as never);
    await vi.waitFor(() => expect(remoteTrack.play).toHaveBeenCalledOnce());
    expect(client.subscribe).toHaveBeenCalledWith(expect.objectContaining({ uid: 'audience-1' }), 'audio');
    expect(remoteAudioPublished).toHaveBeenCalledWith('audience-1');

    await adapter.publishMicrophone();
    await adapter.publishMicrophone();
    await adapter.setMicrophoneMuted(true);
    await adapter.unpublishMicrophone();
    await adapter.leave();
    await adapter.leave();

    expect(client.publish).toHaveBeenCalledTimes(1);
    expect(localTrack.setMuted).toHaveBeenCalledWith(true);
    expect(client.unpublish).toHaveBeenCalledWith(localTrack);
    expect(localTrack.close).toHaveBeenCalledTimes(1);
    expect(client.leave).toHaveBeenCalledTimes(1);
  });
});
