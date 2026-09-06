import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import type { RtcHelper } from '../../shared/rtc';
import { createBrowserRoomDirectory, type StorageLike } from './browser-room-directory';
import { RoomEntryController } from './room-entry-controller';
import { createDirectoryTestHub } from './name-directory.testing';
import { resolveRoomName, normalizeRoomName } from './room-name';
import { isNamedVoiceRoomPayload, createVoiceRoomUrl, parseVoiceRoomUrl, type NamedVoiceRoomUrlPayload } from './voice-room-url';
import { milestonesFromTrace } from './experienceProgress';
import { NameDirectory } from './name-directory';
import { AudienceNameDirectoryRtm } from './audience/name-directory-rtm';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { await Promise.allSettled(cleanups.splice(0).map(cleanup => cleanup())); });

async function page(hub: ReturnType<typeof createDirectoryTestHub>, userId: string, options: { directoryTimeoutMs?: number; creationGraceMs?: number } = {}) {
  const storage = new Map<string, string>();
  const local: StorageLike = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); }, removeItem: key => { storage.delete(key); }, keys: () => [...storage.keys()] };
  const session = hub.session(userId);
  await session.login();
  const rtcJoin = vi.fn(async () => {});
  const noop = async () => {};
  const createRtc = (): RtcHelper => ({ registerEvents() {}, join: rtcJoin, leave: noop, publishMicrophone: noop, unpublishMicrophone: noop,
    setMicrophoneMuted: noop, isMicrophoneCaptureHealthy: () => true, publishCamera: noop, unpublishCamera: noop, setCameraMuted: noop, getLocalVideoTrack: () => undefined });
  const directory = createBrowserRoomDirectory(local);
  const transports: AudienceNameDirectoryRtm[] = [];
  const controller = new RoomEntryController({ appId: 'test-app', session, directory, createRtc,
    directoryTimeoutMs: 300, ...options, onDirectoryTransport: transport => transports.push(transport as AudienceNameDirectoryRtm) });
  cleanups.push(async () => { await controller.leaveRoom(); await session.logout(); });
  return { controller, session, directory, storage, rtcJoin, transports };
}

function invitation(controller: RoomEntryController): NamedVoiceRoomUrlPayload {
  const payload = controller.getView().payload!;
  if (!isNamedVoiceRoomPayload(payload)) throw new Error('Expected named room');
  return { ...payload, role: 'audience', pageUid: null, nickname: null };
}

