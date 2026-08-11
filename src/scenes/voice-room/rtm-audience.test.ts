/**
 * 听众端 RTM 单文件的测试。
 *
 * 范式与房主端测试一致：**假 SDK 记录一个字符串调用轨迹数组，断言字符串序列**。
 * 注入点在 SDK 工厂（`createClient`），不是 port —— port 分层已废弃。
 *
 * 连接、Lock、消息封装、去重、trace、重连这几组是从房主端测试复制改造的
 * （改 uid 与角色），这与两份实现文件的刻意重复是同一个取舍。
 * **听众专属的行为集中在「听众专属行为」与「治理命令的对端」两个 describe 里。**
 */

import { describe, expect, it, vi } from 'vitest';

import {
  createVoiceRoomAudienceClient,
  type IncomingCommand,
  type VoiceRoomAudienceHandlers,
} from './rtm-audience';
import { voiceRoomStateAdapter } from './stateAdapter';
import type { VoiceRoomSnapshot } from './state';

const APP_ID = 'app-id';
const ROOM_ID = 'room-1';
const HOST_UID = 'host-001';
const AUDIENCE_UID = 'audience-001';

/** 带错误码的假 SDK 错误，形状对齐 RTM 的 `ErrorInfo`。 */
function sdkError(errorCode: number, reason: string): unknown {
  return { error: true, errorCode, reason, operation: 'test' };
}

interface FakeClientControls {
  operations: string[];
  listeners: Map<string, (event: never) => void>;
  metadata: { majorRevision: number; values: Record<string, string> };
  presencePages: Array<{ occupants: Array<{ userId: string }>; nextPage: string }>;
  failures: Map<string, unknown>;
  /** 置 true 让下一次 `acquireLock` 抛 LOCK_NOT_EXIST，抛完自动复位。 */
  acquireLockFailNext: boolean;
  emit(name: string, event: unknown): void;
}

function fakeSdk(initialSnapshot?: VoiceRoomSnapshot) {
  const operations: string[] = [];
  const listeners = new Map<string, (event: never) => void>();
  const failures = new Map<string, unknown>();
  const publishedMessages: string[] = [];

  const controls: FakeClientControls = {
    operations,
    listeners,
    metadata: {
      majorRevision: 1,
      values: initialSnapshot ? { 'voice-room-state': JSON.stringify(initialSnapshot) } : {},
    },
    presencePages: [{ occupants: [{ userId: HOST_UID }, { userId: AUDIENCE_UID }], nextPage: '' }],
    failures,
    acquireLockFailNext: false,
    emit(name, event) {
      const listener = listeners.get(name);
      if (!listener) throw new Error(`没有注册 ${name} 监听器`);
      listener(event as never);
    },
  };

  /** 事件是否在 login 之前注册完 —— 专门盯这条顺序。 */
  let listenersAtLogin = 0;

  function maybeFail(key: string): void {
    if (failures.has(key)) throw failures.get(key);
  }

  const client = {
    addEventListener(name: string, listener: (event: never) => void) {
      listeners.set(name, listener);
    },
    async login(options?: { token?: string }) {
      listenersAtLogin = listeners.size;
      operations.push(`rtm:login:${AUDIENCE_UID}${options?.token ? ':token' : ''}`);
      maybeFail('login');
      return {};
    },
    async logout() {
      operations.push('rtm:logout');
      maybeFail('logout');
      return {};
    },
    async subscribe(channelName: string, options?: Record<string, boolean>) {
      const flags = ['withMessage', 'withPresence', 'withMetadata', 'withLock'].filter(
        (flag) => options?.[flag],
      ).length;
      operations.push(`rtm:subscribe:${channelName}:${flags}`);
      maybeFail('subscribe');
      return {};
    },
    async unsubscribe(channelName: string) {
      operations.push(`rtm:unsubscribe:${channelName}`);
      maybeFail('unsubscribe');
      return {};
    },
    async publish(
      channelName: string,
      message: string,
      options?: { channelType?: 'MESSAGE' | 'USER' },
    ) {
      const envelope = JSON.parse(message) as { type: string };
      const kind = options?.channelType === 'USER' ? 'user' : 'channel';
      operations.push(`rtm:publish:${kind}:${channelName}:${envelope.type}`);
      publishedMessages.push(message);
      maybeFail('publish');
      return {};
    },
    presence: {
      async getOnlineUsers(
        channelName: string,
        _channelType: 'MESSAGE',
        options?: { page?: string },
      ) {
        operations.push(`presence:get:${channelName}`);
        maybeFail('getOnlineUsers');
        const index = options?.page ? Number(options.page) : 0;
        return controls.presencePages[index] ?? { occupants: [], nextPage: '' };
      },
    },
    storage: {
      async getChannelMetadata(_channelName: string, _channelType: 'MESSAGE') {
        operations.push('storage:get');
        maybeFail('getChannelMetadata');
        return {
          majorRevision: controls.metadata.majorRevision,
          metadata: Object.fromEntries(
            Object.entries(controls.metadata.values).map(([key, value]) => [key, { value }]),
          ),
        };
      },
      async setChannelMetadata(
        _channelName: string,
        _channelType: 'MESSAGE',
        data: Array<{ key: string; value: string }>,
        options?: { majorRevision?: number; lockName?: string },
      ) {
        const snapshot = JSON.parse(data[0].value) as VoiceRoomSnapshot;
        operations.push(
          `storage:set:${snapshot.revision}:${options?.lockName ?? ''}:major=${options?.majorRevision}`,
        );
        maybeFail('setChannelMetadata');
        controls.metadata = {
          majorRevision: controls.metadata.majorRevision + 1,
          values: { ...controls.metadata.values, [data[0].key]: data[0].value },
        };
        return {};
      },
    },
    lock: {
      async setLock(_channelName: string, _channelType: 'MESSAGE', lockName: string) {
        operations.push(`lock:set:${lockName}`);
        maybeFail('setLock');
        return {};
      },
      async acquireLock(
        _channelName: string,
        _channelType: 'MESSAGE',
        lockName: string,
        _options?: { retry?: boolean },
      ) {
        operations.push(`lock:acquire:${lockName}`);
        if (controls.acquireLockFailNext) {
          controls.acquireLockFailNext = false;
          throw sdkError(-14008, 'LOCK_NOT_EXIST');
        }
        maybeFail('acquireLock');
        return {};
      },
      async releaseLock(_channelName: string, _channelType: 'MESSAGE', lockName: string) {
        operations.push(`lock:release:${lockName}`);
        maybeFail('releaseLock');
        return {};
      },
    },
  };

  return {
    controls,
    client,
    publishedMessages,
    createClient: vi.fn(() => client),
    get listenersAtLogin() {
      return listenersAtLogin;
    },
  };
}

