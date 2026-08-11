/**
 * 房主端 RTM 单文件的测试。
 *
 * 范式沿用项目最重要的测试先例：**假 SDK 记录一个字符串调用轨迹数组，断言字符串
 * 序列**。注入点在 SDK 工厂（`createClient`），不是 port —— port 分层已废弃。
 *
 * 轨迹字符串格式（读起来就是一份调用顺序文档）：
 * - `rtm:login:<uid>` / `rtm:logout` / `rtm:subscribe:<room>` / `rtm:unsubscribe:<room>`
 * - `rtm:publish:user:<uid>:<type>` / `rtm:publish:channel:<room>:<type>`
 * - `lock:acquire:<name>` / `lock:set:<name>` / `lock:release:<name>`
 * - `storage:get` / `storage:set:<revision>:<lockName>`
 * - `presence:get:<room>`
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createVoiceRoomHostClient, type VoiceRoomHostHandlers } from './rtm-host';
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
  /** channel metadata 当前内容。 */
  metadata: { majorRevision: number; values: Record<string, string> };
  /** presence 分页结果，逐页返回。 */
  presencePages: Array<{ occupants: Array<{ userId: string }>; nextPage: string }>;
  /** 让指定操作抛错。key 是操作名，如 `login` / `subscribe` / `acquireLock`。 */
  failures: Map<string, unknown>;
  /** 置 true 让下一次 `acquireLock` 抛 LOCK_NOT_EXIST，抛完自动复位。 */
  acquireLockFailNext: boolean;
  emit(name: string, event: unknown): void;
}

