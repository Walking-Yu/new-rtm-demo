/**
 * 编排器测试。
 *
 * 这里锁住的是 spec 定死的两条顺序：**先连房主再连听众**、**麦位激活由媒体结果驱动**。
 * 两者都靠注入假工厂来断言调用轨迹 —— 与 RTM 单文件的测试同一套路子：不 mock Agora
 * SDK，而是记录一串 `operations: string[]` 再整体比对。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  VoiceRoomOrchestrator,
  isSpeaking,
  type ClientsConfig,
  type VoiceRoomAudienceClientLike,
  type VoiceRoomClients,
  type VoiceRoomHostClientLike,
} from './orchestrator';
import type { RtcHandlers, RtcHelper } from '../../shared/rtc';
import type { IncomingCommand } from './rtm-audience';
import { voiceRoomStateAdapter } from './stateAdapter';
import type { VoiceRoomSnapshot } from './state';

/** 两端与两个 RTC 共用同一条调用轨迹 —— 跨端的先后次序正是要断言的东西。 */
let operations: string[];

/** 假 RTC。`failPublish` 打开后 `publishMicrophone` 抛错，用来验证失败回滚。 */
function fakeRtc(label: string, options: { failPublish?: boolean } = {}) {
  let handlers: RtcHandlers | undefined;
  const helper: RtcHelper = {
    registerEvents: (next) => {
      handlers = next;
    },
    join: async () => void operations.push(`rtc:${label}:join`),
    leave: async () => void operations.push(`rtc:${label}:leave`),
    publishMicrophone: async () => {
      operations.push(`rtc:${label}:publishMicrophone`);
      if (options.failPublish) throw new Error('设备被占用');
    },
    unpublishMicrophone: async () => void operations.push(`rtc:${label}:unpublishMicrophone`),
    setMicrophoneMuted: async (muted) =>
      void operations.push(`rtc:${label}:setMicrophoneMuted:${muted}`),
    publishCamera: async () => void operations.push(`rtc:${label}:publishCamera`),
    unpublishCamera: async () => void operations.push(`rtc:${label}:unpublishCamera`),
    setCameraMuted: async () => void operations.push(`rtc:${label}:setCameraMuted`),
    getLocalVideoTrack: () => undefined,
  };
  return {
    helper,
    /** 把 RTC 事件打回编排器，模拟 SDK 回调。 */
    emit: (): RtcHandlers => {
      if (!handlers) throw new Error('registerEvents 还没被调用');
      return handlers;
    },
  };
}

/** 假的两端 RTM 客户端。只实现编排层用到的方法，其余靠结构接口自然裁掉。 */
function fakeClients(config: ClientsConfig, options: { failHostConnect?: boolean } = {}) {
  const host: VoiceRoomHostClientLike = {
    getTraces: () => [],
    subscribeTraces: () => () => undefined,
    clearTraces: () => void operations.push('host:clearTraces'),
    connect: async () => {
      operations.push('host:connect');
      if (options.failHostConnect) throw new Error('房主登录失败');
    },
    disconnect: async () => void operations.push('host:disconnect'),
    approveSeatRequest: async (id) => void operations.push(`host:approveSeatRequest:${id}`),
    rejectSeatRequest: async (id) => void operations.push(`host:rejectSeatRequest:${id}`),
    inviteToSeat: async (userId, _displayName, seatId) =>
      void operations.push(`host:inviteToSeat:${userId}:${seatId}`),
    forceMuteSeat: async (userId, muted) =>
      void operations.push(`host:forceMuteSeat:${userId}:${muted}`),
    forceLeaveSeat: async (userId) => void operations.push(`host:forceLeaveSeat:${userId}`),
    kickMember: async (userId) => void operations.push(`host:kickMember:${userId}`),
    banMember: async (userId) => void operations.push(`host:banMember:${userId}`),
    updateAnnouncement: async (text) => void operations.push(`host:updateAnnouncement:${text}`),
    sendChatMessage: async (text) => void operations.push(`host:sendChatMessage:${text}`),
    sendEmoji: async (emoji) => void operations.push(`host:sendEmoji:${emoji}`),
    sendGift: async (giftId) => void operations.push(`host:sendGift:${giftId}`),
  };

  const audience: VoiceRoomAudienceClientLike = {
    getTraces: () => [],
    subscribeTraces: () => () => undefined,
    clearTraces: () => void operations.push('audience:clearTraces'),
    connect: async () => void operations.push('audience:connect'),
    disconnect: async () => void operations.push('audience:disconnect'),
    requestSeat: async (seatId) => void operations.push(`audience:requestSeat:${seatId}`),
    cancelSeatRequest: async () => void operations.push('audience:cancelSeatRequest'),
    acceptInvitation: async () => void operations.push('audience:acceptInvitation'),
    rejectInvitation: async () => void operations.push('audience:rejectInvitation'),
    setOwnMuted: async (muted) => void operations.push(`audience:setOwnMuted:${muted}`),
    leaveOwnSeat: async () => void operations.push('audience:leaveOwnSeat'),
    applyForcedMute: async (muted, commandId) =>
      void operations.push(`audience:applyForcedMute:${muted}:${commandId}`),
    applyForcedLeave: async (commandId) =>
      void operations.push(`audience:applyForcedLeave:${commandId}`),
    activateOwnSeat: async (seatId) => void operations.push(`audience:activateOwnSeat:${seatId}`),
    rollbackOwnSeat: async (seatId) => void operations.push(`audience:rollbackOwnSeat:${seatId}`),
    sendChatMessage: async (text) => void operations.push(`audience:sendChatMessage:${text}`),
    sendEmoji: async (emoji) => void operations.push(`audience:sendEmoji:${emoji}`),
    sendGift: async (giftId) => void operations.push(`audience:sendGift:${giftId}`),
  };

  return { host, audience, config };
}

