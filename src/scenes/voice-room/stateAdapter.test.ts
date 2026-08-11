import { describe, expect, it } from 'vitest';

import { voiceRoomStateAdapter } from './stateAdapter';
import type { VoiceRoomSnapshot } from './state';

const { createInitial, parseStored, reduce } = voiceRoomStateAdapter;

function validSnapshot(): VoiceRoomSnapshot {
  return createInitial('host-aaa111');
}

describe('createInitial', () => {
  it('生成 4 个麦位、房主占 seat-0、队列与封禁为空', () => {
    const snapshot = createInitial('host-aaa111');

    expect(snapshot.revision).toBe(0);
    expect(snapshot.hostUserId).toBe('host-aaa111');
    expect(Object.keys(snapshot.seats)).toHaveLength(4);
    expect(snapshot.seats['seat-0'].userId).toBe('host-aaa111');
    expect(snapshot.queue).toEqual([]);
    expect(snapshot.invitation).toBeNull();
    expect(snapshot.bannedUserIds).toEqual([]);
  });
});

describe('parseStored', () => {
  it('合法快照原样返回', () => {
    const snapshot = validSnapshot();

    expect(parseStored(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it('无效输入返回空值由调用方兜底 —— 不返回 fallback 快照', () => {
    // 刻意不返回兜底值：兜底策略归调用方，
    // 归一函数只负责回答「这份数据能不能用」。
    expect(parseStored(undefined)).toBeUndefined();
    expect(parseStored('')).toBeUndefined();
    expect(parseStored('not json at all')).toBeUndefined();
    expect(parseStored('null')).toBeUndefined();
    expect(parseStored('123')).toBeUndefined();
    expect(parseStored('"a string"')).toBeUndefined();
    expect(parseStored('[]')).toBeUndefined();
  });

  it('缺字段返回空值', () => {
    const snapshot = validSnapshot();

    for (const key of ['revision', 'hostUserId', 'seats', 'queue', 'bannedUserIds'] as const) {
      const broken: Record<string, unknown> = { ...snapshot };
      delete broken[key];
      expect(parseStored(JSON.stringify(broken))).toBeUndefined();
    }
  });

  it('字段类型不对返回空值', () => {
    const snapshot = validSnapshot();

    expect(parseStored(JSON.stringify({ ...snapshot, revision: '0' }))).toBeUndefined();
    expect(parseStored(JSON.stringify({ ...snapshot, seats: [] }))).toBeUndefined();
    expect(parseStored(JSON.stringify({ ...snapshot, queue: {} }))).toBeUndefined();
    expect(parseStored(JSON.stringify({ ...snapshot, bannedUserIds: 'x' }))).toBeUndefined();
  });

  it('不抛异常 —— 无效数据是常态而非异常', () => {
    expect(() => parseStored('{{{')).not.toThrow();
  });
});

describe('reduce', () => {
  it('按动作调对应的转移函数', () => {
    const snapshot = createInitial('host-aaa111');

    const next = reduce(snapshot, {
      type: 'seat.request',
      request: {
        id: 'req-1',
        userId: 'audience-bbb222',
        displayName: '听众',
        seatId: 'seat-1',
        createdAt: 1_000,
      },
    });

    expect(next.queue).toHaveLength(1);
    expect(next.revision).toBe(snapshot.revision + 1);
  });

  it('是纯函数：同输入同输出', () => {
    const snapshot = createInitial('host-aaa111');
    const action = { type: 'announcement.update', actorId: 'host-aaa111', text: '新公告' } as const;

    expect(reduce(snapshot, action)).toEqual(reduce(snapshot, action));
  });

  it('是纯函数：不改入参', () => {
    const snapshot = createInitial('host-aaa111');
    const before = JSON.parse(JSON.stringify(snapshot));

    reduce(snapshot, { type: 'announcement.update', actorId: 'host-aaa111', text: '新公告' });

    expect(snapshot).toEqual(before);
  });

  it('麦位激活由媒体结果驱动：joining → active 与回滚都走 reduce', () => {
    let snapshot = createInitial('host-aaa111');
    snapshot = reduce(snapshot, {
      type: 'seat.request',
      request: {
        id: 'req-1',
        userId: 'audience-bbb222',
        displayName: '听众',
        seatId: 'seat-1',
        createdAt: 1_000,
      },
    });
    snapshot = reduce(snapshot, {
      type: 'seat.approve',
      actorId: 'host-aaa111',
      requestId: 'req-1',
    });

    expect(snapshot.seats['seat-1'].status).toBe('joining');

    const activated = reduce(snapshot, {
      type: 'seat.activate',
      seatId: 'seat-1',
      userId: 'audience-bbb222',
    });
    expect(activated.seats['seat-1'].status).toBe('active');

    const rolledBack = reduce(snapshot, {
      type: 'seat.rollback',
      seatId: 'seat-1',
      userId: 'audience-bbb222',
    });
    expect(rolledBack.seats['seat-1'].status).toBe('empty');
  });

  it('领域错误照常抛出 —— reduce 不吞规则违规', () => {
    const snapshot = createInitial('host-aaa111');

    expect(() =>
      reduce(snapshot, { type: 'announcement.update', actorId: 'audience-bbb222', text: '越权' }),
    ).toThrow();
  });
});
