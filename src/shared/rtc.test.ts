import { describe, expect, it, vi } from 'vitest';

import { createRtcHelper, type RtcHandlers } from './rtc';
import { RtcSdkError, RtcUsageError, type RtcError } from './rtcErrors';

/** 假 SDK：只实现被断言到的部分，不连真实网络。 */
function fakeSdk() {
  const listeners = new Map<string, (...args: never[]) => void>();
  const remoteAudioTrack = { play: vi.fn(), stop: vi.fn() };
  const remoteVideoTrack = { play: vi.fn(), stop: vi.fn() };
  const microphone = { setMuted: vi.fn(async () => undefined), close: vi.fn() };
  const camera = { setMuted: vi.fn(async () => undefined), close: vi.fn(), play: vi.fn() };

  const client = {
    on: (name: string, listener: (...args: never[]) => void) => listeners.set(name, listener),
    join: vi.fn(async () => 'host-1'),
    leave: vi.fn(async () => undefined),
    publish: vi.fn(async () => undefined),
    unpublish: vi.fn(async () => undefined),
    subscribe: vi.fn(async (_user: unknown, mediaType: string) =>
      mediaType === 'audio' ? remoteAudioTrack : remoteVideoTrack,
    ),
    enableAudioVolumeIndicator: vi.fn(),
  };

  const createClient = vi.fn(() => client as never);

  return {
    listeners,
    client,
    createClient,
    microphone,
    camera,
    remoteAudioTrack,
    remoteVideoTrack,
    deps: {
      createClient,
      createMicrophoneAudioTrack: vi.fn(async () => microphone as never),
      createCameraVideoTrack: vi.fn(async () => camera as never),
    },
  };
}

function noopHandlers(): RtcHandlers {
  return {
    connection: vi.fn(),
    remoteAudioPublished: vi.fn(),
    remoteAudioUnpublished: vi.fn(),
    remoteVideoTrack: vi.fn(),
    remoteVideoUnpublished: vi.fn(),
    volume: vi.fn(),
  };
}

const SETTINGS = { appId: 'app-id', roomId: 'room-1', userId: 'host-1' };

describe('创建时机', () => {
  it('只有实际开音视频的用户才创建 RTC 实例 —— 纯听众不建', () => {
    const sdk = fakeSdk();

    createRtcHelper(sdk.deps);

    // 构造函数不碰 SDK：不 join 就没有客户端
    expect(sdk.createClient).not.toHaveBeenCalled();
  });

  it('join 之后才创建客户端', async () => {
    const sdk = fakeSdk();
    const rtc = createRtcHelper(sdk.deps);

    await rtc.join(SETTINGS);

    expect(sdk.createClient).toHaveBeenCalledTimes(1);
  });
});

