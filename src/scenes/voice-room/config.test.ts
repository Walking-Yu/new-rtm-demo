import { describe, expect, it } from 'vitest';

import { MAX_CLIENTS, ROLES, SEAT_COUNT } from './config';
import { createInitialSnapshot } from './transitions';

describe('场景配置', () => {
  it('SEAT_COUNT 与转移函数实际生成的麦位数一致', () => {
    // 迁移时按票 17 要求「逻辑一行不改」，麦位数仍硬编码在 transitions.ts 里。
    // 这条护栏保证两处不会各自漂移。
    expect(Object.keys(createInitialSnapshot('host-aaa111').seats)).toHaveLength(SEAT_COUNT);
  });

  it('端数上限是 2，且与角色数一致 —— 一角色一个真实客户端', () => {
    expect(MAX_CLIENTS).toBe(2);
    expect(ROLES).toHaveLength(MAX_CLIENTS);
  });

  it('主角色是房主 —— `?uid=` 简写的目标是第一项', () => {
    expect(ROLES[0]).toBe('host');
  });
});