interface SetupOptions {
  failPublish?: boolean;
  failHostConnect?: boolean;
}

function setup(options: SetupOptions = {}) {
  // 两个 RTC 按创建顺序分给房主与听众 —— 编排器先建房主的。
  const rtcs = [fakeRtc('host'), fakeRtc('audience', { failPublish: options.failPublish })];
  let created = 0;
  let captured: ClientsConfig | undefined;
  let clients: VoiceRoomClients | undefined;

  const orchestrator = new VoiceRoomOrchestrator({
    appId: 'test-app',
    roomId: 'room-1',
    hostUserId: 'host-001',
    audienceUserId: 'audience-001',
    createRtc: () => rtcs[created++].helper,
    createClients: (config) => {
      captured = config;
      clients = fakeClients(config, { failHostConnect: options.failHostConnect });
      return clients;
    },
  });

  return {
    orchestrator,
    hostRtc: rtcs[0],
    audienceRtc: rtcs[1],
    /** 两端 handlers，用来把 RTM 侧的回调打回编排器。 */
    handlers: () => {
      if (!captured) throw new Error('createClients 还没被调用');
      return captured;
    },
  };
}

/** 造一个「听众在 seat-1 且状态为 joining」的快照，模拟房主同意后的中间态。 */
function snapshotWithJoiningSeat(): VoiceRoomSnapshot {
  const base = voiceRoomStateAdapter.createInitial('host-001');
  return {
    ...base,
    seats: {
      ...base.seats,
      'seat-1': {
        seatId: 'seat-1',
        userId: 'audience-001',
        displayName: '听众',
        status: 'joining',
        muted: false,
      },
    },
  };
}

beforeEach(() => {
  operations = [];
});

describe('连接顺序', () => {
  it('先连房主再连听众 —— 房间快照由房主创建，听众先连会白等一轮', async () => {
    const { orchestrator } = setup();

    await orchestrator.start();

    expect(operations).toEqual([
      'host:connect',
      'rtc:host:join',
      'audience:connect',
      'rtc:audience:join',
    ]);
  });

  it('听众的 RTC 只加入频道，不发布麦克风 —— 上麦成功才发布', async () => {
    const { orchestrator } = setup();

    await orchestrator.start();

    expect(operations).not.toContain('rtc:audience:publishMicrophone');
  });

  it('房主连接失败时不继续连听众，并把错误留在房主端视图上', async () => {
    const { orchestrator } = setup({ failHostConnect: true });

    await orchestrator.start();

    expect(operations).toEqual(['host:connect']);
    expect(orchestrator.getView().host.lastError).toBe('房主登录失败');
  });

  it('stop() 关闭两端与两个 RTC', async () => {
    const { orchestrator } = setup();
    await orchestrator.start();
    operations = [];

    await orchestrator.stop();

    expect(operations).toContain('host:disconnect');
    expect(operations).toContain('audience:disconnect');
    expect(operations).toContain('rtc:host:leave');
    expect(operations).toContain('rtc:audience:leave');
  });
});