function recordingHandlers() {
  const errors: string[] = [];
  const linkStates: string[] = [];
  const snapshots: VoiceRoomSnapshot[] = [];
  const interactions: Array<{ type: string; value: string; senderId: string }> = [];
  const presences: Array<readonly string[]> = [];
  const commands: IncomingCommand[] = [];
  const exits: Array<'kicked' | 'banned'> = [];

  const handlers: VoiceRoomAudienceHandlers = {
    linkState: (state) => linkStates.push(state),
    snapshot: (snapshot) => snapshots.push(snapshot),
    interaction: (event) =>
      interactions.push({ type: event.type, value: event.value, senderId: event.senderId }),
    presence: (userIds) => presences.push(userIds),
    command: (command) => commands.push(command),
    exit: (reason) => exits.push(reason),
    error: (message) => errors.push(message),
  };

  return { handlers, errors, linkStates, snapshots, interactions, presences, commands, exits };
}

function setup(options: { snapshot?: VoiceRoomSnapshot } = {}) {
  const sdk = fakeSdk(options.snapshot);
  const recorder = recordingHandlers();
  let clock = 1_000;

  const client = createVoiceRoomAudienceClient({
    appId: APP_ID,
    roomId: ROOM_ID,
    userId: AUDIENCE_UID,
    displayName: '听众',
    stateAdapter: voiceRoomStateAdapter,
    handlers: recorder.handlers,
    createClient: sdk.createClient as never,
    // 每次读时钟前进 5ms，于是 api 节点的耗时是确定值，可断言。
    now: () => (clock += 5),
  });

  return { sdk, client, ...recorder, ops: sdk.controls.operations };
}

/** 房间已由房主建好的基础快照。 */
function roomSnapshot(): VoiceRoomSnapshot {
  const initial = voiceRoomStateAdapter.createInitial(HOST_UID, '房主');
  return { ...initial, revision: 3 };
}

/** 本听众已在麦上的快照。 */
function snapshotWithSelfSeated(muted = false): VoiceRoomSnapshot {
  const base = roomSnapshot();
  return {
    ...base,
    revision: 6,
    seats: {
      ...base.seats,
      'seat-1': {
        seatId: 'seat-1',
        userId: AUDIENCE_UID,
        displayName: '听众',
        status: muted ? 'muted' : 'active',
        muted,
      },
    },
  };
}

/** 本听众有一条待处理邀请的快照。 */
function snapshotWithInvitation(): VoiceRoomSnapshot {
  const base = roomSnapshot();
  return {
    ...base,
    revision: 4,
    invitation: {
      id: 'inv-1',
      hostUserId: HOST_UID,
      userId: AUDIENCE_UID,
      displayName: '听众',
      seatId: 'seat-2',
      createdAt: 1,
    },
  };
}

/** 本听众正在排麦的快照。 */
function snapshotWithOwnRequest(): VoiceRoomSnapshot {
  const base = roomSnapshot();
  return {
    ...base,
    revision: 5,
    queue: [
      { id: 'req-1', userId: AUDIENCE_UID, displayName: '听众', seatId: 'seat-1', createdAt: 1 },
    ],
  };
}

/** 本听众处于 joining（房主已同意，等媒体发布）的快照。 */
function snapshotWithSelfJoining(): VoiceRoomSnapshot {
  const base = roomSnapshot();
  return {
    ...base,
    revision: 7,
    seats: {
      ...base.seats,
      'seat-1': {
        seatId: 'seat-1',
        userId: AUDIENCE_UID,
        displayName: '听众',
        status: 'joining',
        muted: false,
      },
    },
  };
}

async function connected(options: Parameters<typeof setup>[0] = { snapshot: roomSnapshot() }) {
  const context = setup(options);
  await context.client.connect();
  context.ops.length = 0;
  return context;
}

/** 造一条默认合法、可局部覆盖的信封。 */
function envelopeFrom(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const sentAt = Date.now();
  return {
    schemaVersion: 1,
    messageId: `msg-${Math.random().toString(36).slice(2)}`,
    type: 'chat.message',
    roomId: ROOM_ID,
    senderId: HOST_UID,
    sentAt,
    expiresAt: sentAt + 15_000,
    requiresAck: false,
    payload: { value: '你好', displayName: '房主' },
    ...overrides,
  };
}

/** 发一条点对点消息给本听众。 */
function emitToSelf(sdk: ReturnType<typeof fakeSdk>, overrides: Record<string, unknown>): void {
  sdk.controls.emit('message', {
    channelType: 'USER',
    channelName: AUDIENCE_UID,
    publisher: HOST_UID,
    message: JSON.stringify(envelopeFrom({ targetId: AUDIENCE_UID, ...overrides })),
    timestamp: Date.now(),
  });
}