describe('加入与离开', () => {
  it('签名里没有 token 参数，SDK 边界一律传 null', async () => {
    const sdk = fakeSdk();
    const rtc = createRtcHelper(sdk.deps);

    await rtc.join(SETTINGS);

    // 默认无 token 鉴权：token 不是可选参数，而是**不存在**。
    // 客户换成支持 token 的 appId 时自己接 token server（见 spec「配置注入」）。
    expect(sdk.client.join).toHaveBeenCalledWith('app-id', 'room-1', null, 'host-1');
    expect(Object.keys(SETTINGS)).not.toContain('token');
  });

  it('leave 关掉本地轨道并且可重复调用', async () => {
    const sdk = fakeSdk();
    const rtc = createRtcHelper(sdk.deps);
    await rtc.join(SETTINGS);
    await rtc.publishMicrophone();
    await rtc.publishCamera();

    await rtc.leave();
    await rtc.leave();

    expect(sdk.client.leave).toHaveBeenCalledTimes(1);
    expect(sdk.microphone.close).toHaveBeenCalledTimes(1);
    expect(sdk.camera.close).toHaveBeenCalledTimes(1);
  });

  it('未 join 就发布抛归一化的用法错误 —— 业务层要能区分「用法错误」与「SDK 错误」', async () => {
    const sdk = fakeSdk();
    const rtc = createRtcHelper(sdk.deps);

    // 光断言 toThrow() 抓不住这点：裸 Error 也会通过。
    await expect(rtc.publishMicrophone()).rejects.toBeInstanceOf(RtcUsageError);
    await expect(rtc.publishCamera()).rejects.toBeInstanceOf(RtcUsageError);
    await expect(rtc.publishMicrophone()).rejects.toSatisfy(
      (error: RtcError) => error.kind === 'usage',
    );
  });

  it('SDK 失败抛归一化的 SDK 错误，原始错误挂在 cause 上', async () => {
    const sdk = fakeSdk();
    sdk.client.join = vi.fn(async () => {
      throw new Error('NETWORK_ERROR');
    }) as never;
    const rtc = createRtcHelper(sdk.deps);

    const failure = await rtc.join(SETTINGS).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RtcSdkError);
    expect((failure as RtcError).kind).toBe('sdk');
    expect((failure as Error).cause).toBeInstanceOf(Error);
  });

  it('未发布就静音抛用法错误，不是裸错误', async () => {
    const sdk = fakeSdk();
    const rtc = createRtcHelper(sdk.deps);
    await rtc.join(SETTINGS);

    await expect(rtc.setMicrophoneMuted(true)).rejects.toBeInstanceOf(RtcUsageError);
    await expect(rtc.setCameraMuted(true)).rejects.toBeInstanceOf(RtcUsageError);
  });

  it('离开频道前先发停播通知 —— 顺序反了 UI 会播已销毁的 track', async () => {
    const sdk = fakeSdk();
    const rtc = createRtcHelper(sdk.deps);
    const handlers = noopHandlers();
    rtc.registerEvents(handlers);
    await rtc.join(SETTINGS);

    // 让两个远端各发布音频与视频，建立起 UI 侧的播放状态
    sdk.listeners.get('user-published')?.({ uid: 'audience-1' } as never, 'audio' as never);
    sdk.listeners.get('user-published')?.({ uid: 'audience-2' } as never, 'video' as never);
    await vi.waitFor(() => expect(handlers.remoteVideoTrack).toHaveBeenCalled());

    const order: string[] = [];
    (handlers.remoteAudioUnpublished as ReturnType<typeof vi.fn>).mockImplementation(() =>
      order.push('stop-audio'),
    );
    (handlers.remoteVideoUnpublished as ReturnType<typeof vi.fn>).mockImplementation(() =>
      order.push('stop-video'),
    );
    sdk.client.leave = vi.fn(async () => {
      order.push('leave');
    }) as never;

    await rtc.leave();

    // 停播通知必须都排在 leave 之前
    expect(order.indexOf('leave')).toBe(order.length - 1);
    expect(order).toContain('stop-audio');
    expect(order).toContain('stop-video');
  });
});

describe('麦克风', () => {
  it('发布、静音、取消发布', async () => {
    const sdk = fakeSdk();
    const rtc = createRtcHelper(sdk.deps);
    await rtc.join(SETTINGS);

    await rtc.publishMicrophone();
    await rtc.setMicrophoneMuted(true);
    await rtc.unpublishMicrophone();

    expect(sdk.client.publish).toHaveBeenCalledWith(sdk.microphone);
    expect(sdk.microphone.setMuted).toHaveBeenCalledWith(true);
    expect(sdk.client.unpublish).toHaveBeenCalledWith(sdk.microphone);
  });

  it('重复发布只发一次', async () => {
    const sdk = fakeSdk();
    const rtc = createRtcHelper(sdk.deps);
    await rtc.join(SETTINGS);

    await rtc.publishMicrophone();
    await rtc.publishMicrophone();

    expect(sdk.client.publish).toHaveBeenCalledTimes(1);
  });
});

describe('摄像头', () => {
  it('发布、静音、取消发布', async () => {
    const sdk = fakeSdk();
    const rtc = createRtcHelper(sdk.deps);
    await rtc.join(SETTINGS);

    await rtc.publishCamera();
    await rtc.setCameraMuted(true);
    await rtc.unpublishCamera();

    expect(sdk.client.publish).toHaveBeenCalledWith(sdk.camera);
    expect(sdk.camera.setMuted).toHaveBeenCalledWith(true);
    expect(sdk.client.unpublish).toHaveBeenCalledWith(sdk.camera);
  });

  it('本地视频轨道交给 UI 自己播 —— 模块内部不 play', async () => {
    const sdk = fakeSdk();
    const rtc = createRtcHelper(sdk.deps);
    await rtc.join(SETTINGS);

    await rtc.publishCamera();

    // 交出轨道，但不代替 UI 播放：视频有挂载点问题，只有 UI 知道播到哪个 div
    expect(rtc.getLocalVideoTrack()).toBe(sdk.camera);
    expect(sdk.camera.play).not.toHaveBeenCalled();
  });

  it('未发布摄像头时取本地视频轨道返回空值', async () => {
    const sdk = fakeSdk();
    const rtc = createRtcHelper(sdk.deps);
    await rtc.join(SETTINGS);

    expect(rtc.getLocalVideoTrack()).toBeUndefined();
  });
});