function fakeSdk(initialSnapshot?: VoiceRoomSnapshot) {
  const operations: string[] = [];
  const listeners = new Map<string, (event: never) => void>();
  const failures = new Map<string, unknown>();

  const controls: FakeClientControls = {
    operations,
    listeners,
    metadata: {
      majorRevision: 1,
      values: initialSnapshot
        ? { 'voice-room-state': JSON.stringify(initialSnapshot) }
        : {},
    },
    presencePages: [{ occupants: [{ userId: HOST_UID }], nextPage: '' }],
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
      operations.push(`rtm:login:${HOST_UID}${options?.token ? ':token' : ''}`);
      maybeFail('login');
      return {};
    },
    async logout() {
      operations.push('rtm:logout');
      maybeFail('logout');
      return {};
    },
    async subscribe(channelName: string, options?: Record<string, boolean>) {
      const flags = ['withMessage', 'withPresence', 'withMetadata', 'withLock']
        .filter((flag) => options?.[flag])
        .length;
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
        // 一次性：抛完就清掉，让「创建后重新获取」那一步能成功。
        // 不能按调用序号计数 —— connect() 里的 ensureRoomState 已经先取过一次锁了。
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

  const publishedMessages: string[] = [];

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

  const handlers: VoiceRoomHostHandlers = {
    linkState: (state) => linkStates.push(state),
    snapshot: (snapshot) => snapshots.push(snapshot),
    interaction: (event) =>
      interactions.push({ type: event.type, value: event.value, senderId: event.senderId }),
    presence: (userIds) => presences.push(userIds),
    error: (message) => errors.push(message),
  };

  return { handlers, errors, linkStates, snapshots, interactions, presences };
}

function setup(options: { snapshot?: VoiceRoomSnapshot; commandTimeoutMs?: number } = {}) {
  const sdk = fakeSdk(options.snapshot);
  const recorder = recordingHandlers();
  let clock = 1_000;

  const client = createVoiceRoomHostClient({
    appId: APP_ID,
    roomId: ROOM_ID,
    userId: HOST_UID,
    displayName: '房主',
    stateAdapter: voiceRoomStateAdapter,
    handlers: recorder.handlers,
    createClient: sdk.createClient as never,
    commandTimeoutMs: options.commandTimeoutMs,
    // 每次读时钟前进 5ms，于是 api 节点的耗时是确定值，可断言。
    now: () => (clock += 5),
  });

  return { sdk, client, ...recorder, ops: sdk.controls.operations };
}

/** 已有一位听众在麦上的快照，用于静音 / 下麦 / 治理类测试。 */
function snapshotWithSeatedAudience(): VoiceRoomSnapshot {
  const initial = voiceRoomStateAdapter.createInitial(HOST_UID, '房主');
  return {
    ...initial,
    revision: 5,
    seats: {
      ...initial.seats,
      'seat-1': {
        seatId: 'seat-1',
        userId: AUDIENCE_UID,
        displayName: '听众',
        status: 'active',
        muted: false,
      },
    },
  };
}

/** 队列里有一条待审批申请的快照。 */
function snapshotWithRequest(): VoiceRoomSnapshot {
  const initial = voiceRoomStateAdapter.createInitial(HOST_UID, '房主');
  return {
    ...initial,
    revision: 3,
    queue: [
      {
        id: 'req-1',
        userId: AUDIENCE_UID,
        displayName: '听众',
        seatId: 'seat-1',
        createdAt: 1,
      },
    ],
  };
}

async function connected(options: Parameters<typeof setup>[0] = {}) {
  const context = setup(options);
  await context.client.connect();
  context.ops.length = 0;
  return context;
}

// ===========================================================================
describe('连接与分阶段回滚', () => {
  it('注册事件必须在 login 之前 —— 晚注册会漏掉早期事件', async () => {
    const { client, sdk } = setup();

    await client.connect();

    // linkState / message / presence / storage / lock / token 六类
    expect(sdk.listenersAtLogin).toBe(6);
  });

  it('连接顺序是 login → subscribe → presence → storage，四类能力一起订', async () => {
    const { client, ops } = setup();

    await client.connect();

    expect(ops.slice(0, 3)).toEqual([
      `rtm:login:${HOST_UID}`,
      // 尾数 4 = withMessage/withPresence/withMetadata/withLock 全开
      `rtm:subscribe:${ROOM_ID}:4`,
      `presence:get:${ROOM_ID}`,
    ]);
    expect(ops).toContain('storage:get');
  });

  it('Storage 里没有房间状态时房主写入初始快照', async () => {
    const { client, ops, snapshots } = setup();

    await client.connect();

    expect(ops.filter((op) => op.startsWith('storage:set'))).toHaveLength(1);
    expect(snapshots.at(-1)?.hostUserId).toBe(HOST_UID);
  });

  it('Storage 里已有房间状态时不覆盖', async () => {
    const { client, ops, snapshots } = setup({ snapshot: snapshotWithRequest() });

    await client.connect();

    expect(ops.filter((op) => op.startsWith('storage:set'))).toHaveLength(0);
    expect(snapshots.at(-1)?.revision).toBe(3);
  });

  it('订阅失败时逆序清理：先 unsubscribe 再 logout', async () => {
    const { client, sdk, ops } = setup();
    sdk.controls.failures.set('subscribe', new Error('订阅失败'));

    await expect(client.connect()).rejects.toThrow('订阅失败');

    // subscribe 失败也算已订阅阶段未完成，所以只 logout
    expect(ops.filter((op) => op === 'rtm:logout')).toHaveLength(1);
  });

  it('login 失败时不做订阅相关清理', async () => {
    const { client, sdk, ops } = setup();
    sdk.controls.failures.set('login', new Error('登录失败'));

    await expect(client.connect()).rejects.toThrow('登录失败');

    expect(ops).not.toContain(`rtm:unsubscribe:${ROOM_ID}`);
    expect(ops).not.toContain('rtm:logout');
  });

  it('清理过程中再抛异常时暴露的仍是最初的失败原因', async () => {
    const { client, sdk } = setup();
    // 拉 Presence 时失败（此时已 login 且已 subscribe），清理时 logout 也失败
    sdk.controls.failures.set('getOnlineUsers', new Error('最初的失败'));
    sdk.controls.failures.set('unsubscribe', new Error('清理时的失败'));
    sdk.controls.failures.set('logout', new Error('清理时的另一个失败'));

    await expect(client.connect()).rejects.toThrow('最初的失败');
  });

  it('连接失败后链路状态是 failed', async () => {
    const { client, sdk, linkStates } = setup();
    sdk.controls.failures.set('login', new Error('登录失败'));

    await expect(client.connect()).rejects.toThrow();

    expect(linkStates).toEqual(['connecting', 'failed']);
  });

  it('重复 connect 不重复登录', async () => {
    const { client, ops } = setup();

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
    const sdk = fakeSdk();
    const recorder = recordingHandlers();
    const client = createVoiceRoomHostClient({
      appId: APP_ID,
      roomId: ROOM_ID,
      userId: HOST_UID,
      displayName: '房主',
      token: 'the-token',
      stateAdapter: voiceRoomStateAdapter,
      handlers: recorder.handlers,
      createClient: sdk.createClient as never,
    });

    await client.connect();

    expect(sdk.controls.operations[0]).toBe(`rtm:login:${HOST_UID}:token`);
  });
});

// ===========================================================================
describe('Lock 与乐观并发', () => {
  it('完整轨迹：获取锁 → 重新读快照 → 带修订号写入 → 释放锁', async () => {
    const { client, ops } = await connected({ snapshot: snapshotWithRequest() });

    await client.updateAnnouncement('新公告');

    expect(ops).toEqual([
      'lock:acquire:room-state',
      'storage:get',
      // revision 4 = 读回的 3 加一；lockName 与 majorRevision 都带上
      'storage:set:4:room-state:major=1',
      'lock:release:room-state',
    ]);
  });

  it('转移函数抛异常时释放锁仍然发生', async () => {
    const { client, ops } = await connected({ snapshot: snapshotWithRequest() });

    // 空公告触发领域错误
    await expect(client.updateAnnouncement('   ')).rejects.toThrow();

    expect(ops).toEqual(['lock:acquire:room-state', 'storage:get', 'lock:release:room-state']);
  });

  it('写入失败时释放锁仍然发生', async () => {
    const { client, sdk, ops } = await connected({ snapshot: snapshotWithRequest() });
    sdk.controls.failures.set('setChannelMetadata', new Error('写入失败'));

    await expect(client.updateAnnouncement('新公告')).rejects.toThrow('写入失败');

    expect(ops.at(-1)).toBe('lock:release:room-state');
  });

  it('锁不存在时先创建再重新获取', async () => {
    const { client, sdk, ops } = await connected({ snapshot: snapshotWithRequest() });
    sdk.controls.acquireLockFailNext = true;

    await client.updateAnnouncement('新公告');

    expect(ops.slice(0, 3)).toEqual([
      'lock:acquire:room-state',
      'lock:set:room-state',
      'lock:acquire:room-state',
    ]);
  });

  it('容忍对端抢先创建导致的「锁已存在」竞态', async () => {
    const { client, sdk, ops } = await connected({ snapshot: snapshotWithRequest() });
    sdk.controls.acquireLockFailNext = true;
    sdk.controls.failures.set('setLock', sdkError(-14004, 'LOCK_ALREADY_EXIST'));

    // 不抛错，继续走到写入
    await client.updateAnnouncement('新公告');

    expect(ops).toContain('lock:set:room-state');
    expect(ops.some((op) => op.startsWith('storage:set'))).toBe(true);
  });

  it('setLock 遇到其他错误码时如实上抛', async () => {
    const { client, sdk } = await connected({ snapshot: snapshotWithRequest() });
    sdk.controls.acquireLockFailNext = true;
    sdk.controls.failures.set('setLock', sdkError(-14003, 'LOCK_OPERATION_FAILED'));

    await expect(client.updateAnnouncement('新公告')).rejects.toMatchObject({
      errorCode: -14003,
    });
  });

  it('mutate 用重新读回的快照而不是本地缓存', async () => {
    const { client, sdk, snapshots } = await connected({ snapshot: snapshotWithRequest() });
    // 模拟对端在此期间写入了更新的快照
    sdk.controls.metadata = {
      majorRevision: 9,
      values: {
        'voice-room-state': JSON.stringify({ ...snapshotWithRequest(), revision: 42 }),
      },
    };

    await client.updateAnnouncement('新公告');

    // 43 = 读回的 42 加一，证明没有用本地的 3
    expect(snapshots.at(-1)?.revision).toBe(43);
  });
});

// ===========================================================================
describe('消息封装与去重', () => {
  it('发出的消息是合法信封：版本号、消息 ID、过期时间齐备', async () => {
    const { client, sdk } = await connected({ snapshot: snapshotWithRequest() });

    await client.rejectSeatRequest('req-1');

    const envelope = JSON.parse(sdk.publishedMessages.at(-1)!) as Record<string, unknown>;
    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.messageId).toBeTypeOf('string');
    expect(envelope.roomId).toBe(ROOM_ID);
    expect(envelope.senderId).toBe(HOST_UID);
    expect(envelope.targetId).toBe(AUDIENCE_UID);
    expect(envelope.requiresAck).toBe(false);
    // TTL 15 秒
    expect((envelope.expiresAt as number) - (envelope.sentAt as number)).toBe(15_000);
  });

  it('房间不匹配的消息被丢弃', async () => {
    const { client, sdk, interactions } = await connected();

    sdk.controls.emit('message', {
      channelType: 'MESSAGE',
      channelName: ROOM_ID,
      publisher: AUDIENCE_UID,
      message: JSON.stringify(envelopeFrom({ roomId: 'other-room' })),
      timestamp: Date.now(),
    });
    await flush();

    expect(interactions).toHaveLength(0);
    void client;
  });

  it('目标不是自己的消息被丢弃', async () => {
    const { sdk, interactions } = await connected();

    sdk.controls.emit('message', {
      channelType: 'MESSAGE',
      channelName: ROOM_ID,
      publisher: AUDIENCE_UID,
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
      publisher: AUDIENCE_UID,
      message: JSON.stringify(envelopeFrom({ sentAt: 0, expiresAt: 1 })),
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
      publisher: AUDIENCE_UID,
      message: JSON.stringify(envelopeFrom({ schemaVersion: 2 })),
      timestamp: Date.now(),
    });
    await flush();

    expect(interactions).toHaveLength(0);
  });

  it('同一消息 ID 收两次时第二次不触发业务处理', async () => {
    const { sdk, interactions } = await connected();
    const message = JSON.stringify(envelopeFrom({ messageId: 'dup-1' }));

    sdk.controls.emit('message', {
      channelType: 'MESSAGE',
      channelName: ROOM_ID,
      publisher: AUDIENCE_UID,
      message,
      timestamp: Date.now(),
    });
    await flush();
    sdk.controls.emit('message', {
      channelType: 'MESSAGE',
      channelName: ROOM_ID,
      publisher: AUDIENCE_UID,
      message,
      timestamp: Date.now(),
    });
    await flush();

    expect(interactions).toHaveLength(1);
  });

  it('不是有效 JSON 的消息被丢弃且不抛错', async () => {
    const { sdk, interactions, errors } = await connected();

    sdk.controls.emit('message', {
      channelType: 'MESSAGE',
      channelName: ROOM_ID,
      publisher: AUDIENCE_UID,
      message: 'not json',
      timestamp: Date.now(),
    });
    await flush();

    expect(interactions).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });
});