/** 让事件处理器里的 `void promise` 走完微任务队列。 */
async function flush(): Promise<void> {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
}

async function readSource(): Promise<string> {
  // 用 Vite 的 `?raw` 而不是 node API：`tsconfig.app.json` 的 `types` 里没有 `node`。
  const module = (await import('./rtm-audience.ts?raw')) as { default: string };
  return module.default;
}

// ===========================================================================
describe('连接与分阶段回滚', () => {
  it('注册事件必须在 login 之前 —— 晚注册会漏掉早期事件', async () => {
    const { client, sdk } = setup({ snapshot: roomSnapshot() });

    await client.connect();

    // linkState / message / presence / storage / lock / token 六类
    expect(sdk.listenersAtLogin).toBe(6);
  });

  it('连接顺序是 login → subscribe → presence → storage，四类能力一起订', async () => {
    const { client, ops } = setup({ snapshot: roomSnapshot() });

    await client.connect();

    expect(ops).toEqual([
      `rtm:login:${AUDIENCE_UID}`,
      // 尾数 4 = withMessage/withPresence/withMetadata/withLock 全开
      `rtm:subscribe:${ROOM_ID}:4`,
      `presence:get:${ROOM_ID}`,
      'storage:get',
    ]);
  });

  it('听众读不到房间状态时不写初始快照 —— 房间由房主创建', async () => {
    // 不给初始快照：Storage 是空的
    const { client, ops, snapshots } = setup();

    await client.connect();

    expect(ops.some((op) => op.startsWith('storage:set'))).toBe(false);
    // 也不该拿锁 —— 只读路径不需要
    expect(ops.some((op) => op.startsWith('lock:'))).toBe(false);
    expect(snapshots).toHaveLength(0);
  });

  it('读到房间状态时同步给上层', async () => {
    const { client, snapshots } = setup({ snapshot: roomSnapshot() });

    await client.connect();

    expect(snapshots.at(-1)?.revision).toBe(3);
    expect(snapshots.at(-1)?.hostUserId).toBe(HOST_UID);
  });

  it('自己在封禁名单里时连接失败', async () => {
    const banned = { ...roomSnapshot(), bannedUserIds: [AUDIENCE_UID] };
    const { client } = setup({ snapshot: banned });

    await expect(client.connect()).rejects.toThrow('该用户已被房间封禁');
    expect(client.getLinkState()).toBe('failed');
  });

  it('订阅失败时清理已完成的步骤', async () => {
    const { client, sdk, ops } = setup({ snapshot: roomSnapshot() });
    sdk.controls.failures.set('subscribe', new Error('订阅失败'));

    await expect(client.connect()).rejects.toThrow('订阅失败');

    // subscribe 失败时 subscribed 标记未置位，所以只 logout
    expect(ops.filter((op) => op === 'rtm:logout')).toHaveLength(1);
  });

  it('清理过程中再抛异常时暴露的仍是最初的失败原因', async () => {
    const { client, sdk } = setup({ snapshot: roomSnapshot() });
    sdk.controls.failures.set('getOnlineUsers', new Error('最初的失败'));
    sdk.controls.failures.set('unsubscribe', new Error('清理时的失败'));
    sdk.controls.failures.set('logout', new Error('清理时的另一个失败'));

    // 清理阶段的两个异常都被吞掉，冒出来的是最初那个
    await expect(client.connect()).rejects.toThrow('最初的失败');
  });

  it('订阅成功后失败时逆序清理：先 unsubscribe 再 logout', async () => {
    const { client, sdk, ops } = setup({ snapshot: roomSnapshot() });
    sdk.controls.failures.set('getOnlineUsers', new Error('拉在线状态失败'));

    await expect(client.connect()).rejects.toThrow('拉在线状态失败');

    const unsubscribeIndex = ops.indexOf(`rtm:unsubscribe:${ROOM_ID}`);
    const logoutIndex = ops.indexOf('rtm:logout');
    expect(unsubscribeIndex).toBeGreaterThanOrEqual(0);
    expect(logoutIndex).toBeGreaterThan(unsubscribeIndex);
  });

  it('连接失败后链路状态是 failed', async () => {
    const { client, sdk, linkStates } = setup({ snapshot: roomSnapshot() });
    sdk.controls.failures.set('login', new Error('登录失败'));

    await expect(client.connect()).rejects.toThrow('登录失败');

    expect(linkStates.at(-1)).toBe('failed');
  });

  it('重复 connect 不重复登录', async () => {
    const { client, ops } = setup({ snapshot: roomSnapshot() });

    await client.connect();
    await client.connect();

    expect(ops.filter((op) => op.startsWith('rtm:login'))).toHaveLength(1);
  });

  it('disconnect 先退订再登出', async () => {
    const { client, ops } = await connected();

    await client.disconnect();

    expect(ops).toEqual([`rtm:unsubscribe:${ROOM_ID}`, 'rtm:logout']);
  });

  it('传了 token 就带上 —— 参数位保留但默认不传', async () => {
    const sdk = fakeSdk(roomSnapshot());
    const recorder = recordingHandlers();
    const client = createVoiceRoomAudienceClient({
      appId: APP_ID,
      roomId: ROOM_ID,
      userId: AUDIENCE_UID,
      displayName: '听众',
      token: 'the-token',
      stateAdapter: voiceRoomStateAdapter,
      handlers: recorder.handlers,
      createClient: sdk.createClient as never,
    });

    await client.connect();

    expect(sdk.controls.operations[0]).toBe(`rtm:login:${AUDIENCE_UID}:token`);
  });
});