describe('生命周期守卫（StrictMode 的挂载—卸载—再挂载）', () => {
  it('start() 期间被 stop()，后续步骤全部放弃 —— 不会连上听众', async () => {
    const { orchestrator } = setup();

    // 不 await：让 start() 停在第一个 await 上，再立刻 stop()。
    const starting = orchestrator.start();
    await orchestrator.stop();
    await starting;

    // 房主的 connect 已经发出（无法撤回），但代数已变，听众不再连接。
    expect(operations).not.toContain('audience:connect');
    expect(operations).not.toContain('rtc:audience:join');
  });

  it('第二代 start() 正常完成，不受第一代影响', async () => {
    const { orchestrator } = setup();
    const starting = orchestrator.start();
    await orchestrator.stop();
    await starting;
    operations = [];

    await orchestrator.start();

    expect(operations).toEqual([
      'host:connect',
      'rtc:host:join',
      'audience:connect',
      'rtc:audience:join',
    ]);
  });
});

describe('麦位激活由媒体结果驱动', () => {
  it('房主同意申请只置 joining，不直接激活', async () => {
    const { orchestrator } = setup();

    await orchestrator.approveSeatRequest('req-1');

    expect(operations).toEqual(['host:approveSeatRequest:req-1']);
    expect(operations).not.toContain('audience:activateOwnSeat:seat-1');
  });

  it('收到 seat.approved 后：先发布麦克风，成功才激活麦位', async () => {
    const { orchestrator, handlers } = setup();
    await orchestrator.start();
    operations = [];

    const command: IncomingCommand = { type: 'seat.approved', seatId: 'seat-1', from: 'host-001' };
    handlers().audience.handlers.command(command);
    await vi.waitFor(() => {
      expect(operations).toContain('audience:activateOwnSeat:seat-1');
    });

    // 顺序不能反：先 publishMicrophone，后 activateOwnSeat。
    expect(operations).toEqual(['rtc:audience:publishMicrophone', 'audience:activateOwnSeat:seat-1']);
  });

  it('发布麦克风失败：回滚麦位，且不激活', async () => {
    const { orchestrator, handlers } = setup({ failPublish: true });
    await orchestrator.start();
    operations = [];

    handlers().audience.handlers.command({
      type: 'seat.approved',
      seatId: 'seat-1',
      from: 'host-001',
    });
    await vi.waitFor(() => {
      expect(operations).toContain('audience:rollbackOwnSeat:seat-1');
    });

    expect(operations).toEqual([
      'rtc:audience:publishMicrophone',
      'audience:rollbackOwnSeat:seat-1',
    ]);
    expect(operations).not.toContain('audience:activateOwnSeat:seat-1');
  });

  it('失败路径给出可见反馈 —— 听众端视图上留下错误文案', async () => {
    const { orchestrator, handlers } = setup({ failPublish: true });
    await orchestrator.start();

    handlers().audience.handlers.command({
      type: 'seat.approved',
      seatId: 'seat-1',
      from: 'host-001',
    });
    await vi.waitFor(() => {
      expect(orchestrator.getView().audience.lastError).toBeDefined();
    });

    expect(orchestrator.getView().audience.lastError).toContain('上麦失败');
    expect(orchestrator.getView().audience.lastError).toContain('设备被占用');
  });

  it('接受邀请同样走「发布成功才激活」', async () => {
    const { orchestrator, handlers } = setup();
    await orchestrator.start();
    // 听众端要先有一份带邀请的快照，编排层才知道邀请落在哪个麦位。
    const base = voiceRoomStateAdapter.createInitial('host-001');
    handlers().audience.handlers.snapshot({
      ...base,
      invitation: {
        id: 'inv-1',
        userId: 'audience-001',
        displayName: '听众',
        seatId: 'seat-2',
        createdAt: 0,
        hostUserId: 'host-001',
      },
    });
    operations = [];

    await orchestrator.acceptInvitation();

    expect(operations).toEqual([
      'audience:acceptInvitation',
      'rtc:audience:publishMicrophone',
      'audience:activateOwnSeat:seat-2',
    ]);
  });

  it('seat.invited 只是通知，不擅自发布麦克风', async () => {
    const { orchestrator, handlers } = setup();
    await orchestrator.start();
    operations = [];

    handlers().audience.handlers.command({
      type: 'seat.invited',
      seatId: 'seat-2',
      invitationId: 'inv-1',
      from: 'host-001',
    });
    await Promise.resolve();

    expect(operations).toEqual([]);
  });
});