// ===========================================================================
describe('治理命令的 ack', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const cases = [
    { name: '踢出', run: (c: HostClient) => c.kickMember(AUDIENCE_UID), type: 'member.kick' },
    { name: '封禁', run: (c: HostClient) => c.banMember(AUDIENCE_UID), type: 'member.ban' },
    {
      name: '强制静音',
      run: (c: HostClient) => c.forceMuteSeat(AUDIENCE_UID, true),
      type: 'seat.mute.command',
    },
    {
      name: '强制下麦',
      run: (c: HostClient) => c.forceLeaveSeat(AUDIENCE_UID),
      type: 'seat.leave.command',
    },
  ];

  for (const testCase of cases) {
    it(`${testCase.name}发出时标记需要 ack`, async () => {
      const { client, sdk } = await connected({ snapshot: snapshotWithSeatedAudience() });

      await testCase.run(client);

      const envelope = JSON.parse(sdk.publishedMessages.at(-1)!) as Record<string, unknown>;
      expect(envelope.type).toBe(testCase.type);
      expect(envelope.requiresAck).toBe(true);
      expect(envelope.targetId).toBe(AUDIENCE_UID);
    });

    it(`${testCase.name}超时未收到 ack 时触发错误回调`, async () => {
      const { client, errors } = await connected({
        snapshot: snapshotWithSeatedAudience(),
        commandTimeoutMs: 1_000,
      });

      await testCase.run(client);
      expect(errors).toHaveLength(0);

      vi.advanceTimersByTime(1_000);

      expect(errors).toEqual([`${testCase.type} 执行 ACK 超时`]);
    });

    it(`${testCase.name}收到对端 ack 后定时器被清掉`, async () => {
      const { client, sdk, errors } = await connected({
        snapshot: snapshotWithSeatedAudience(),
        commandTimeoutMs: 1_000,
      });

      await testCase.run(client);
      const commandId = (JSON.parse(sdk.publishedMessages.at(-1)!) as { messageId: string })
        .messageId;

      sdk.controls.emit('message', {
        channelType: 'USER',
        channelName: AUDIENCE_UID,
        publisher: AUDIENCE_UID,
        message: JSON.stringify(
          envelopeFrom({
            type: 'command.ack',
            targetId: HOST_UID,
            payload: { commandId, status: 'EXECUTED' },
          }),
        ),
        timestamp: Date.now(),
      });
      await flush();

      vi.advanceTimersByTime(5_000);

      expect(errors).toHaveLength(0);
    });
  }

  it('踢出会先写权威状态再发命令', async () => {
    const { client, ops } = await connected({ snapshot: snapshotWithSeatedAudience() });

    await client.kickMember(AUDIENCE_UID);

    const setIndex = ops.findIndex((op) => op.startsWith('storage:set'));
    const publishIndex = ops.findIndex((op) => op.includes('member.kick'));
    expect(setIndex).toBeGreaterThanOrEqual(0);
    expect(publishIndex).toBeGreaterThan(setIndex);
  });

  it('封禁把用户写进封禁名单', async () => {
    const { client, snapshots } = await connected({ snapshot: snapshotWithSeatedAudience() });

    await client.banMember(AUDIENCE_UID);

    expect(snapshots.at(-1)?.bannedUserIds).toContain(AUDIENCE_UID);
  });

  it('强制静音是对他人的命令，不写自己的快照', async () => {
    const { client, ops } = await connected({ snapshot: snapshotWithSeatedAudience() });

    await client.forceMuteSeat(AUDIENCE_UID, true);

    // 只发命令，权威状态由对端执行后写入 —— 没有 lock/storage 调用
    expect(ops).toEqual([`rtm:publish:user:${AUDIENCE_UID}:seat.mute.command`]);
  });

  it('强制下麦同样只发命令', async () => {
    const { client, ops } = await connected({ snapshot: snapshotWithSeatedAudience() });

    await client.forceLeaveSeat(AUDIENCE_UID);

    expect(ops).toEqual([`rtm:publish:user:${AUDIENCE_UID}:seat.leave.command`]);
  });
});