// ===========================================================================
describe('Lock 与乐观并发', () => {
  it('完整轨迹：获取锁 → 重新读快照 → 带修订号写入 → 释放锁', async () => {
    const { client, ops } = await connected({ snapshot: roomSnapshot() });

    await client.requestSeat('seat-1');

    expect(ops.slice(0, 4)).toEqual([
      'lock:acquire:room-state',
      'storage:get',
      // revision 从 3 递增到 4，带上 majorRevision 做乐观并发
      'storage:set:4:room-state:major=1',
      'lock:release:room-state',
    ]);
  });

  it('转移函数抛异常时释放锁仍然发生', async () => {
    // 没有排麦记录时取消申请会被领域规则拒绝
    const { client, ops } = await connected({ snapshot: roomSnapshot() });

    await expect(client.cancelSeatRequest()).rejects.toThrow();

    expect(ops).toEqual(['lock:acquire:room-state', 'storage:get', 'lock:release:room-state']);
  });

  it('写入失败时释放锁仍然发生', async () => {
    const { client, sdk, ops } = await connected({ snapshot: roomSnapshot() });
    sdk.controls.failures.set('setChannelMetadata', new Error('写入失败'));

    await expect(client.requestSeat('seat-1')).rejects.toThrow('写入失败');

    expect(ops.at(-1)).toBe('lock:release:room-state');
  });

  it('锁不存在时先创建再重新获取', async () => {
    const { client, sdk, ops } = await connected({ snapshot: roomSnapshot() });
    sdk.controls.acquireLockFailNext = true;

    await client.requestSeat('seat-1');

    expect(ops.slice(0, 3)).toEqual([
      'lock:acquire:room-state',
      'lock:set:room-state',
      'lock:acquire:room-state',
    ]);
  });

  it('容忍对端抢先创建导致的「锁已存在」竞态', async () => {
    const { client, sdk, ops } = await connected({ snapshot: roomSnapshot() });
    sdk.controls.acquireLockFailNext = true;
    sdk.controls.failures.set('setLock', sdkError(-14004, 'LOCK_ALREADY_EXIST'));

    // 不抛错，继续走到写入
    await client.requestSeat('seat-1');

    expect(ops).toContain('lock:set:room-state');
    expect(ops.some((op) => op.startsWith('storage:set'))).toBe(true);
  });

  it('setLock 遇到其他错误码时如实上抛', async () => {
    const { client, sdk } = await connected({ snapshot: roomSnapshot() });
    sdk.controls.acquireLockFailNext = true;
    sdk.controls.failures.set('setLock', sdkError(-14003, 'LOCK_OPERATION_FAILED'));

    await expect(client.requestSeat('seat-1')).rejects.toMatchObject({ errorCode: -14003 });
  });

  it('mutate 用重新读回的快照而不是本地缓存', async () => {
    const { client, sdk, snapshots } = await connected({ snapshot: roomSnapshot() });
    // 模拟对端在此期间写入了更新的快照
    sdk.controls.metadata = {
      majorRevision: 9,
      values: { 'voice-room-state': JSON.stringify({ ...roomSnapshot(), revision: 42 }) },
    };

    await client.requestSeat('seat-1');

    // 43 而不是 4：说明用的是重新读回的 42，不是本地的 3
    expect(snapshots.at(-1)?.revision).toBe(43);
  });
});

// ===========================================================================
describe('消息封装与去重', () => {
  it('发出的消息是合法信封：版本号、消息 ID、过期时间齐备', async () => {
    const { client, sdk } = await connected();

    await client.sendChatMessage('你好');

    const envelope = JSON.parse(sdk.publishedMessages.at(-1)!) as Record<string, unknown>;
    expect(envelope.schemaVersion).toBe(1);
    expect(typeof envelope.messageId).toBe('string');
    expect(envelope.roomId).toBe(ROOM_ID);
    expect(envelope.senderId).toBe(AUDIENCE_UID);
    expect(envelope.expiresAt as number).toBeGreaterThan(envelope.sentAt as number);
  });

  it('房间不匹配的消息被丢弃', async () => {
    const { sdk, interactions } = await connected();

    sdk.controls.emit('message', {
      channelType: 'MESSAGE',
      channelName: ROOM_ID,
      publisher: HOST_UID,
      message: JSON.stringify(envelopeFrom({ roomId: 'other-room' })),
      timestamp: Date.now(),
    });
    await flush();

    expect(interactions).toHaveLength(0);
  });

  it('目标不是自己的消息被丢弃', async () => {
    const { sdk, interactions } = await connected();

    sdk.controls.emit('message', {
      channelType: 'USER',
      channelName: AUDIENCE_UID,
      publisher: HOST_UID,
      message: JSON.stringify(envelopeFrom({ targetId: 'someone-else' })),
      timestamp: Date.now(),
    });
    await flush();

    expect(interactions).toHaveLength(0);
  });

  it('已过期的消息被丢弃', async () => {
    const { sdk, interactions } = await connected();

    sdk.controls.emit('message', {
      channelType: 'MESSAGE',
      channelName: ROOM_ID,
      publisher: HOST_UID,
      message: JSON.stringify(envelopeFrom({ sentAt: 1, expiresAt: 2 })),
      timestamp: Date.now(),
    });
    await flush();

    expect(interactions).toHaveLength(0);
  });

  it('协议版本不符的消息被丢弃', async () => {
    const { sdk, interactions } = await connected();

    sdk.controls.emit('message', {
      channelType: 'MESSAGE',
      channelName: ROOM_ID,
      publisher: HOST_UID,
      message: JSON.stringify(envelopeFrom({ schemaVersion: 2 })),
      timestamp: Date.now(),
    });
    await flush();

    expect(interactions).toHaveLength(0);
  });

  it('同一消息 ID 收两次时第二次不触发业务处理', async () => {
    const { sdk, interactions } = await connected();
    const message = JSON.stringify(envelopeFrom({ messageId: 'dup-1' }));

    for (let i = 0; i < 2; i += 1) {
      sdk.controls.emit('message', {
        channelType: 'MESSAGE',
        channelName: ROOM_ID,
        publisher: HOST_UID,
        message,
        timestamp: Date.now(),
      });
    }
    await flush();

    expect(interactions).toHaveLength(1);
  });

  it('不是有效 JSON 的消息被丢弃且不抛错', async () => {
    const { sdk, interactions, errors } = await connected();

    sdk.controls.emit('message', {
      channelType: 'MESSAGE',
      channelName: ROOM_ID,
      publisher: HOST_UID,
      message: '{ 不是 JSON',
      timestamp: Date.now(),
    });
    await flush();

    expect(interactions).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });
});