describe('强制麦控：先做 RTC 动作，再写 Storage 回 ack', () => {
  it('强制静音：setMicrophoneMuted 在 applyForcedMute 之前', async () => {
    const { orchestrator, handlers } = setup();
    await orchestrator.start();
    operations = [];

    handlers().audience.handlers.command({
      type: 'seat.mute',
      muted: true,
      commandId: 'cmd-1',
      from: 'host-001',
    });
    await vi.waitFor(() => {
      expect(operations).toContain('audience:applyForcedMute:true:cmd-1');
    });

    expect(operations).toEqual([
      'rtc:audience:setMicrophoneMuted:true',
      'audience:applyForcedMute:true:cmd-1',
    ]);
  });

  it('强制下麦：unpublishMicrophone 在 applyForcedLeave 之前', async () => {
    const { orchestrator, handlers } = setup();
    await orchestrator.start();
    operations = [];

    handlers().audience.handlers.command({
      type: 'seat.leave',
      commandId: 'cmd-2',
      from: 'host-001',
    });
    await vi.waitFor(() => {
      expect(operations).toContain('audience:applyForcedLeave:cmd-2');
    });

    expect(operations).toEqual([
      'rtc:audience:unpublishMicrophone',
      'audience:applyForcedLeave:cmd-2',
    ]);
  });
});

describe('被踢与被封：断开听众端并留下原因', () => {
  it('kicked 时断开听众端连接与 RTC，并置 exitReason', async () => {
    const { orchestrator, handlers } = setup();
    await orchestrator.start();
    operations = [];

    handlers().audience.handlers.exit('kicked');
    await vi.waitFor(() => {
      expect(operations).toContain('audience:disconnect');
    });

    expect(orchestrator.getView().audience.exitReason).toBe('kicked');
    expect(operations).toEqual(['rtc:audience:leave', 'audience:disconnect']);
  });

  it('banned 时同样断开，原因是 banned', async () => {
    const { orchestrator, handlers } = setup();
    await orchestrator.start();

    handlers().audience.handlers.exit('banned');
    await vi.waitFor(() => {
      expect(orchestrator.getView().audience.exitReason).toBe('banned');
    });
  });
});

describe('视图与订阅', () => {
  it('没有变化时 getView() 返回同一引用 —— 外部 store 钩子的硬要求', () => {
    const { orchestrator } = setup();

    expect(orchestrator.getView()).toBe(orchestrator.getView());
  });

  it('有变化时返回新引用，并通知订阅者', () => {
    const { orchestrator, handlers } = setup();
    const before = orchestrator.getView();
    const listener = vi.fn();
    orchestrator.subscribe(listener);

    handlers().host.handlers.presence(['host-001', 'audience-001']);

    expect(orchestrator.getView()).not.toBe(before);
    expect(orchestrator.getView().host.onlineUsers).toEqual(['host-001', 'audience-001']);
    expect(listener).toHaveBeenCalled();
  });

  it('退订后不再收到通知', () => {
    const { orchestrator, handlers } = setup();
    const listener = vi.fn();
    const unsubscribe = orchestrator.subscribe(listener);

    unsubscribe();
    handlers().host.handlers.presence(['host-001']);

    expect(listener).not.toHaveBeenCalled();
  });

  it('两端快照互不干扰 —— 各自记自己那一份', () => {
    const { orchestrator, handlers } = setup();

    handlers().host.handlers.snapshot(snapshotWithJoiningSeat());

    expect(orchestrator.getView().host.snapshot.seats['seat-1'].status).toBe('joining');
    expect(orchestrator.getView().audience.snapshot.seats['seat-1'].status).toBe('empty');
  });

  it('公屏消息按端累积，超过上限只留最近的', () => {
    const { orchestrator, handlers } = setup();

    for (let index = 0; index < 55; index += 1) {
      handlers().host.handlers.interaction({
        id: `evt-${index}`,
        type: 'chat',
        senderId: 'audience-001',
        displayName: '听众',
        value: `第 ${index} 条`,
        timestamp: index,
      });
    }

    const interactions = orchestrator.getView().host.interactions;
    expect(interactions).toHaveLength(50);
    expect(interactions[0].id).toBe('evt-5');
    expect(interactions[49].id).toBe('evt-54');
  });

  it('音量事件落到对应端的 volumes 上', () => {
    const { orchestrator, hostRtc } = setup();

    hostRtc.emit().volume({ 'audience-001': 62 });

    expect(orchestrator.getView().host.volumes['audience-001']).toBe(62);
  });
});