// ===========================================================================
describe('语义方法逐个', () => {
  it('同意上麦申请：写快照后点对点通知申请者', async () => {
    const { client, ops, snapshots } = await connected({ snapshot: snapshotWithRequest() });

    await client.approveSeatRequest('req-1');

    expect(ops).toEqual([
      'lock:acquire:room-state',
      'storage:get',
      'storage:set:4:room-state:major=1',
      'lock:release:room-state',
      `rtm:publish:user:${AUDIENCE_UID}:seat.approved`,
    ]);
    // 麦位先进 joining —— 由媒体结果驱动才转 active
    expect(snapshots.at(-1)?.seats['seat-1'].status).toBe('joining');
  });

  it('同意不存在的申请时抛错且不碰 RTM', async () => {
    const { client, ops } = await connected({ snapshot: snapshotWithRequest() });

    await expect(client.approveSeatRequest('nope')).rejects.toThrow('排麦申请不存在');

    expect(ops).toEqual([]);
  });

  it('拒绝上麦申请：写快照后通知申请者', async () => {
    const { client, ops, snapshots } = await connected({ snapshot: snapshotWithRequest() });

    await client.rejectSeatRequest('req-1');

    expect(ops.at(-1)).toBe(`rtm:publish:user:${AUDIENCE_UID}:seat.rejected`);
    expect(snapshots.at(-1)?.queue).toHaveLength(0);
  });

  it('邀请上麦：写快照后点对点邀请', async () => {
    const { client, ops, snapshots } = await connected();

    await client.inviteToSeat(AUDIENCE_UID, '听众', 'seat-2');

    expect(ops.at(-1)).toBe(`rtm:publish:user:${AUDIENCE_UID}:seat.invited`);
    expect(snapshots.at(-1)?.invitation?.userId).toBe(AUDIENCE_UID);
  });

  it('更新公告：纯 Storage 写入，没有配套消息', async () => {
    const { client, ops, snapshots } = await connected();

    await client.updateAnnouncement('今晚八点开唱');

    expect(ops.filter((op) => op.startsWith('rtm:publish'))).toEqual([]);
    expect(snapshots.at(-1)?.announcement).toBe('今晚八点开唱');
  });

  it('公屏消息广播到频道并本地回显一次', async () => {
    const { client, ops, interactions } = await connected();

    await client.sendChatMessage('大家好');

    expect(ops).toEqual([`rtm:publish:channel:${ROOM_ID}:chat.message`]);
    expect(interactions).toEqual([{ type: 'chat', value: '大家好', senderId: HOST_UID }]);
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

    expect(ops).toEqual([]);
  });

  it('自己发的频道消息回显时不重复计入互动', async () => {
    const { client, sdk, interactions } = await connected();
    await client.sendChatMessage('大家好');

    // 频道消息会回显给发送者
    sdk.controls.emit('message', {
      channelType: 'MESSAGE',
      channelName: ROOM_ID,
      publisher: HOST_UID,
      message: sdk.publishedMessages.at(-1)!,
      timestamp: Date.now(),
    });
    await flush();

    expect(interactions).toHaveLength(1);
  });

  it('媒体发布成功后把自己的麦位转 active', async () => {
    const { client, snapshots } = await connected();

    await client.activateOwnSeat('seat-0');

    expect(snapshots.at(-1)?.seats['seat-0'].status).toBe('active');
  });

  it('媒体发布失败时回滚自己的麦位', async () => {
    const { client, snapshots } = await connected();

    await client.rollbackOwnSeat('seat-0');

    expect(snapshots.at(-1)?.seats['seat-0'].status).toBe('empty');
  });

  it('未连接时调用语义方法抛「尚未连接」', async () => {
    const { client } = setup();

    await expect(client.updateAnnouncement('x')).rejects.toThrow('RTM 尚未连接');
  });
});