describe('远端订阅', () => {
  it('远端音频由模块内部直接 play —— 音频没有挂载点问题', async () => {
    const sdk = fakeSdk();
    const rtc = createRtcHelper(sdk.deps);
    const handlers = noopHandlers();
    rtc.registerEvents(handlers);
    await rtc.join(SETTINGS);

    sdk.listeners.get('user-published')?.({ uid: 'audience-1' } as never, 'audio' as never);
    await vi.waitFor(() => expect(sdk.remoteAudioTrack.play).toHaveBeenCalledOnce());

    expect(sdk.client.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ uid: 'audience-1' }),
      'audio',
    );
    expect(handlers.remoteAudioPublished).toHaveBeenCalledWith('audience-1');
  });

  it('远端视频轨道交给 UI，模块内部不 play', async () => {
    const sdk = fakeSdk();
    const rtc = createRtcHelper(sdk.deps);
    const handlers = noopHandlers();
    rtc.registerEvents(handlers);
    await rtc.join(SETTINGS);

    sdk.listeners.get('user-published')?.({ uid: 'audience-1' } as never, 'video' as never);
    await vi.waitFor(() =>
      expect(handlers.remoteVideoTrack).toHaveBeenCalledWith('audience-1', sdk.remoteVideoTrack),
    );

    expect(sdk.remoteVideoTrack.play).not.toHaveBeenCalled();
  });

  it('远端取消发布分音频与视频两个回调', async () => {
    const sdk = fakeSdk();
    const rtc = createRtcHelper(sdk.deps);
    const handlers = noopHandlers();
    rtc.registerEvents(handlers);
    await rtc.join(SETTINGS);

    sdk.listeners.get('user-unpublished')?.({ uid: 'audience-1' } as never, 'audio' as never);
    sdk.listeners.get('user-unpublished')?.({ uid: 'audience-1' } as never, 'video' as never);

    expect(handlers.remoteAudioUnpublished).toHaveBeenCalledWith('audience-1');
    expect(handlers.remoteVideoUnpublished).toHaveBeenCalledWith('audience-1');
  });

  it('音量回调把 SDK 的数组归一成 uid 到音量的映射', async () => {
    const sdk = fakeSdk();
    const rtc = createRtcHelper(sdk.deps);
    const handlers = noopHandlers();
    rtc.registerEvents(handlers);
    await rtc.join(SETTINGS);

    sdk.listeners.get('volume-indicator')?.([
      { uid: 'host-1', level: 60 },
      { uid: 'audience-1', level: 12 },
    ] as never);

    expect(handlers.volume).toHaveBeenCalledWith({ 'host-1': 60, 'audience-1': 12 });
  });

  it('连接状态变化转成与 RTM 同一套状态词', async () => {
    const sdk = fakeSdk();
    const rtc = createRtcHelper(sdk.deps);
    const handlers = noopHandlers();
    rtc.registerEvents(handlers);
    await rtc.join(SETTINGS);

    sdk.listeners.get('connection-state-change')?.(
      'RECONNECTING' as never,
      'CONNECTED' as never,
      undefined as never,
    );

    expect(handlers.connection).toHaveBeenCalledWith('reconnecting', undefined);
  });
});

describe('不采集 trace', () => {
  it('模块不导出任何 trace 接口 —— 时间线只呈现 RTM', async () => {
    const sdk = fakeSdk();
    const rtc = createRtcHelper(sdk.deps);
    await rtc.join(SETTINGS);
    await rtc.publishMicrophone();

    // 混入 RTC 节点会稀释「RTM 数据流」这条主线（见 spec「归并与筛选」）
    for (const key of Object.keys(rtc)) {
      expect(key.toLowerCase()).not.toContain('trace');
    }
  });
});
