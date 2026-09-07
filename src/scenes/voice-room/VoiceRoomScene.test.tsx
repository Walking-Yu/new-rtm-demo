import type { RTMEvents } from 'agora-rtm';
import { act, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { RtcHelper } from '../../shared/rtc';
import type { TraceSource } from '../../shared/timeline/useMergedTraces';
import type { AppRtmEventListeners, AppRoomRtmPort } from './app-rtm';
import type { AppRtmSession } from './app-rtm';
import { parseVoiceRoomUrl, VoiceRoomScene } from './VoiceRoomScene';
import { encodeVoiceRoomUrlPayload, type LegacyVoiceRoomUrlPayload, type VoiceRoomUrlPayload, isNamedVoiceRoomPayload } from './voice-room-url';
import source from './VoiceRoomScene.tsx?raw';
import { directoryStorageKey } from './browser-room-directory';

/** 房间目录只保留 7 天内的记录，夹具日期必须相对当前时间，写死会在一周后静默过期。 */
const roomCreatedAt = Date.now() - 60 * 60 * 1000;

const env = { configured: true, appId: 'test-app-id', source: 'window.__ENV__' } as const;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function payload(): LegacyVoiceRoomUrlPayload {
  return {
    localStorage: {
      [directoryStorageKey(new Date(roomCreatedAt))]: {
        roomId: 'voice-room-1', roomName: '邀请房间', hostUserId: 'host-1',
        createdAt: roomCreatedAt,
        updatedAt: roomCreatedAt, banUserIds: [], status: 'active',
      },
    },
    role: 'audience',
    pageUid: null,
    nickname: null,
  };
}

function createSceneHarness(options: { holdLogin?: boolean; holdSubscribe?: boolean; holdUnsubscribe?: boolean; failEndWrite?: boolean; failDissolveBroadcast?: boolean; failCleanup?: boolean } = {}) {
  const operations: string[] = [];
  let failCleanup = options.failCleanup ?? false;
  const login = deferred();
  const subscribe = deferred();
  const unsubscribe = deferred();
  let handlers: AppRtmEventListeners = {};
  let directoryListener: NonNullable<AppRtmEventListeners['storage']> | undefined;
  let directoryName = '';
  const records = new Map<string, { majorRevision: number; metadata: Record<string, { value: string }> }>();
  const storageEvent = (channelName: string, eventType: 'SNAPSHOT' | 'UPDATE' | 'REMOVE') => ({
    timestamp: Date.now(), channelName, channelType: 'MESSAGE' as const, storageType: 'CHANNEL' as const,
    eventType, publisher: '', data: { totalCount: Object.keys(records.get(channelName)?.metadata ?? {}).length,
      ...(records.get(channelName) ?? { majorRevision: 0, metadata: {} }) },
  } as RTMEvents.StorageEvent);
  const port: AppRoomRtmPort = {
    async subscribe(channelName) {
      operations.push('rtm:subscribe');
      if (options.holdSubscribe) await subscribe.promise;
      handlers.storage?.(storageEvent(channelName, 'SNAPSHOT'));
    },
    async unsubscribe() { operations.push('rtm:unsubscribe'); if (options.holdUnsubscribe) await unsubscribe.promise; },
    async publish(_channelName, message, channelType) {
      operations.push(`rtm:publish:${channelType}:${JSON.parse(message).type}`);
      if (options.failDissolveBroadcast && JSON.parse(message).type === 'room.dissolved') throw new Error('广播失败');
    },
    async setPresenceState(_roomId, state) {
      operations.push(`presence:set:${state.displayName ?? ''}:${state.muted ?? ''}`);
    },
    async removePresenceState(_roomId, keys) {
      operations.push(`presence:remove:${keys.join(',')}`);
    },
    async removeRoomMetadata(channelName) {
      operations.push(`storage:remove:${channelName}`);
      if (failCleanup) throw new Error('清理失败');
      const current = records.get(channelName);
      records.set(channelName, { majorRevision: (current?.majorRevision ?? 0) + 1, metadata: {} });
      handlers.storage?.(storageEvent(channelName, 'REMOVE'));
      return { totalCount: 0 };
    },
    async setRoomMetadata(channelName, data) {
      const old = records.get(channelName);
      records.set(channelName, { majorRevision: (old?.majorRevision ?? 0) + 1,
        metadata: { ...old?.metadata, ...Object.fromEntries(data.map(item => [item.key, { value: item.value }])) } });
      handlers.storage?.(storageEvent(channelName, 'UPDATE'));
    },
  };
  const session = {
    userId: 'audience-1',
    async login() { operations.push('rtm:login'); if (options.holdLogin) await login.promise; return port; },
    async logout() { operations.push('rtm:logout'); },
    getTraces: () => [],
    subscribeTraces: () => () => undefined,
    clearTraces() {},
    getRoomPort: () => port,
    getCurrentLinkState: () => 'connected',
    observeDirectory(name: string, listener: NonNullable<AppRtmEventListeners['storage']>) {
      directoryName = name; directoryListener = listener;
      return () => { if (directoryListener === listener) directoryListener = undefined; };
    },
    getDirectoryPort: () => ({
      async subscribe(name: string) { directoryListener?.(storageEvent(name, 'SNAPSHOT')); },
      async unsubscribe() {},
      async write(name: string, value: string, revision: number) {
        if (options.failEndWrite && JSON.parse(value).status === 'inactive') throw new Error('写入失败');
        if (revision !== (records.get(name)?.majorRevision ?? 0)) throw Object.assign(new Error('版本冲突'), { errorCode: -12014 });
        records.set(name, { majorRevision: revision + 1, metadata: { entry: { value } } });
        if (name === directoryName) directoryListener?.(storageEvent(name, 'UPDATE'));
      },
    }),
    bindRtmEvents(next: AppRtmEventListeners) {
      handlers = next;
      return () => { if (handlers === next) handlers = {}; };
    },
  } as unknown as AppRtmSession;
  const rtc: RtcHelper = {
    registerEvents() {},
    async join() { operations.push('rtc:join'); },
    async leave() { operations.push('rtc:leave'); },
    async publishMicrophone() {},
    async unpublishMicrophone() {},
    async setMicrophoneMuted(muted) { operations.push(`rtc:mute:${muted}`); },
    isMicrophoneCaptureHealthy: () => true,
    async publishCamera() {},
    async unpublishCamera() {},
    async setCameraMuted() {},
    getLocalVideoTrack: () => undefined,
  };
  return {
    operations,
    records,
    setFailCleanup: (value: boolean) => { failCleanup = value; },
    resolveLogin: login.resolve,
    resolveSubscribe: subscribe.resolve,
    resolveUnsubscribe: unsubscribe.resolve,
    emitPresence(event: Parameters<NonNullable<AppRtmEventListeners['presence']>>[0]) {
      handlers.presence?.(event);
    },
    emitStorage(event: Parameters<NonNullable<AppRtmEventListeners['storage']>>[0]) {
      handlers.storage?.(event);
    },
    emitMessage(event: Parameters<NonNullable<AppRtmEventListeners['message']>>[0]) {
      handlers.message?.(event);
    },
    overrides: {
      createAppRtmSession: () => session,
      createRtc: () => rtc,
    },
  };
}

describe('语聊房单端入口', () => {
  it('从唯一 data 参数解码完整 payload', () => {
    expect(parseVoiceRoomUrl(`?data=${encodeVoiceRoomUrlPayload(payload())}`)).toEqual(payload());
  });

  it('登录成功前只显示 booting，不渲染角色入口', async () => {
    const harness = createSceneHarness({ holdLogin: true });
    render(<VoiceRoomScene env={env} overrides={harness.overrides} search="" />);

    expect(screen.getByTestId('voice-room-booting')).toBeInTheDocument();
    expect(screen.queryByTestId('voice-room-entry')).not.toBeInTheDocument();
    await act(async () => harness.resolveLogin());
    expect(await screen.findByTestId('voice-room-entry')).toBeInTheDocument();
  });

  it('choose 主页仅提供按名称创建和加入入口', async () => {
    const harness = createSceneHarness();
    const user = userEvent.setup();
    render(<VoiceRoomScene env={env} overrides={harness.overrides} search="" />);
    await screen.findByTestId('voice-room-entry');

    expect(screen.queryByText('在声音里，相遇')).not.toBeInTheDocument();
    expect(screen.queryByText(/RTM 身份/)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('房间标题'), '新房间');

    expect(screen.getByLabelText('加入的房间名称')).toBeInTheDocument();
    expect(screen.queryByLabelText('邀请链接')).not.toBeInTheDocument();
    expect(screen.queryByText('通过邀请链接加入')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建并进入' })).toBeEnabled();
  });

  it('订阅开始时房间 UI 已挂载，并由统一 loading 蒙层阻断', async () => {
    const harness = createSceneHarness({ holdSubscribe: true });
    const user = userEvent.setup();
    render(<VoiceRoomScene env={env} overrides={harness.overrides} search="" />);
    await screen.findByTestId('voice-room-entry');
    await user.type(screen.getByLabelText('房间标题'), '新房间');
    await user.click(screen.getByRole('button', { name: '创建并进入' }));

    expect(await screen.findByLabelText('房主语聊房')).toBeInTheDocument();
    expect(screen.getByTestId('voice-room-loading-overlay')).toHaveTextContent('正在准备房间…');
    await act(async () => harness.resolveSubscribe());
    await waitFor(() => expect(screen.queryByTestId('voice-room-loading-overlay')).not.toBeInTheDocument());
  });

  it('公屏提供普通、礼物和爱心三种消息入口', async () => {
    const harness = createSceneHarness();
    const user = userEvent.setup();
    render(<VoiceRoomScene env={env} overrides={harness.overrides} search="" />);
    await screen.findByTestId('voice-room-entry');
    await user.type(screen.getByLabelText('房间标题'), '互动房间');
    await user.click(screen.getByRole('button', { name: '创建并进入' }));
    await screen.findByLabelText('房主语聊房');

    await user.click(screen.getByRole('button', { name: '发送礼物消息' }));
    await user.click(screen.getByRole('button', { name: '发送爱心消息' }));

    expect(harness.operations).toContain('rtm:publish:MESSAGE:gift.sent');
    expect(harness.operations).toContain('rtm:publish:MESSAGE:emoji.reaction');
    expect(screen.getByLabelText('聊天内容')).toBeInTheDocument();
    expect(source).toContain('data-interaction-type={item.type}');
    expect(source).toContain('送出礼物');
    expect(source).toContain('送出爱心');
    expect(source).toContain('feed.scrollTop = feed.scrollHeight');
    expect(source).toContain('}, [view.interactions]);');
    expect(source).toContain('request.remainingSeconds');
  });

  it('房主解散完成后直接回到入口，退出期间不显示结束页且清除旧房间 URL', async () => {
    const harness = createSceneHarness({ holdUnsubscribe: true });
    const user = userEvent.setup();
    render(<VoiceRoomScene env={env} overrides={harness.overrides} search="" />);
    await screen.findByTestId('voice-room-entry');
    await user.type(screen.getByLabelText('房间标题'), '解散返回');
    await user.click(screen.getByRole('button', { name: '创建并进入' }));
    await screen.findByLabelText('房主语聊房');
    expect(window.location.search).toContain('data=');
    await user.click(screen.getByRole('button', { name: '解散房间' }));
    await waitFor(() => expect(harness.operations).toContain('rtm:unsubscribe'));
    expect(screen.queryByTestId('voice-room-ended')).not.toBeInTheDocument();
    expect(screen.queryByTestId('voice-room-entry')).not.toBeInTheDocument();
    await act(async () => { harness.resolveUnsubscribe(); });
    await screen.findByTestId('voice-room-entry');
    expect(window.location.search).toBe('');
    expect(screen.getByLabelText('房间标题')).toHaveValue('解散返回');
    expect(harness.operations).not.toContain('rtm:logout');
    expect(harness.operations.indexOf('rtc:leave')).toBeLessThan(harness.operations.indexOf('rtm:unsubscribe'));
  });

  it('解散目录写入未确认时留在房内提示失败', async () => {
    const harness = createSceneHarness({ failEndWrite: true });
    const user = userEvent.setup();
    render(<VoiceRoomScene env={env} overrides={harness.overrides} search="" />);
    await screen.findByTestId('voice-room-entry');
    await user.type(screen.getByLabelText('房间标题'), '解散失败');
    await user.click(screen.getByRole('button', { name: '创建并进入' }));
    await screen.findByLabelText('房主语聊房');
    await user.click(screen.getByRole('button', { name: '解散房间' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('尚未确认');
    expect(screen.getByLabelText('房主语聊房')).toBeInTheDocument();
    expect(screen.queryByTestId('voice-room-entry')).not.toBeInTheDocument();
    expect(harness.operations).not.toContain('rtm:unsubscribe');
    expect(window.location.search).toContain('data=');
  });

  it('共享解散已确认而广播失败时，房主仍直接回到入口', async () => {
    const harness = createSceneHarness({ failDissolveBroadcast: true });
    const user = userEvent.setup();
    render(<VoiceRoomScene env={env} overrides={harness.overrides} search="" />);
    await screen.findByTestId('voice-room-entry');
    await user.type(screen.getByLabelText('房间标题'), '广播失败');
    await user.click(screen.getByRole('button', { name: '创建并进入' }));
    await screen.findByLabelText('房主语聊房');
    await user.click(screen.getByRole('button', { name: '解散房间' }));
    await screen.findByTestId('voice-room-entry');
    expect(screen.queryByTestId('voice-room-ended')).not.toBeInTheDocument();
    expect(window.location.search).toBe('');
  });

  it('房间解散后仍返回入口，清理失败可重试', async () => {
    const harness = createSceneHarness({ failCleanup: true });
    const user = userEvent.setup();
    render(<VoiceRoomScene env={env} overrides={harness.overrides} search="" />);
    await screen.findByTestId('voice-room-entry');
    await user.type(screen.getByLabelText('房间标题'), '清理重试');
    await user.click(screen.getByRole('button', { name: '创建并进入' }));
    await screen.findByLabelText('房主语聊房');
    const oldId = [...harness.records.keys()].find(key => !key.startsWith('vrn-v1-'))!;
    await user.click(screen.getByRole('button', { name: '解散房间' }));
    await screen.findByTestId('voice-room-entry');
    expect(screen.getByRole('alert')).toHaveTextContent('数据清理未完成');
    expect(harness.records.get(oldId)!.metadata).not.toEqual({});
    harness.setFailCleanup(false);
    await user.click(screen.getByRole('button', { name: '重试清理' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '重试清理' })).not.toBeInTheDocument());
    expect(harness.records.get(oldId)!.metadata).toEqual({});
  });

  it('Emoji 选择器把 Unicode Emoji 插入输入框且不会立即发送', async () => {
    const harness = createSceneHarness();
    const user = userEvent.setup();
    render(<VoiceRoomScene env={env} overrides={harness.overrides} search="" />);
    await screen.findByTestId('voice-room-entry');
    await user.type(screen.getByLabelText('房间标题'), 'Emoji 房间');
    await user.click(screen.getByRole('button', { name: '创建并进入' }));
    const room = await screen.findByLabelText('房主语聊房');
    expect(within(room).getByRole('button', { name: '暂时离开' })).toBeInTheDocument();
    expect(within(room).getByRole('button', { name: '解散房间' })).toBeInTheDocument();
    const chatInput = within(room).getByLabelText('聊天内容');
    fireEvent.change(chatInput, { target: { value: 'AB' } });
    (chatInput as HTMLInputElement).setSelectionRange(1, 1);

    await user.click(within(room).getByRole('button', { name: '打开 Emoji 选择器' }));
    const picker = within(room).getByRole('dialog', { name: 'Emoji 选择器' });
    await user.click(within(picker).getByRole('button', { name: '插入 😀' }));

    expect(chatInput).toHaveValue('A😀B');
    expect(harness.operations).not.toContain('rtm:publish:MESSAGE:chat.message');

    await user.click(within(room).getByRole('button', { name: '发送聊天' }));
    expect(harness.operations).toContain('rtm:publish:MESSAGE:chat.message');
    expect(within(room).queryByRole('dialog', { name: 'Emoji 选择器' })).not.toBeInTheDocument();

    await user.click(within(room).getByRole('button', { name: '打开 Emoji 选择器' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(within(room).queryByRole('dialog', { name: 'Emoji 选择器' })).not.toBeInTheDocument();

    await user.click(within(room).getByRole('button', { name: '打开 Emoji 选择器' }));
    await user.click(within(room).getByRole('button', { name: '关闭 Emoji 选择器' }));
    expect(within(room).queryByRole('dialog', { name: 'Emoji 选择器' })).not.toBeInTheDocument();
  });

  it('Host 在麦位上可闭麦，并在收到上麦申请时显示 toast', async () => {
    const harness = createSceneHarness();
    const user = userEvent.setup();
    render(<VoiceRoomScene env={env} overrides={harness.overrides} search="" />);
    await screen.findByTestId('voice-room-entry');
    await user.type(screen.getByLabelText('房间标题'), 'Host 麦克风房间');
    await user.click(screen.getByRole('button', { name: '创建并进入' }));
    const room = await screen.findByLabelText('房主语聊房');
    const currentPayload = parseVoiceRoomUrl(window.location.search)!;
    const roomId = isNamedVoiceRoomPayload(currentPayload) ? currentPayload.roomId : Object.values(currentPayload.localStorage)[0].roomId;
    act(() => harness.emitStorage({
      timestamp: 1,
      channelName: roomId,
      channelType: 'MESSAGE',
      storageType: 'CHANNEL',
      eventType: 'SNAPSHOT',
      publisher: '',
      data: {
        majorRevision: 1,
        totalCount: 4,
        metadata: {
          hostUserId: { value: 'audience-1' },
          announcement: { value: '' },
          seats: { value: JSON.stringify({
            'seat-0': { seatId: 'seat-0', userId: 'audience-1', displayName: 'Host' },
          }) },
          forcedMutedUserIds: { value: '[]' },
        },
      },
    } as never));
    await vi.waitFor(() => expect(within(room).getByRole('button', { name: '闭麦' })).toBeInTheDocument());
    await user.click(within(room).getByRole('button', { name: '闭麦' }));
    expect(harness.operations).toContain('presence:set::true');
    expect(harness.operations).toContain('rtc:mute:true');

    act(() => harness.emitPresence({
      timestamp: 2,
      channelName: roomId,
      channelType: 'MESSAGE',
      eventType: 'REMOTE_JOIN',
      publisher: 'audience-2',
      stateChanged: { displayName: 'Emma_301' },
    } as never));
    const now = Date.now();
    act(() => harness.emitMessage({
      timestamp: now,
      channelName: 'audience-1',
      channelType: 'USER',
      publisher: 'audience-2',
      messageType: 'STRING',
      message: JSON.stringify({
        schemaVersion: 1,
        messageId: 'seat-request-toast-ui',
        type: 'seat.request',
        roomId,
        targetUserId: 'audience-1',
        sentAt: now,
        expiresAt: now + 15_000,
        payload: { requestId: 'request-1', seatId: 'seat-1' },
      }),
    } as never));

    const toast = await within(room).findByText('Emma_301 申请 2 号麦位');
    expect(toast.closest('.vr-toast-message')).toHaveClass('vr-room-toast');
  });

  it('角色离房后仍保留页面生命周期内已经出现的数据流 source', async () => {
    const harness = createSceneHarness();
    const publishedSources: TraceSource[][] = [];
    const user = userEvent.setup();
    render(<VoiceRoomScene
      env={env}
      overrides={harness.overrides}
      search=""
      onTraceSources={(sources) => publishedSources.push([...sources])}
    />);
    await screen.findByTestId('voice-room-entry');
    await user.type(screen.getByLabelText('房间标题'), '保留数据流房间');
    await user.click(screen.getByRole('button', { name: '创建并进入' }));
    const room = await screen.findByLabelText('房主语聊房');
    await vi.waitFor(() => expect(publishedSources.at(-1)).toHaveLength(3));

    await user.click(within(room).getByRole('button', { name: '暂时离开' }));

    await vi.waitFor(() => expect(screen.getByTestId('voice-room-entry')).toBeInTheDocument());
    expect(publishedSources.at(-1)).toHaveLength(3);
    expect(publishedSources).not.toContainEqual([]);
  });

  it('Audience 不渲染右侧席位 panel，上麦操作位于消息栏最右侧并展示麦克风异常', async () => {
    const harness = createSceneHarness();
    render(<VoiceRoomScene env={env} overrides={harness.overrides} search={`?data=${encodeVoiceRoomUrlPayload(payload())}`} />);
    const room = await screen.findByLabelText('听众语聊房');

    expect(within(room).queryByLabelText('我的上麦')).not.toBeInTheDocument();
    expect(within(room).queryByText('我的语音席位')).not.toBeInTheDocument();
    const composer = within(room).getByLabelText('聊天内容').closest('form')!;
    const seatAction = within(composer).getByRole('button', { name: '申请上麦' });
    expect(composer.lastElementChild).toBe(seatAction);

    await vi.waitFor(() => expect(parseVoiceRoomUrl(window.location.search)?.nickname).toMatch(/_\d{3}$/u));
    const currentPayload = parseVoiceRoomUrl(window.location.search)!;
    const roomId = isNamedVoiceRoomPayload(currentPayload) ? currentPayload.roomId : Object.values(currentPayload.localStorage)[0].roomId;
    act(() => harness.emitStorage({
      timestamp: 2,
      channelName: roomId,
      channelType: 'MESSAGE',
      storageType: 'CHANNEL',
      eventType: 'UPDATE',
      publisher: 'host-1',
      data: {
        majorRevision: 2,
        totalCount: 4,
        metadata: {
          hostUserId: { value: 'host-1' },
          announcement: { value: '' },
          seats: { value: JSON.stringify({
            'seat-0': { seatId: 'seat-0', userId: 'host-1', displayName: 'Host' },
            'seat-1': { seatId: 'seat-1', userId: 'audience-1', displayName: currentPayload.nickname },
          }) },
          forcedMutedUserIds: { value: '[]' },
        },
      },
    } as never));
    await vi.waitFor(() => expect(within(composer).getByRole('button', { name: '闭麦' })).toBeInTheDocument());

    act(() => harness.emitPresence({
      timestamp: 3,
      channelName: roomId,
      channelType: 'MESSAGE',
      eventType: 'REMOTE_STATE_CHANGED',
      publisher: 'audience-1',
      stateChanged: { microphoneError: 'true' },
    } as never));
    expect(within(room).getByText('MIC ERROR')).toBeInTheDocument();
    expect(within(room).getByTitle('麦克风设备异常')).toBeInTheDocument();

    await userEvent.setup().click(within(composer).getByRole('button', { name: '闭麦' }));
    expect(harness.operations).toContain('presence:set::true');
    expect(harness.operations).toContain('rtc:mute:true');
    expect(composer.lastElementChild).toHaveTextContent('下麦');
  });

  it('收到上麦邀请时右侧面板出现邀请卡，新消息到达时公屏滚到底部', async () => {
    const harness = createSceneHarness();
    render(<VoiceRoomScene
      env={env}
      overrides={harness.overrides}
      search={`?data=${encodeVoiceRoomUrlPayload(payload())}`}
    />);
    const room = await screen.findByLabelText('听众语聊房');
    const feed = within(room).getByTestId('voice-room-chat-feed');
    Object.defineProperty(feed, 'scrollHeight', { configurable: true, value: 600 });
    feed.scrollTop = 320;
    const now = Date.now();

    act(() => harness.emitMessage({
      timestamp: now,
      channelName: 'audience-1',
      channelType: 'USER',
      publisher: 'host-1',
      messageType: 'STRING',
      message: JSON.stringify({
        schemaVersion: 1,
        messageId: 'seat-invitation-scroll',
        type: 'seat.invited',
        roomId: 'voice-room-1',
        targetUserId: 'audience-1',
        sentAt: now,
        expiresAt: now + 15_000,
        payload: { invitationId: 'invitation-scroll', seatId: 'seat-1' },
      }),
    } as never));

    const invitation = await within(room).findByRole('status');
    expect(invitation).toHaveTextContent('房主邀请你上麦');
    expect(invitation).toHaveTextContent('SEAT 02');
    expect(within(invitation).getByRole('button', { name: '接受' })).toBeInTheDocument();
    expect(within(invitation).getByRole('button', { name: '拒绝' })).toBeInTheDocument();
    // 邀请卡不在公屏里，公屏位置不受影响。
    expect(feed.scrollTop).toBe(320);
    expect(within(feed).queryByText(/房主邀请你/)).not.toBeInTheDocument();

    act(() => harness.emitMessage({
      timestamp: now + 1,
      channelName: 'voice-room-1',
      channelType: 'MESSAGE',
      publisher: 'host-1',
      messageType: 'STRING',
      message: JSON.stringify({
        schemaVersion: 1,
        messageId: 'chat-after-invitation',
        type: 'chat.message',
        roomId: 'voice-room-1',
        sentAt: now + 1,
        expiresAt: now + 15_000,
        payload: { value: '欢迎上麦' },
      }),
    } as never));

    await vi.waitFor(() => expect(within(room).getByText('欢迎上麦')).toBeInTheDocument());
    expect(feed.scrollTop).toBe(600);
  });

  it('Host 用 Presence nickname 展示听众并按行邀请上麦，不暴露 UID', async () => {
    const harness = createSceneHarness();
    const user = userEvent.setup();
    render(<VoiceRoomScene env={env} overrides={harness.overrides} search="" />);
    await screen.findByTestId('voice-room-entry');
    await user.type(screen.getByLabelText('房间标题'), '昵称房间');
    await user.click(screen.getByRole('button', { name: '创建并进入' }));
    await screen.findByLabelText('房主语聊房');
    const currentPayload = parseVoiceRoomUrl(window.location.search)!;
    const roomId = isNamedVoiceRoomPayload(currentPayload) ? currentPayload.roomId : Object.values(currentPayload.localStorage)[0].roomId;

    act(() => harness.emitPresence({
      timestamp: 1,
      channelName: roomId,
      channelType: 'MESSAGE',
      eventType: 'SNAPSHOT',
      publisher: '',
      snapshot: [
        { userId: 'audience-1', states: { displayName: 'Host' }, statesCount: 1 },
        { userId: 'audience-2', states: { displayName: 'Alice_037' }, statesCount: 1 },
      ],
      interval: null,
    } as never));
    act(() => harness.emitStorage({
      timestamp: 2,
      channelName: roomId,
      channelType: 'MESSAGE',
      storageType: 'CHANNEL',
      eventType: 'UPDATE',
      publisher: 'audience-1',
      data: {
        majorRevision: 2,
        totalCount: 4,
        metadata: {
          hostUserId: { value: 'audience-1' },
          announcement: { value: '' },
          seats: { value: JSON.stringify({
            'seat-0': { seatId: 'seat-0', userId: 'audience-1', displayName: 'StorageHost' },
            'seat-1': { seatId: 'seat-1', userId: 'audience-2', displayName: 'Storage_999' },
            'seat-2': { seatId: 'seat-2', userId: null, displayName: null },
          }) },
          forcedMutedUserIds: { value: '[]' },
        },
      },
    } as never));

    const members = screen.getByRole('region', { name: '房间成员管理' });
    // 麦位与在线听众都用 Presence nickname，不用 Storage displayName。
    expect(screen.getAllByText('Alice_037').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('Storage_999')).not.toBeInTheDocument();
    expect(screen.queryByText('audience-2')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/UID/i)).not.toBeInTheDocument();
    expect(within(members).getByRole('button', { name: '封禁Alice_037' })).toBeInTheDocument();
    await user.click(within(members).getByRole('button', { name: '邀请Alice_037上麦' }));
    await waitFor(() => expect(harness.operations).toContain('rtm:publish:USER:seat.invited'));
  });

  it('直达 Audience URL 在平台登录完成前不闪现 choose', () => {
    const harness = createSceneHarness({ holdLogin: true });
    render(<VoiceRoomScene env={env} overrides={harness.overrides} search={`?data=${encodeVoiceRoomUrlPayload(payload())}`} />);

    expect(screen.getByTestId('voice-room-booting')).toBeInTheDocument();
    expect(screen.queryByTestId('voice-room-entry')).not.toBeInTheDocument();
  });

  it('Audience 刷新 active 房间时不校验 Host，Presence 中没有 Host 则展示暂时离开', async () => {
    const harness = createSceneHarness();
    const refreshPayload: VoiceRoomUrlPayload = {
      ...payload(),
      pageUid: 'audience-1',
      nickname: 'Alice_037',
    };

    render(<VoiceRoomScene
      env={env}
      overrides={harness.overrides}
      search={`?data=${encodeVoiceRoomUrlPayload(refreshPayload)}`}
    />);

    const room = await screen.findByLabelText('听众语聊房');
    act(() => harness.emitStorage({
      timestamp: 1,
      channelName: 'voice-room-1',
      channelType: 'MESSAGE',
      storageType: 'CHANNEL',
      eventType: 'SNAPSHOT',
      publisher: '',
      data: {
        majorRevision: 1,
        totalCount: 4,
        metadata: {
          hostUserId: { value: 'host-1' },
          announcement: { value: '' },
          seats: { value: JSON.stringify({
            'seat-0': { seatId: 'seat-0', userId: 'host-1', displayName: 'Host' },
          }) },
          forcedMutedUserIds: { value: '[]' },
        },
      },
    } as never));
    act(() => harness.emitPresence({
      timestamp: 2,
      channelName: 'voice-room-1',
      channelType: 'MESSAGE',
      eventType: 'SNAPSHOT',
      publisher: '',
      snapshot: [{ userId: 'audience-1', states: { displayName: 'Alice_037' }, statesCount: 1 }],
      interval: null,
    } as never));

    expect(within(room).getByText('AWAY')).toBeInTheDocument();
    expect(within(room).getByTitle('房主暂时离开')).toBeInTheDocument();
    expect(within(room).getByRole('button', { name: '申请上麦' })).toBeDisabled();
    expect(within(room).getByTitle('房主暂时离开，无法处理上麦申请')).toBeInTheDocument();
    expect(within(room).getByText('host-1')).toBeInTheDocument();
    expect(within(room).queryByText('Host')).not.toBeInTheDocument();
    expect(screen.queryByTestId('voice-room-ended')).not.toBeInTheDocument();
  });

  it('麦位展示由归属和强制静音派生，不再依赖 joining 存储状态', () => {
    expect(source).toContain('data-state={seat.status}');
    expect(source).toContain('forcedMuted');
    expect(source).not.toContain('seat.status === "joining"');
  });
});
