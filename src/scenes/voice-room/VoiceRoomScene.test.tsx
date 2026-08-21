import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { RtcHelper } from '../../shared/rtc';
import type { TraceSource } from '../../shared/timeline/useMergedTraces';
import type { AppRtmEventListeners, AppRoomRtmPort } from './app-rtm';
import type { AppRtmSession } from './app-rtm';
import { parseVoiceRoomUrl, VoiceRoomScene } from './VoiceRoomScene';
import { encodeVoiceRoomUrlPayload, type VoiceRoomUrlPayload } from './voice-room-url';
import source from './VoiceRoomScene.tsx?raw';

const env = { configured: true, appId: 'test-app-id', source: 'window.__ENV__' } as const;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function payload(): VoiceRoomUrlPayload {
  return {
    localStorage: {
      'record-channel-list-20260818': {
        roomId: 'voice-room-1', roomName: '邀请房间', hostUserId: 'host-1',
        createdAt: Date.parse('2026-08-18T01:00:00.000Z'),
        updatedAt: Date.parse('2026-08-18T01:00:00.000Z'), banUserIds: [], status: 'active',
      },
    },
    role: 'audience',
    pageUid: null,
    nickname: null,
  };
}

function createSceneHarness(options: { holdLogin?: boolean; holdSubscribe?: boolean } = {}) {
  const operations: string[] = [];
  const login = deferred();
  const subscribe = deferred();
  let handlers: AppRtmEventListeners = {};
  const port: AppRoomRtmPort = {
    async subscribe() { operations.push('rtm:subscribe'); if (options.holdSubscribe) await subscribe.promise; },
    async unsubscribe() { operations.push('rtm:unsubscribe'); },
    async publish(_channelName, message, channelType) {
      operations.push(`rtm:publish:${channelType}:${JSON.parse(message).type}`);
    },
    async setPresenceState(_roomId, state) {
      operations.push(`presence:set:${state.displayName ?? ''}:${state.muted ?? ''}`);
    },
    async removePresenceState(_roomId, keys) {
      operations.push(`presence:remove:${keys.join(',')}`);
    },
    async setRoomMetadata() {},
  };
  const session = {
    userId: 'audience-1',
    async login() { operations.push('rtm:login'); if (options.holdLogin) await login.promise; return port; },
    async logout() { operations.push('rtm:logout'); },
    getTraces: () => [],
    subscribeTraces: () => () => undefined,
    clearTraces() {},
    getRoomPort: () => port,
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
    resolveLogin: login.resolve,
    resolveSubscribe: subscribe.resolve,
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

  it('choose 主页同时提供 Host 创建和 Audience 邀请链接入口', async () => {
    const harness = createSceneHarness();
    const user = userEvent.setup();
    render(<VoiceRoomScene env={env} overrides={harness.overrides} search="" />);
    await screen.findByTestId('voice-room-entry');

    expect(screen.getByText('创建一间语聊房，或通过邀请链接加入一场正在发生的对话。')).toBeInTheDocument();
    expect(screen.queryByText(/RTM 身份/)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('房间标题'), '新房间');

    expect(screen.getByLabelText('邀请链接')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建并进入' })).toBeEnabled();
  });

  it('订阅开始时房间 UI 已挂载，并由统一 loading 蒙层阻断', async () => {
    const harness = createSceneHarness({ holdSubscribe: true });
    const user = userEvent.setup();
    render(<VoiceRoomScene env={env} overrides={harness.overrides} search="" />);
    await screen.findByTestId('voice-room-entry');
    await user.type(screen.getByLabelText('房间标题'), '新房间');
    await user.click(screen.getByRole('button', { name: '创建并进入' }));

    expect(screen.getByLabelText('房主语聊房')).toBeInTheDocument();
    expect(screen.getByTestId('voice-room-loading-overlay')).toHaveTextContent('正在加载房间…');
    await act(async () => harness.resolveSubscribe());
    expect(screen.queryByTestId('voice-room-loading-overlay')).not.toBeInTheDocument();
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
    const roomId = Object.values(currentPayload.localStorage)[0].roomId;
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
    await vi.waitFor(() => expect(publishedSources.at(-1)).toHaveLength(2));

    await user.click(within(room).getByRole('button', { name: '暂时离开' }));

    await vi.waitFor(() => expect(screen.getByTestId('voice-room-entry')).toBeInTheDocument());
    expect(publishedSources.at(-1)).toHaveLength(2);
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
    const roomId = Object.values(currentPayload.localStorage)[0].roomId;
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
    expect(within(room).getByText('麦克风异常')).toBeInTheDocument();
    expect(within(room).getByTitle('麦克风设备异常')).toBeInTheDocument();

    await userEvent.setup().click(within(composer).getByRole('button', { name: '闭麦' }));
    expect(harness.operations).toContain('presence:set::true');
    expect(harness.operations).toContain('rtc:mute:true');
    expect(composer.lastElementChild).toHaveTextContent('主动下麦');
  });

  it('收到上麦邀请时公屏回到顶部，后续新消息到达时再滚到底部', async () => {
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

    expect(await within(room).findByText('房主邀请你上 2 号麦')).toBeInTheDocument();
    expect(feed.scrollTop).toBe(0);

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

  it('复制邀请后在房间内显示 toast，3 秒后消失', async () => {
    const harness = createSceneHarness();
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(<VoiceRoomScene env={env} overrides={harness.overrides} search="" />);
    await screen.findByTestId('voice-room-entry');
    await user.type(screen.getByLabelText('房间标题'), 'Toast 房间');
    await user.click(screen.getByRole('button', { name: '创建并进入' }));
    const room = await screen.findByLabelText('房主语聊房');

    vi.useFakeTimers();
    fireEvent.click(within(room).getByRole('button', { name: '复制观众邀请链接' }));
    await act(async () => { await Promise.resolve(); });
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(
      /^http:\/\/localhost(?::\d+)?\/social\/voice-room\?data=[A-Za-z0-9_-]+$/,
    ));
    const toast = within(room).getByText('已复制完整邀请链接').closest('.vr-toast-message')!;
    expect(toast).toHaveClass('vr-room-toast');
    expect(toast.closest('.vr-toast-viewport')).toHaveClass('vr-toast-viewport--header');

    act(() => vi.advanceTimersByTime(3_000));
    expect(within(room).queryByText('已复制完整邀请链接')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('局域网 HTTP 没有 Clipboard API 时通过兼容路径复制短邀请内容', async () => {
    const harness = createSceneHarness();
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    let fallbackText = "";
    const execCommand = vi.fn(() => {
      fallbackText = (document.querySelector('textarea[aria-hidden="true"]') as HTMLTextAreaElement)?.value ?? "";
      return true;
    });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    render(<VoiceRoomScene env={env} overrides={harness.overrides} search="" />);
    await screen.findByTestId('voice-room-entry');
    await user.type(screen.getByLabelText('房间标题'), 'LAN 房间');
    await user.click(screen.getByRole('button', { name: '创建并进入' }));
    const room = await screen.findByLabelText('房主语聊房');

    await user.click(within(room).getByRole('button', { name: '复制观众邀请链接' }));

    await vi.waitFor(() => expect(execCommand).toHaveBeenCalledWith('copy'));
    expect(fallbackText).toMatch(/^data=[A-Za-z0-9_-]+$/);
    expect(within(room).getByText('已复制短邀请内容')).toBeInTheDocument();
  });

  it('Audience 输入短邀请内容后可以加入房间', async () => {
    const harness = createSceneHarness();
    render(<VoiceRoomScene env={env} overrides={harness.overrides} search="" />);
    await screen.findByTestId('voice-room-entry');

    fireEvent.change(screen.getByLabelText('邀请链接'), {
      target: { value: `data=${encodeVoiceRoomUrlPayload(payload())}` },
    });
    fireEvent.click(screen.getByRole('button', { name: '加入房间' }));

    expect(await screen.findByLabelText('听众语聊房')).toBeInTheDocument();
  });

  it('Host 用 Presence nickname 展示和选择听众，不暴露 UID', async () => {
    const harness = createSceneHarness();
    const user = userEvent.setup();
    render(<VoiceRoomScene env={env} overrides={harness.overrides} search="" />);
    await screen.findByTestId('voice-room-entry');
    await user.type(screen.getByLabelText('房间标题'), '昵称房间');
    await user.click(screen.getByRole('button', { name: '创建并进入' }));
    await screen.findByLabelText('房主语聊房');
    const currentPayload = parseVoiceRoomUrl(window.location.search)!;
    const roomId = Object.values(currentPayload.localStorage)[0].roomId;

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
          }) },
          forcedMutedUserIds: { value: '[]' },
        },
      },
    } as never));

    await user.click(screen.getByRole('combobox', { name: '选择邀请听众' }));
    expect(screen.getAllByText('Alice_037').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('option', { name: 'Alice_037' })).toBeInTheDocument();
    expect(screen.queryByText('Storage_999')).not.toBeInTheDocument();
    await user.type(screen.getByRole('combobox', { name: '选择邀请听众' }), 'Alice');
    expect(screen.getByRole('option', { name: 'Alice_037' })).toBeInTheDocument();
    expect(screen.queryByText('audience-2')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/UID/i)).not.toBeInTheDocument();
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

    expect(within(room).getByText('暂时离开…')).toBeInTheDocument();
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