// ===========================================================================
describe('听众专属行为：对自己的操作不需要 ack', () => {
  it('给自己静音：写快照后广播，requiresAck 为 false', async () => {
    const { client, sdk, ops } = await connected({ snapshot: snapshotWithSelfSeated() });

    await client.setOwnMuted(true);

    expect(ops).toEqual([
      'lock:acquire:room-state',
      'storage:get',
      'storage:set:7:room-state:major=1',
      'lock:release:room-state',
      `rtm:publish:channel:${ROOM_ID}:seat.mute.changed`,
    ]);
    const envelope = JSON.parse(sdk.publishedMessages.at(-1)!) as Record<string, unknown>;
    // 对自己的操作没有对端要确认
    expect(envelope.requiresAck).toBe(false);
    expect(envelope.targetId).toBeUndefined();
  });

  it('取消自己的静音同样不需要 ack', async () => {
    const { client, sdk } = await connected({ snapshot: snapshotWithSelfSeated(true) });

    await client.setOwnMuted(false);

    const envelope = JSON.parse(sdk.publishedMessages.at(-1)!) as Record<string, unknown>;
    expect(envelope.type).toBe('seat.mute.changed');
    expect(envelope.requiresAck).toBe(false);
  });

  it('主动下麦：写快照后广播，requiresAck 为 false', async () => {
    const { client, sdk, ops } = await connected({ snapshot: snapshotWithSelfSeated() });

    await client.leaveOwnSeat();

    expect(ops.at(-1)).toBe(`rtm:publish:channel:${ROOM_ID}:seat.left`);
    const envelope = JSON.parse(sdk.publishedMessages.at(-1)!) as Record<string, unknown>;
    expect(envelope.requiresAck).toBe(false);
  });

  it('申请上麦：写排麦队列后点对点通知房主', async () => {
    const { client, sdk, ops, snapshots } = await connected({ snapshot: roomSnapshot() });

    await client.requestSeat('seat-1');

    expect(ops.at(-1)).toBe(`rtm:publish:user:${HOST_UID}:seat.request`);
    expect(snapshots.at(-1)?.queue).toHaveLength(1);
    expect(snapshots.at(-1)?.queue[0].userId).toBe(AUDIENCE_UID);
    const envelope = JSON.parse(sdk.publishedMessages.at(-1)!) as Record<string, unknown>;
    expect(envelope.requiresAck).toBe(false);
    expect(envelope.targetId).toBe(HOST_UID);
  });

  it('取消申请：写快照后通知房主', async () => {
    const { client, ops, snapshots } = await connected({ snapshot: snapshotWithOwnRequest() });

    await client.cancelSeatRequest();

    expect(ops.at(-1)).toBe(`rtm:publish:user:${HOST_UID}:seat.request.cancelled`);
    expect(snapshots.at(-1)?.queue).toHaveLength(0);
  });

  it('接受邀请：麦位先进 joining，不直接 active', async () => {
    const { client, snapshots } = await connected({ snapshot: snapshotWithInvitation() });

    await client.acceptInvitation();

    // 媒体还没发布，必须是 joining —— 这个顺序不能改
    expect(snapshots.at(-1)?.seats['seat-2'].status).toBe('joining');
    expect(snapshots.at(-1)?.invitation).toBeNull();
  });

  it('拒绝邀请：写快照后通知房主', async () => {
    const { client, sdk, ops, snapshots } = await connected({
      snapshot: snapshotWithInvitation(),
    });

    await client.rejectInvitation();

    expect(ops.at(-1)).toBe(`rtm:publish:user:${HOST_UID}:seat.invitation.rejected`);
    expect(snapshots.at(-1)?.invitation).toBeNull();
    const envelope = JSON.parse(sdk.publishedMessages.at(-1)!) as {
      payload: { invitationId: string };
    };
    expect(envelope.payload.invitationId).toBe('inv-1');
  });

  it('媒体发布成功后把自己的麦位转 active 并广播', async () => {
    const { client, ops, snapshots } = await connected({ snapshot: snapshotWithSelfJoining() });

    await client.activateOwnSeat('seat-1');

    expect(snapshots.at(-1)?.seats['seat-1'].status).toBe('active');
    expect(ops.at(-1)).toBe(`rtm:publish:channel:${ROOM_ID}:seat.media-ready`);
  });

  it('媒体发布失败时回滚自己的麦位', async () => {
    const { client, snapshots } = await connected({ snapshot: snapshotWithSelfJoining() });

    await client.rollbackOwnSeat('seat-1');

    expect(snapshots.at(-1)?.seats['seat-1'].status).toBe('empty');
    expect(snapshots.at(-1)?.seats['seat-1'].userId).toBeUndefined();
  });

  it('公屏消息广播到频道并本地回显一次', async () => {
    const { client, ops, interactions } = await connected();

    await client.sendChatMessage('大家好');

    expect(ops).toEqual([`rtm:publish:channel:${ROOM_ID}:chat.message`]);
    expect(interactions).toEqual([{ type: 'chat', value: '大家好', senderId: AUDIENCE_UID }]);
  });

  it('表情与礼物各走自己的消息类型', async () => {
    const { client, ops } = await connected();

    await client.sendEmoji('👏');
    await client.sendGift('rose');

    expect(ops).toEqual([
      `rtm:publish:channel:${ROOM_ID}:emoji.reaction`,
      `rtm:publish:channel:${ROOM_ID}:gift.sent`,
    ]);
  });

  it('空互动内容被拒绝且不发消息', async () => {
    const { client, ops } = await connected();

    await expect(client.sendChatMessage('   ')).rejects.toThrow('互动内容不能为空');

    expect(ops).toHaveLength(0);
  });

  it('自己发的频道消息回显时不重复计入互动', async () => {
    const { client, sdk, interactions } = await connected();

    await client.sendChatMessage('回显测试');
    const sent = sdk.publishedMessages.at(-1)!;

    sdk.controls.emit('message', {
      channelType: 'MESSAGE',
      channelName: ROOM_ID,
      publisher: AUDIENCE_UID,
      message: sent,
      timestamp: Date.now(),
    });
    await flush();

    expect(interactions).toHaveLength(1);
  });

  it('未连接时调用语义方法抛「尚未连接」', async () => {
    const { client } = setup({ snapshot: roomSnapshot() });

    await expect(client.requestSeat('seat-1')).rejects.toThrow('RTM 尚未连接');
  });
});