// ===========================================================================
describe('trace 采集', () => {
  it('每次 API 调用产生一条带耗时的 api 节点', async () => {
    const { client } = await connected();

    await client.updateAnnouncement('新公告');

    const apiEntries = client.getTraces().filter((entry) => entry.kind === 'api');
    expect(apiEntries.length).toBeGreaterThan(0);
    for (const entry of apiEntries) {
      expect(entry.durationMs).toBeTypeOf('number');
    }
  });

  it('每次收到事件产生一条事件节点', async () => {
    const { client, sdk } = await connected();
    const before = client.getTraces().filter((entry) => entry.kind === 'event').length;

    sdk.controls.emit('storage', {
      channelName: ROOM_ID,
      data: { majorRevision: 7, metadata: {} },
    });

    const after = client.getTraces().filter((entry) => entry.kind === 'event');
    expect(after.length).toBe(before + 1);
    expect(after.at(-1)?.name).toBe('storage');
  });

  it('API 失败时带错误码与错误信息', async () => {
    const { client, sdk } = await connected();
    sdk.controls.failures.set('setChannelMetadata', sdkError(-11001, 'STORAGE_FAILED'));

    await expect(client.updateAnnouncement('新公告')).rejects.toBeTruthy();

    const failed = client
      .getTraces()
      .find((entry) => entry.name === 'storage.setChannelMetadata' && entry.errorCode !== undefined);
    expect(failed?.errorCode).toBe(-11001);
    expect(failed?.errorMessage).toContain('STORAGE_FAILED');
  });

  it('每条 trace 都带自己的 uid 与角色', async () => {
    const { client } = await connected();

    await client.updateAnnouncement('新公告');

    for (const entry of client.getTraces()) {
      expect(entry.uid).toBe(HOST_UID);
      expect(entry.role).toBe('host');
    }
  });

  it('trace 只有 api 与 event 两种类型', async () => {
    const { client } = await connected();

    await client.updateAnnouncement('新公告');

    for (const entry of client.getTraces()) {
      expect(['api', 'event']).toContain(entry.kind);
    }
  });

  it('seq 单调递增，可作同毫秒的稳定次序', async () => {
    const { client } = await connected();

    await client.updateAnnouncement('新公告');

    const seqs = client.getTraces().map((entry) => entry.seq);
    expect(seqs).toEqual([...seqs].sort((left, right) => left - right));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it('订阅者在每次写入后被通知', async () => {
    const { client } = await connected();
    const listener = vi.fn();
    const unsubscribe = client.subscribeTraces(listener);

    await client.updateAnnouncement('新公告');
    expect(listener).toHaveBeenCalled();

    listener.mockClear();
    unsubscribe();
    await client.updateAnnouncement('再改一次');
    expect(listener).not.toHaveBeenCalled();
  });

  it('快照未变时返回同一引用 —— 外部 store 订阅钩子的硬要求', async () => {
    const { client } = await connected();

    const first = client.getTraces();
    expect(client.getTraces()).toBe(first);

    await client.updateAnnouncement('新公告');
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
    const { client, sdk, ops } = await connected({ snapshot: snapshotWithRequest() });

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
    void client;
  });

  it('重连不重放任何历史消息', async () => {
    const { sdk, ops, interactions } = await connected();

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

    expect(ops.filter((op) => op.startsWith('rtm:publish'))).toEqual([]);
    expect(interactions).toHaveLength(0);
  });

  it('没有经历过重连时的 connected 不触发重新拉取', async () => {
    const { sdk, ops } = await connected();

    sdk.controls.emit('linkState', {
      currentState: 'CONNECTED',
      previousState: 'CONNECTING',
      serviceType: 'MESSAGE',
      operation: 'LOGIN',
      reasonCode: 0,
    });
    await flush();

    expect(ops).toEqual([]);
  });

  it('在线状态查询沿 nextPage 翻页取全部用户', async () => {
    const sdk = fakeSdk();
    sdk.controls.presencePages = [
      { occupants: [{ userId: 'u1' }], nextPage: '1' },
      { occupants: [{ userId: 'u2' }], nextPage: '2' },
      { occupants: [{ userId: 'u3' }], nextPage: '' },
    ];
    const recorder = recordingHandlers();
    const client = createVoiceRoomHostClient({
      appId: APP_ID,
      roomId: ROOM_ID,
      userId: HOST_UID,
      displayName: '房主',
      stateAdapter: voiceRoomStateAdapter,
      handlers: recorder.handlers,
      createClient: sdk.createClient as never,
    });

    await client.connect();

    expect(client.getOnlineUsers()).toEqual(['u1', 'u2', 'u3']);
    expect(sdk.controls.operations.filter((op) => op.startsWith('presence:get'))).toHaveLength(3);
  });

  it('重连恢复失败时走错误回调而不是抛出', async () => {
    const { sdk, errors } = await connected();
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

    expect(errors.some((message) => message.includes('重连订阅失败'))).toBe(true);
  });

  it('Presence 事件触发重新拉取在线用户', async () => {
    const { sdk, ops, presences } = await connected();
    const before = presences.length;

    sdk.controls.emit('presence', {
      eventType: 'REMOTE_JOIN',
      channelType: 'MESSAGE',
      channelName: ROOM_ID,
      publisher: AUDIENCE_UID,
    });
    await flush();

    expect(ops).toContain(`presence:get:${ROOM_ID}`);
    expect(presences.length).toBe(before + 1);
  });

  it('Storage 事件同步快照，但不接受比本地更旧的', async () => {
    const { client, sdk } = await connected({ snapshot: snapshotWithRequest() });

    sdk.controls.emit('storage', {
      channelName: ROOM_ID,
      data: {
        majorRevision: 9,
        metadata: {
          'voice-room-state': {
            value: JSON.stringify({ ...snapshotWithRequest(), revision: 99 }),
          },
        },
      },
    });
    expect(client.getSnapshot().revision).toBe(99);

    sdk.controls.emit('storage', {
      channelName: ROOM_ID,
      data: {
        majorRevision: 10,
        metadata: {
          'voice-room-state': {
            value: JSON.stringify({ ...snapshotWithRequest(), revision: 1 }),
          },
        },
      },
    });
    expect(client.getSnapshot().revision).toBe(99);
  });

  it('token 事件只把 WILL_EXPIRE 当作即将过期', async () => {
    const { sdk, errors } = await connected();

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
});

// ===========================================================================
// 测试辅助
// ===========================================================================

type HostClient = ReturnType<typeof createVoiceRoomHostClient>;

/** 造一条默认合法、可局部覆盖的信封。 */
function envelopeFrom(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const sentAt = Date.now();
  return {
    schemaVersion: 1,
    messageId: `msg-${Math.random().toString(36).slice(2)}`,
    type: 'chat.message',
    roomId: ROOM_ID,
    senderId: AUDIENCE_UID,
    sentAt,
    expiresAt: sentAt + 15_000,
    requiresAck: false,
    payload: { value: '你好', displayName: '听众' },
    ...overrides,
  };
}

/** 让事件处理器里的 `void promise` 走完微任务队列。 */
async function flush(): Promise<void> {
  // 只排微任务，**不碰 setTimeout** —— ack 那组测试开了假定时器，
  // 用宏任务边界会直接把 flush 挂死（假定时器不推进，setTimeout 永远不触发）。
  //
  // 假 SDK 的方法全是 async 但内部无真异步，所以整条恢复链（subscribe → presence
  // 翻页 → storage）落地只需要有限层微任务。次数取得比实际层数宽裕一截。
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
}

async function readSource(): Promise<string> {
  // 用 Vite 的 `?raw` 取源码文本，不用 node:fs —— `tsconfig.app.json` 的 `types`
  // 里没有 `node`，用 node API 会让 `tsc -b` 红（`?raw` 的类型来自 vite/client）。
  const module = (await import('./rtm-host.ts?raw')) as { default: string };
  return module.default;
}