describe('共享名称房间', () => {
  it('两端不共享本地目录，仅凭规范化名称进入同一个随机房间', async () => {
    const hub = createDirectoryTestHub(), host = await page(hub, 'host'), audience = await page(hub, 'audience');
    await host.controller.createHostRoom({ roomName: '  ＲＴＭ   茶话会  ' });
    expect(audience.storage.size).toBe(0);
    await audience.controller.joinAudienceByName('rtm 茶话会');
    expect(audience.controller.getView().entry?.roomId).toBe(host.controller.getView().entry?.roomId);
    expect(audience.controller.getView().phase).toBe('room');
    expect(host.storage.size).toBe(0);
    expect(audience.storage.size).toBe(0);
    expect(hub.clients.get('host')?.channels.size).toBe(2);
    expect(hub.clients.get('audience')?.channels.size).toBe(2);
    expect(hub.calls.filter(call => call.name === 'login')).toHaveLength(2);
    const directorySubscriptions = hub.calls.filter(call => call.name === 'subscribe' && call.channel?.startsWith('vrn-v1-'));
    expect(directorySubscriptions.every(call => JSON.stringify(call.options) === JSON.stringify({ withMetadata: true, withMessage: false, withPresence: false, withLock: false }))).toBe(true);
    expect(host.transports.flatMap(source => source.getTraces()).flatMap(milestonesFromTrace)).toEqual([]);
  });

  it('解散只清空本轮实际房间数据，名称目录保留 inactive，听众不执行删除', async () => {
    const hub = createDirectoryTestHub(), host = await page(hub, 'host'), audience = await page(hub, 'audience');
    await host.controller.createHostRoom({ roomName: '清理验证' });
    await audience.controller.joinAudienceByName('清理验证');
    const entry = host.controller.getView().entry!;
    const oldClient = host.controller.getView().client!;
    expect(Object.keys(hub.records.get(entry.roomId)!.metadata)).toHaveLength(4);
    await oldClient.dissolveRoom();
    expect(hub.records.get(entry.roomId)!.metadata).toEqual({});
    expect(oldClient.getTraces()).toContainEqual(expect.objectContaining({ name: 'storage', eventTag: 'REMOVE', summary: '房间数据已清理' }));
    expect(JSON.parse(hub.records.get(entry.nameKey!)!.metadata.entry.value).status).toBe('inactive');
    expect(hub.calls.filter(call => call.name === 'remove')).toEqual([{ userId: 'host', name: 'remove', channel: entry.roomId }]);
    const start = hub.calls.findIndex(call => call.name === 'publish:room.dissolved');
    expect(hub.calls.findIndex(call => call.name === 'remove')).toBeGreaterThan(start);
    expect(audience.controller.getView().client?.getView().endedReason).toBe('房间已解散');
    await host.controller.leaveRoom();
    await host.controller.createHostRoom({ roomName: '清理验证' });
    const newRoomId = host.controller.getView().entry!.roomId;
    expect(newRoomId).not.toBe(entry.roomId);
    await oldClient.retryRoomCleanup();
    expect(Object.keys(hub.records.get(newRoomId)!.metadata)).toHaveLength(4);
  });

  it('两个独立页面同时首次创建，只允许一位房主成功', async () => {
    const hub = createDirectoryTestHub(), one = await page(hub, 'one'), two = await page(hub, 'two');
    const result = await Promise.allSettled([one.controller.createHostRoom({ roomName: '并发房' }), two.controller.createHostRoom({ roomName: '并发房' })]);
    expect(result.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    expect([one, two].filter(value => value.controller.getView().phase === 'room')).toHaveLength(1);
    const roomWrites = hub.calls.filter(call => call.name === 'write' && !call.channel?.startsWith('vrn-v1-'));
    expect(roomWrites).toHaveLength(1);
  });

  it('重复点击不能启动第二个名称登记', async () => {
    const hub = createDirectoryTestHub(), host = await page(hub, 'host');
    const first = host.controller.createHostRoom({ roomName: '连点房' });
    await expect(host.controller.createHostRoom({ roomName: '连点房' })).rejects.toThrow('已有房间操作');
    await first;
    expect(hub.calls.filter(call => call.name === 'write' && call.revision === 0 && call.channel?.startsWith('vrn-v1-'))).toHaveLength(1);
  });

  it('inactive 名称并发重建只有一位新房主，两个请求都使用条件版本', async () => {
    const hub = createDirectoryTestHub(), old = await page(hub, 'old');
    await old.controller.createHostRoom({ roomName: '重建竞争' });
    await old.controller.getView().client!.dissolveRoom();
    await old.controller.leaveRoom();
    const one = await page(hub, 'one'), two = await page(hub, 'two');
    const result = await Promise.allSettled([one.controller.createHostRoom({ roomName: '重建竞争' }), two.controller.createHostRoom({ roomName: '重建竞争' })]);
    expect(result.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    const claims = hub.calls.filter(call => ['one', 'two'].includes(call.userId) && call.name === 'write' && call.channel?.startsWith('vrn-v1-'));
    expect(claims.every(call => call.revision! > 0)).toBe(true);
  });

  it('连续观察的 creating 可条件接管，旧创建者不能迟到激活', async () => {
    const hub = createDirectoryTestHub(), old = await page(hub, 'old'), next = await page(hub, 'next', { creationGraceMs: 10 });
    hub.pauseRoomSnapshots(true);
    const oldResult = old.controller.createHostRoom({ roomName: '中断接管' }).then(() => 'success', () => 'failed');
    await waitFor(() => expect(old.controller.getView().phase).toBe('subscribing'));
    const oldId = old.controller.getView().entry!.roomId;
    hub.pauseRoomSnapshots(false);
    await next.controller.createHostRoom({ roomName: '中断接管' });
    expect(await oldResult).toBe('failed');
    expect(next.controller.getView().entry!.roomId).not.toBe(oldId);
    const key = (await resolveRoomName('中断接管')).nameKey;
    expect(JSON.parse(hub.records.get(key)!.metadata.entry.value)).toMatchObject({ hostUserId: 'next', status: 'active' });
  });

  it('只有真实空快照返回未找到，查询超时不会冒充不存在', async () => {
    const hub = createDirectoryTestHub(), audience = await page(hub, 'audience', { directoryTimeoutMs: 20 });
    await expect(audience.controller.joinAudienceByName('不存在')).rejects.toThrow('未找到');
    hub.pauseSnapshots(true);
    await expect(audience.controller.joinAudienceByName('网络中断')).rejects.toThrow('暂时无法确认');
    expect(audience.controller.getView().error).not.toContain('未找到');
    expect(hub.calls.filter(call => call.name === 'write')).toHaveLength(0);
  });

  it('实际房间未就绪时不发布 RTC 或 Presence，取消后退订两频道', async () => {
    const hub = createDirectoryTestHub(), host = await page(hub, 'host');
    hub.pauseRoomSnapshots(true);
    const pending = host.controller.createHostRoom({ roomName: '准备中' });
    await waitFor(() => expect(host.controller.getView().phase).toBe('subscribing'));
    expect(host.rtcJoin).not.toHaveBeenCalled();
    expect(hub.calls.some(call => call.name === 'presence')).toBe(false);
    await host.controller.leaveRoom();
    await pending;
    expect(host.controller.getView().phase).toBe('idle');
    expect(hub.clients.get('host')?.channels.size).toBe(0);
  });

  it('创建初始化失败可由同一请求恢复，不制造第二个实际房间', async () => {
    const hub = createDirectoryTestHub(), host = await page(hub, 'host', { directoryTimeoutMs: 20 });
    hub.pauseRoomSnapshots(true);
    await expect(host.controller.createHostRoom({ roomName: '重试房' })).rejects.toThrow('房间准备超时');
    const before = JSON.parse([...hub.records.values()][0].metadata.entry.value);
    hub.pauseRoomSnapshots(false);
    await host.controller.createHostRoom({ roomName: '重试房' });
    expect(host.controller.getView().entry?.roomId).toBe(before.roomId);
  });

  it('写入已成功但应答丢失，通过新快照确认归属后继续', async () => {
    const hub = createDirectoryTestHub(), host = await page(hub, 'host');
    hub.failNextWrite('after');
    await host.controller.createHostRoom({ roomName: '未知结果恢复' });
    expect(host.controller.getView().phase).toBe('room');
    expect(hub.calls.filter(call => call.name === 'write' && call.revision === 0 && call.channel?.startsWith('vrn-v1-'))).toHaveLength(1);
  });

  it('房主暂时离开仍然允许听众按名加入，Host URL 可恢复', async () => {
    const hub = createDirectoryTestHub(), host = await page(hub, 'host'), audience = await page(hub, 'audience');
    await host.controller.createHostRoom({ roomName: '暂离房' });
    const payload = host.controller.getView().payload!;
    await host.controller.leaveRoom();
    await audience.controller.joinAudienceByName('暂离房');
    expect(audience.controller.getView().phase).toBe('room');
    await host.controller.restoreHostFromUrlPayload(payload);
    expect(host.controller.getView().phase).toBe('room');
    expect(hub.calls.filter(call => call.name === 'remove')).toEqual([]);
  });

  it('共享解散成功但广播失败，已有听众仍通过目录退出且新加入被拒绝', async () => {
    const hub = createDirectoryTestHub(), host = await page(hub, 'host'), audience = await page(hub, 'audience');
    await host.controller.createHostRoom({ roomName: '消息丢失房' });
    await audience.controller.joinAudienceByName('消息丢失房');
    const roomId = host.controller.getView().entry!.roomId;
    hub.failMessages(true);
    await expect(host.controller.getView().client!.dissolveRoom()).rejects.toThrow('消息发送失败');
    expect(hub.records.get(roomId)!.metadata).toEqual({});
    await waitFor(() => expect(audience.controller.getView().client?.getView().endedReason).toBe('房间已解散'));
    await audience.controller.leaveRoom();
    await expect(audience.controller.joinAudienceByName('消息丢失房')).rejects.toThrow('房间已解散');
  });

  it('解散共享写入失败不能本地假成功，允许再次确认', async () => {
    const hub = createDirectoryTestHub(), host = await page(hub, 'host');
    await host.controller.createHostRoom({ roomName: '解散重试' });
    hub.failNextWrite('before');
    await expect(host.controller.getView().client!.dissolveRoom()).rejects.toThrow('尚未确认');
    expect(host.controller.getView().client?.getView().endedReason).toBeUndefined();
    expect(hub.calls.filter(call => call.name === 'remove')).toEqual([]);
    const nameKey = host.controller.getView().entry!.nameKey!;
    expect(JSON.parse(hub.records.get(nameKey)!.metadata.entry.value).status).toBe('active');
    await host.controller.getView().client!.dissolveRoom();
    expect(JSON.parse(hub.records.get(nameKey)!.metadata.entry.value).status).toBe('inactive');
    expect(host.storage.size).toBe(0);
  });

  it('同名重建必须换 roomId，旧邀请、最近记录和迟到房主操作都不能影响新房间', async () => {
    const hub = createDirectoryTestHub(), host = await page(hub, 'host'), audience = await page(hub, 'audience');
    await host.controller.createHostRoom({ roomName: '重建房' });
    const oldClient = host.controller.getView().client!, oldInvite = invitation(host.controller);
    // Simulate a record left by an older version; new joins no longer write history.
    audience.directory.upsert(host.controller.getView().entry!);
    await audience.controller.joinAudienceByName('重建房');
    await oldClient.dissolveRoom();
    await host.controller.leaveRoom();
    await audience.controller.leaveRoom();
    await host.controller.createHostRoom({ roomName: '重建房' });
    expect(host.controller.getView().entry?.roomId).not.toBe(oldInvite.roomId);
    await expect(audience.controller.joinAudienceFromUrlPayload(oldInvite)).rejects.toThrow('原房间已结束');
    await expect(audience.controller.joinAudienceFromDirectory(oldInvite.roomId)).rejects.toThrow('原房间已结束');
    await expect(oldClient.banMember('audience')).rejects.toThrow();
    await audience.controller.joinAudienceByName('重建房');
    expect(audience.controller.getView().phase).toBe('room');
  });

  it('云端封禁先于 P2P；相同 UID 清理本地缓存后仍然无法加入', async () => {
    const hub = createDirectoryTestHub(), host = await page(hub, 'host'), audience = await page(hub, 'audience');
    await host.controller.createHostRoom({ roomName: '封禁房' });
    await audience.controller.joinAudienceByName('封禁房');
    const start = hub.calls.length;
    await host.controller.getView().client!.banMember('audience');
    const calls = hub.calls.slice(start);
    expect(calls.findIndex(call => call.name === 'write')).toBeLessThan(calls.findIndex(call => call.name === 'publish:member.ban'));
    await audience.controller.leaveRoom();
    audience.storage.clear();
    await expect(audience.controller.joinAudienceByName('封禁房')).rejects.toThrow('你已被该房间封禁');
  });

  it('断线时不把旧快照当作已确认，重连全量快照可恢复结束状态', async () => {
    const hub = createDirectoryTestHub(), host = await page(hub, 'host'), audience = await page(hub, 'audience');
    await host.controller.createHostRoom({ roomName: '重连房' });
    await audience.controller.joinAudienceByName('重连房');
    hub.emitLink('audience', false);
    expect(audience.controller.getView().directoryConnected).toBe(false);
    hub.failMessages(true);
    await host.controller.getView().client!.dissolveRoom().catch(() => {});
    hub.emitLink('audience', true);
    const key = (await resolveRoomName('重连房')).nameKey;
    hub.emitStorage('audience', key, 'SNAPSHOT');
    await waitFor(() => expect(audience.controller.getView().client?.getView().endedReason).toBe('房间已解散'));
  });

  it('没有 Host 身份的页面不能通过改 role 接管已有名称', async () => {
    const hub = createDirectoryTestHub(), host = await page(hub, 'host'), other = await page(hub, 'other');
    await host.controller.createHostRoom({ roomName: '身份房' });
    await expect(other.controller.restoreHostFromUrlPayload({ ...invitation(host.controller), role: 'host', pageUid: 'other' })).rejects.toThrow('房主身份');
    expect(other.controller.getView().client).toBeUndefined();
  });
});

describe('名称与协议', () => {
  it('全半角、大小写与空格归一，中文可用，频道固定 50 个 ASCII 字符', async () => {
    const a = await resolveRoomName(' ＡＢＣ　 茶话会 '), b = await resolveRoomName('abc 茶话会');
    expect(a.nameKey).toBe(b.nameKey);
    expect(a.nameKey).toHaveLength(50);
    expect(a.roomName).toBe('ABC 茶话会');
    expect(() => normalizeRoomName('😀'.repeat(32))).not.toThrow();
    for (const input of ['', '   ', '字'.repeat(33), 'ab\u200Bcd', 'a\nb']) expect(() => normalizeRoomName(input)).toThrow();
  });

  it('V2 链接保持 data 参数且不复制本地目录，四种粘贴格式均可解析', async () => {
    const nameKey = (await resolveRoomName('邀请房')).nameKey;
    const payload: NamedVoiceRoomUrlPayload = { version: 2, nameKey, roomId: 'random-room', role: 'audience', pageUid: null, nickname: null };
    const url = createVoiceRoomUrl('https://example.com', payload), encoded = new URL(url).searchParams.get('data')!;
    for (const input of [url, `?data=${encoded}`, `data=${encoded}`, encoded]) expect(parseVoiceRoomUrl(input)).toEqual(payload);
    expect(JSON.stringify(payload)).not.toContain('localStorage');
  });

  it('未知协议与名称不匹配不能进入实际房间', async () => {
    const hub = createDirectoryTestHub(), audience = await page(hub, 'audience');
    const nameKey = (await resolveRoomName('错误登记')).nameKey;
    hub.records.set(nameKey, { majorRevision: 1, metadata: { entry: { value: JSON.stringify({ schemaVersion: 99 }), revision: 1, authorUid: 'host', updated: 1 } } });
    await expect(audience.controller.joinAudienceByName('错误登记')).rejects.toThrow('格式不兼容');
    expect(hub.calls.filter(call => call.name === 'subscribe' && !call.channel?.startsWith('vrn-v1-'))).toHaveLength(0);
  });

  it('目录绑定与角色监听互不覆盖，关闭目录不会注销页面登录', async () => {
    const hub = createDirectoryTestHub(), session = hub.session('reader');
    await session.login();
    const roleStorage = vi.fn();
    session.bindRtmEvents({ storage: roleStorage });
    const directory = new NameDirectory(new AudienceNameDirectoryRtm(session, (await resolveRoomName('目录测试')).nameKey));
    await directory.open();
    expect(roleStorage).toHaveBeenCalled();
    await directory.close();
    expect(hub.calls.some(call => call.name === 'logout')).toBe(false);
    await session.logout();
  });
});