// ===========================================================================
describe('治理命令的对端：收到后要回 ack', () => {
  it('收到强制静音命令时交给容器，不自行做 RTC', async () => {
    const { sdk, commands } = await connected({ snapshot: snapshotWithSelfSeated() });

    emitToSelf(sdk, { type: 'seat.mute.command', messageId: 'cmd-1', payload: { muted: true } });
    await flush();

    expect(commands).toEqual([
      { type: 'seat.mute', muted: true, commandId: 'cmd-1', from: HOST_UID },
    ]);
  });

  it('执行强制静音后写 Storage 并回 ack', async () => {
    const { client, sdk, ops } = await connected({ snapshot: snapshotWithSelfSeated() });

    await client.applyForcedMute(true, 'cmd-1', HOST_UID);

    expect(ops).toEqual([
      'lock:acquire:room-state',
      'storage:get',
      'storage:set:7:room-state:major=1',
      'lock:release:room-state',
      `rtm:publish:user:${HOST_UID}:command.ack`,
    ]);
    const ack = JSON.parse(sdk.publishedMessages.at(-1)!) as {
      payload: { commandId: string; status: string };
    };
    expect(ack.payload.commandId).toBe('cmd-1');
    expect(ack.payload.status).toBe('EXECUTED');
  });

  it('收到强制下麦命令时交给容器', async () => {
    const { sdk, commands } = await connected({ snapshot: snapshotWithSelfSeated() });

    emitToSelf(sdk, { type: 'seat.leave.command', messageId: 'cmd-2', payload: {} });
    await flush();

    expect(commands).toEqual([{ type: 'seat.leave', commandId: 'cmd-2', from: HOST_UID }]);
  });

  it('执行强制下麦后写 Storage 并回 ack', async () => {
    const { client, sdk, ops } = await connected({ snapshot: snapshotWithSelfSeated() });

    await client.applyForcedLeave('cmd-2', HOST_UID);

    expect(ops.at(-1)).toBe(`rtm:publish:user:${HOST_UID}:command.ack`);
    const ack = JSON.parse(sdk.publishedMessages.at(-1)!) as { payload: { commandId: string } };
    expect(ack.payload.commandId).toBe('cmd-2');
  });

  it('收到踢出命令时先回 ack 再通知退出 —— 顺序反了 ack 发不出去', async () => {
    const { sdk, ops, exits } = await connected({ snapshot: roomSnapshot() });

    emitToSelf(sdk, { type: 'member.kick', messageId: 'cmd-3', payload: {} });
    await flush();

    expect(ops).toEqual([`rtm:publish:user:${HOST_UID}:command.ack`]);
    expect(exits).toEqual(['kicked']);
  });

  it('收到封禁命令时同样先回 ack 再通知退出', async () => {
    const { sdk, ops, exits } = await connected({ snapshot: roomSnapshot() });

    emitToSelf(sdk, { type: 'member.ban', messageId: 'cmd-4', payload: {} });
    await flush();

    expect(ops).toEqual([`rtm:publish:user:${HOST_UID}:command.ack`]);
    expect(exits).toEqual(['banned']);
  });

  it('回的 ack 自己不需要再被 ack', async () => {
    const { client, sdk } = await connected({ snapshot: snapshotWithSelfSeated() });

    await client.applyForcedLeave('cmd-5', HOST_UID);

    const ack = JSON.parse(sdk.publishedMessages.at(-1)!) as Record<string, unknown>;
    expect(ack.requiresAck).toBe(false);
  });

  it('收到房主同意上麦时交给容器发布麦克风', async () => {
    const { sdk, commands } = await connected({ snapshot: snapshotWithSelfJoining() });

    emitToSelf(sdk, {
      type: 'seat.approved',
      messageId: 'cmd-6',
      payload: { requestId: 'req-1', seatId: 'seat-1' },
    });
    await flush();

    expect(commands).toEqual([{ type: 'seat.approved', seatId: 'seat-1', from: HOST_UID }]);
  });

  it('收到上麦邀请时交给容器', async () => {
    const { sdk, commands } = await connected({ snapshot: roomSnapshot() });

    emitToSelf(sdk, {
      type: 'seat.invited',
      messageId: 'cmd-7',
      payload: { invitationId: 'inv-9', seatId: 'seat-2' },
    });
    await flush();

    expect(commands).toEqual([
      { type: 'seat.invited', seatId: 'seat-2', invitationId: 'inv-9', from: HOST_UID },
    ]);
  });

  it('纯通知类消息不产生命令也不报错', async () => {
    const { sdk, commands, errors } = await connected({ snapshot: roomSnapshot() });

    emitToSelf(sdk, { type: 'seat.rejected', messageId: 'note-1', payload: { requestId: 'r' } });
    await flush();

    expect(commands).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });
});