describe('操作失败不抛给 UI，而是转成该端的错误文案', () => {
  it('房主动作失败时留下错误，不 reject', async () => {
    const { orchestrator } = setup();
    const clients = orchestrator.getClients();
    clients.host.kickMember = async () => {
      throw new Error('权限不足');
    };

    await expect(orchestrator.kickMember('audience-001')).resolves.toBeUndefined();
    expect(orchestrator.getView().host.lastError).toBe('权限不足');
  });

  it('听众动作失败时留下错误，不 reject', async () => {
    const { orchestrator } = setup();
    const clients = orchestrator.getClients();
    clients.audience.requestSeat = async () => {
      throw new Error('已被封禁');
    };

    await expect(orchestrator.requestSeat('seat-1')).resolves.toBeUndefined();
    expect(orchestrator.getView().audience.lastError).toBe('已被封禁');
  });
});

describe('治理动作与互动透传', () => {
  it('房主治理动作落到房主端客户端', async () => {
    const { orchestrator } = setup();

    await orchestrator.forceMuteSeat('audience-001', true);
    await orchestrator.forceLeaveSeat('audience-001');
    await orchestrator.banMember('audience-001');
    await orchestrator.updateAnnouncement('欢迎');

    expect(operations).toEqual([
      'host:forceMuteSeat:audience-001:true',
      'host:forceLeaveSeat:audience-001',
      'host:banMember:audience-001',
      'host:updateAnnouncement:欢迎',
    ]);
  });

  it('邀请上麦带上听众的 uid 与昵称', async () => {
    const { orchestrator } = setup();

    await orchestrator.inviteToSeat('seat-3');

    expect(operations).toEqual(['host:inviteToSeat:audience-001:seat-3']);
  });

  it('互动按角色分发到对应端', async () => {
    const { orchestrator } = setup();

    await orchestrator.sendChatMessage('host', '大家好');
    await orchestrator.sendEmoji('audience', '👍');
    await orchestrator.sendGift('audience', 'rocket');

    expect(operations).toEqual([
      'host:sendChatMessage:大家好',
      'audience:sendEmoji:👍',
      'audience:sendGift:rocket',
    ]);
  });

  it('自己静音与自己下麦：RTC 动作在写 Storage 之前', async () => {
    const { orchestrator } = setup();

    await orchestrator.setOwnMuted(true);
    await orchestrator.leaveOwnSeat();

    expect(operations).toEqual([
      'rtc:audience:setMicrophoneMuted:true',
      'audience:setOwnMuted:true',
      'rtc:audience:unpublishMicrophone',
      'audience:leaveOwnSeat',
    ]);
  });
});

describe('isSpeaking', () => {
  it('超过阈值才算在说话', () => {
    expect(isSpeaking({ 'audience-001': 31 }, 'audience-001')).toBe(true);
    expect(isSpeaking({ 'audience-001': 30 }, 'audience-001')).toBe(false);
  });

  it('没有 uid 或没有音量记录时都不算在说话', () => {
    expect(isSpeaking({ 'audience-001': 99 }, undefined)).toBe(false);
    expect(isSpeaking({}, 'audience-001')).toBe(false);
  });
});
