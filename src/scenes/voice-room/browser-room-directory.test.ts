import { describe, expect, it } from 'vitest';

import {
  createBrowserRoomDirectory,
  directoryStorageKey,
  type StorageLike,
} from './browser-room-directory';

function createStorage(): StorageLike {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    keys: () => [...values.keys()],
  };
}

describe('浏览器房间目录', () => {
  it('按 UTC 日期写入带更新时间的房间记录，并按 roomId 去重更新', () => {
    const storage = createStorage();
    const directory = createBrowserRoomDirectory(storage, () => new Date('2026-08-15T01:00:00.000Z'));

    directory.upsert({
      roomId: 'voice-room-1', roomName: '第一次标题',
    });
    directory.upsert({
      roomId: 'voice-room-1', roomName: '更新后的标题',
    });

    expect(directoryStorageKey(new Date('2026-08-15T01:00:00.000Z'))).toBe('record-channel-list-20260815');
    expect(directory.list()).toEqual([
      { roomId: 'voice-room-1', roomName: '更新后的标题', createdAt: Date.UTC(2026, 7, 15, 1), updatedAt: Date.UTC(2026, 7, 15, 1), hostUserId: undefined, banUserIds: [], status: 'active' },
    ]);
    expect(JSON.parse(storage.getItem('record-channel-list-20260815') ?? '')).toEqual(directory.list());
  });

  it('合并邀请链接与本地记录：数组去重合并，标量采用较新的 updatedAt', () => {
    const storage = createStorage();
    const directory = createBrowserRoomDirectory(storage, () => new Date('2026-08-15T01:00:00.000Z'));
    directory.upsert({ roomId: 'voice-room-1', roomName: '旧标题', hostUserId: 'host-old', banUserIds: ['audience-a'], updatedAt: 10 });
    directory.upsert({ roomId: 'voice-room-1', roomName: '新标题', hostUserId: 'host-new', banUserIds: ['audience-a', 'audience-b'], updatedAt: 20 });

    expect(directory.list()[0]).toMatchObject({ roomName: '新标题', hostUserId: 'host-new', banUserIds: ['audience-a', 'audience-b'], updatedAt: 20 });
  });

  it('增量更新未携带 Host UID 时保留已有 Host UID', () => {
    const storage = createStorage();
    const directory = createBrowserRoomDirectory(storage, () => new Date('2026-08-15T01:00:00.000Z'));
    directory.upsert({ roomId: 'voice-room-1', roomName: '标题', hostUserId: 'host-1', updatedAt: 10 });
    directory.upsert({ roomId: 'voice-room-1', roomName: '标题', updatedAt: 20 });
    expect(directory.list()[0]?.hostUserId).toBe('host-1');
  });

  it('只保留指定天数内的目录，并按创建时间从近到远返回', () => {
    const storage = createStorage();
    const now = new Date('2026-08-15T12:00:00.000Z');
    storage.setItem('record-channel-list-20260801', JSON.stringify([{
      roomId: 'expired', roomName: '过期', createdAt: 1,
    }]));
    const directory = createBrowserRoomDirectory(storage, () => now, 7);

    directory.upsert({ roomId: 'older', roomName: '较早', createdAt: now.getTime() - 2_000 });
    directory.upsert({ roomId: 'latest', roomName: '最新', createdAt: now.getTime() - 1_000 });

    expect(directory.list().map((entry) => entry.roomId)).toEqual(['latest', 'older']);
    expect(storage.getItem('record-channel-list-20260801')).toBeNull();
  });

  it('把 URL 中的单房间合并进指定日期 key，不覆盖同日其他房间', () => {
    const storage = createStorage();
    const createdAt = Date.parse('2026-08-14T12:00:00.000Z');
    storage.setItem('record-channel-list-20260814', JSON.stringify([{
      roomId: 'existing', roomName: '已有房间', hostUserId: 'host-existing',
      createdAt, updatedAt: createdAt, banUserIds: [],
    }]));
    const directory = createBrowserRoomDirectory(storage, () => new Date('2026-08-15T01:00:00.000Z'));

    directory.merge('record-channel-list-20260814', {
      roomId: 'invited', roomName: '邀请房间', hostUserId: 'host-1',
      createdAt: createdAt + 1, updatedAt: createdAt + 1, banUserIds: ['audience-2'], status: 'active',
    });

    expect(JSON.parse(storage.getItem('record-channel-list-20260814') ?? '[]'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ roomId: 'existing' }),
        expect.objectContaining({ roomId: 'invited' }),
      ]));
    expect(directory.get('invited')?.hostUserId).toBe('host-1');
  });

  it('列表展示前过滤封禁当前 UID 的房间，但 get 仍可用于点击复检', () => {
    const storage = createStorage();
    const directory = createBrowserRoomDirectory(storage, () => new Date('2026-08-15T01:00:00.000Z'));
    directory.upsert({ roomId: 'allowed', roomName: '可加入', hostUserId: 'host-1' });
    directory.upsert({ roomId: 'banned', roomName: '已封禁', hostUserId: 'host-2', banUserIds: ['audience-1'] });

    expect(directory.listForUser('audience-1').map(({ roomId }) => roomId)).toEqual(['allowed']);
    expect(directory.get('banned')?.banUserIds).toContain('audience-1');
  });

  it('旧目录缺少 status 时归一为 active，inactive 为终态且不再出现在可加入列表', () => {
    const storage = createStorage();
    storage.setItem('record-channel-list-20260815', JSON.stringify([{
      roomId: 'legacy', roomName: '旧房间', hostUserId: 'host-1',
      createdAt: Date.parse('2026-08-15T00:00:00.000Z'), updatedAt: 10, banUserIds: [],
    }]));
    const directory = createBrowserRoomDirectory(storage, () => new Date('2026-08-15T01:00:00.000Z'));

    expect(directory.get('legacy')?.status).toBe('active');
    directory.upsert({ roomId: 'legacy', roomName: '旧房间', status: 'inactive', updatedAt: 20 });
    directory.upsert({ roomId: 'legacy', roomName: '旧房间', status: 'active', updatedAt: 30 });

    expect(directory.get('legacy')?.status).toBe('inactive');
    expect(directory.listForUser('audience-1')).toEqual([]);
  });

  it('更新历史房间时保留原日期 key，不在今日目录中制造副本', () => {
    const storage = createStorage();
    storage.setItem('record-channel-list-20260814', JSON.stringify([{
      roomId: 'room-1', roomName: '旧名称', hostUserId: 'host-1',
      createdAt: Date.parse('2026-08-14T10:00:00.000Z'), updatedAt: 10, banUserIds: [],
    }]));
    const directory = createBrowserRoomDirectory(storage, () => new Date('2026-08-15T01:00:00.000Z'));

    directory.upsert({ roomId: 'room-1', roomName: '新名称', updatedAt: 20 });

    expect(storage.getItem('record-channel-list-20260815')).toBeNull();
    expect(JSON.parse(storage.getItem('record-channel-list-20260814') ?? '[]')[0].roomName).toBe('新名称');
  });
});