// ===========================================================================
describe('trace 采集', () => {
  it('每次 API 调用产生一条带耗时的 api 节点', async () => {
    const { client } = await connected();

    const login = client.getTraces().find((entry) => entry.name === 'rtm.login');
    expect(login).toMatchObject({ kind: 'api', durationMs: 5 });
  });

  it('每次收到事件产生一条事件节点', async () => {
    const { client, sdk } = await connected();

    sdk.controls.emit('storage', {
      channelName: ROOM_ID,
      channelType: 'MESSAGE',
      publisher: HOST_UID,
      storageType: 'CHANNEL',
      eventType: 'UPDATE',
      data: { majorRevision: 7, metadata: {} },
    });

    expect(client.getTraces().filter((entry) => entry.kind === 'event')).toHaveLength(1);
  });

  it('API 失败时带错误码与错误信息', async () => {
    const { client, sdk } = setup({ snapshot: roomSnapshot() });
    sdk.controls.failures.set('login', sdkError(-10001, 'LOGIN_FAILED'));

    await expect(client.connect()).rejects.toBeDefined();

    const login = client.getTraces().find((entry) => entry.name === 'rtm.login');
    expect(login?.errorCode).toBe(-10001);
    expect(login?.errorMessage).toContain('LOGIN_FAILED');
  });

  it('每条 trace 都带自己的 uid 与角色 —— 归并后来源不能丢', async () => {
    const { client } = await connected();

    const traces = client.getTraces();
    expect(traces.length).toBeGreaterThan(0);
    for (const entry of traces) {
      expect(entry.uid).toBe(AUDIENCE_UID);
      // 角色是 audience，与房主端区分
      expect(entry.role).toBe('audience');
    }
  });

  it('trace 只有 api 与 event 两种类型', async () => {
    const { client, sdk } = await connected();

    sdk.controls.emit('lock', {
      channelName: ROOM_ID,
      channelType: 'MESSAGE',
      eventType: 'SET',
      lockName: 'room-state',
      ttl: 10,
      publisher: HOST_UID,
    });

    for (const entry of client.getTraces()) {
      expect(['api', 'event']).toContain(entry.kind);
    }
  });

  it('seq 单调递增，可作同毫秒的稳定次序', async () => {
    const { client } = await connected();

    const seqs = client.getTraces().map((entry) => entry.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it('订阅者在每次写入后被通知', async () => {
    const { client } = await connected();
    const listener = vi.fn();
    const unsubscribe = client.subscribeTraces(listener);

    await client.requestSeat('seat-1');
    expect(listener).toHaveBeenCalled();

    const callsBefore = listener.mock.calls.length;
    unsubscribe();
    await client.cancelSeatRequest();
    expect(listener.mock.calls.length).toBe(callsBefore);
  });

  it('快照未变时返回同一引用 —— 外部 store 订阅钩子的硬要求', async () => {
    const { client } = await connected();

    const first = client.getTraces();
    expect(client.getTraces()).toBe(first);

    await client.requestSeat('seat-1');
    expect(client.getTraces()).not.toBe(first);
  });

  it('改写快照不影响内部状态', async () => {
    const { client } = await connected();
    const snapshot = client.getTraces();
    const originalName = snapshot[0].name;

    (snapshot[0] as { name: string }).name = 'tampered';

    expect(client.getTraces()[0].name).toBe(originalName);
  });

  it('clearTraces 清空后订阅者被通知', async () => {
    const { client } = await connected();
    const listener = vi.fn();
    client.subscribeTraces(listener);

    client.clearTraces();

    expect(client.getTraces()).toHaveLength(0);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
describe('重连靠重新读取', () => {
  it('从 reconnecting 回到 connected 时重新订阅、重新拉在线状态与 Storage', async () => {
    const { ops, sdk } = await connected({ snapshot: roomSnapshot() });

    sdk.controls.emit('linkState', {
      currentState: 'DISCONNECTED',
      previousState: 'CONNECTED',
      serviceType: 'MESSAGE',
      operation: 'AUTO_RECONNECT',
      reasonCode: 0,
    });
    ops.length = 0;
    sdk.controls.emit('linkState', {
      currentState: 'CONNECTED',
      previousState: 'DISCONNECTED',
      serviceType: 'MESSAGE',
      operation: 'AUTO_RECONNECT',
      reasonCode: 0,
    });
    await flush();

    expect(ops).toEqual([
      `rtm:subscribe:${ROOM_ID}:4`,
      `presence:get:${ROOM_ID}`,
      'storage:get',
    ]);
  });

  it('重连不重放任何历史消息', async () => {
    const { sdk, ops, interactions } = await connected({ snapshot: roomSnapshot() });

    sdk.controls.emit('linkState', {
      currentState: 'DISCONNECTED',
      previousState: 'CONNECTED',
      serviceType: 'MESSAGE',
      operation: 'AUTO_RECONNECT',
      reasonCode: 0,
    });
    ops.length = 0;
    sdk.controls.emit('linkState', {
      currentState: 'CONNECTED',
      previousState: 'DISCONNECTED',
      serviceType: 'MESSAGE',
      operation: 'AUTO_RECONNECT',
      reasonCode: 0,
    });
    await flush();

    // 只有重新拉取，没有任何 publish
    expect(ops.some((op) => op.startsWith('rtm:publish'))).toBe(false);
    expect(interactions).toHaveLength(0);
  });

  it('没有经历过重连时的 connected 不触发重新拉取', async () => {
    const { sdk, ops } = await connected({ snapshot: roomSnapshot() });

    sdk.controls.emit('linkState', {
      currentState: 'CONNECTED',
      previousState: 'CONNECTING',
      serviceType: 'MESSAGE',
      operation: 'LOGIN',
      reasonCode: 0,
    });
    await flush();

    expect(ops).toHaveLength(0);
  });

  it('在线状态查询沿 nextPage 翻页取全部用户', async () => {
    const sdk = fakeSdk(roomSnapshot());
    sdk.controls.presencePages = [
      { occupants: [{ userId: 'u-1' }], nextPage: '1' },
      { occupants: [{ userId: 'u-2' }], nextPage: '2' },
      { occupants: [{ userId: 'u-3' }], nextPage: '' },
    ];
    const recorder = recordingHandlers();
    const client = createVoiceRoomAudienceClient({
      appId: APP_ID,
      roomId: ROOM_ID,
      userId: AUDIENCE_UID,
      displayName: '听众',
      stateAdapter: voiceRoomStateAdapter,
      handlers: recorder.handlers,
      createClient: sdk.createClient as never,
    });

    await client.connect();

    expect(client.getOnlineUsers()).toEqual(['u-1', 'u-2', 'u-3']);
    expect(sdk.controls.operations.filter((op) => op.startsWith('presence:get'))).toHaveLength(3);
  });

  it('重连恢复失败时走错误回调而不是抛出', async () => {
    const { sdk, errors } = await connected({ snapshot: roomSnapshot() });
    sdk.controls.failures.set('subscribe', new Error('重连订阅失败'));

    sdk.controls.emit('linkState', {
      currentState: 'DISCONNECTED',
      previousState: 'CONNECTED',
      serviceType: 'MESSAGE',
      operation: 'AUTO_RECONNECT',
      reasonCode: 0,
    });
    sdk.controls.emit('linkState', {
      currentState: 'CONNECTED',
      previousState: 'DISCONNECTED',
      serviceType: 'MESSAGE',
      operation: 'AUTO_RECONNECT',
      reasonCode: 0,
    });
    await flush();

    expect(errors.at(-1)).toContain('重连订阅失败');
  });

  it('Presence 事件触发重新拉取在线用户', async () => {
    const { sdk, ops, presences } = await connected({ snapshot: roomSnapshot() });

    sdk.controls.emit('presence', {
      eventType: 'REMOTE_JOIN',
      channelType: 'MESSAGE',
      channelName: ROOM_ID,
      publisher: 'newcomer',
    });
    await flush();

    expect(ops).toContain(`presence:get:${ROOM_ID}`);
    expect(presences.length).toBeGreaterThan(0);
  });

  it('Storage 事件同步快照，但不接受比本地更旧的', async () => {
    const { sdk, snapshots } = await connected({ snapshot: roomSnapshot() });

    const older = JSON.stringify({ ...roomSnapshot(), revision: 1 });
    sdk.controls.emit('storage', {
      channelName: ROOM_ID,
      channelType: 'MESSAGE',
      publisher: HOST_UID,
      storageType: 'CHANNEL',
      eventType: 'UPDATE',
      data: { majorRevision: 2, metadata: { 'voice-room-state': { value: older } } },
    });
    expect(snapshots.at(-1)?.revision).toBe(3);

    const newer = JSON.stringify({ ...roomSnapshot(), revision: 11 });
    sdk.controls.emit('storage', {
      channelName: ROOM_ID,
      channelType: 'MESSAGE',
      publisher: HOST_UID,
      storageType: 'CHANNEL',
      eventType: 'UPDATE',
      data: { majorRevision: 3, metadata: { 'voice-room-state': { value: newer } } },
    });
    expect(snapshots.at(-1)?.revision).toBe(11);
  });

  it('token 事件只把 WILL_EXPIRE 当作即将过期', async () => {
    const { sdk, errors } = await connected({ snapshot: roomSnapshot() });

    sdk.controls.emit('token', { eventType: 'EXPIRED', reason: '', channelNames: [] });
    expect(errors).toHaveLength(0);

    sdk.controls.emit('token', { eventType: 'WILL_EXPIRE', reason: '', channelNames: [] });
    expect(errors).toEqual(['RTM Token 即将过期']);
  });
});

// ===========================================================================
describe('零依赖', () => {
  it('只 import SDK 与纯类型，没有任何运行时的相对 import', async () => {
    const source = await readSource();

    const runtimeImports = [...source.matchAll(/^import\s+(?!type\s)[^;]*?from\s+'([^']+)'/gm)]
      .map((match) => match[1])
      .filter((specifier) => specifier.startsWith('.'));

    expect(runtimeImports).toEqual([]);
  });

  it('唯一的运行时 import 是 RTM SDK', async () => {
    const source = await readSource();

    const runtimeImports = [...source.matchAll(/^import\s+(?!type\s)[^;]*?from\s+'([^']+)'/gm)].map(
      (match) => match[1],
    );

    expect(runtimeImports).toEqual(['agora-rtm']);
  });

  it('没有 import 同目录的转移函数 —— 业务规则经参数注入', async () => {
    const source = await readSource();

    expect(source).not.toMatch(/^import\s+(?!type\s)[^;]*'\.\/transitions'/m);
  });

  it('没有 import 房主端文件 —— 两份文件各自独立，不互相依赖', async () => {
    const source = await readSource();

    expect(source).not.toMatch(/from\s+'\.\/rtm-host'/);
  });
});
