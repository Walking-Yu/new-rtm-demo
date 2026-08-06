import { describe, expect, it } from 'vitest';
import { mapRtmError } from './errorMap';

describe('mapRtmError', () => {
  it('maps token, duplicate login, and network failures', () => {
    expect(mapRtmError({ code: 'TOKEN_EXPIRED' }).message).toBe('Token 无效或已过期');
    expect(mapRtmError(new Error('SAME_UID_LOGIN'))).toMatchObject({
      kind: 'duplicate-login',
      message: '该用户已在其他设备登录',
    });
    expect(mapRtmError({ message: 'network unavailable' })).toMatchObject({
      kind: 'network',
      message: '网络连接已断开',
    });
  });

  it('uses a safe fallback without exposing SDK internals', () => {
    expect(mapRtmError({ privateDetail: 'secret' })).toEqual({
      kind: 'operation',
      message: 'RTM 操作失败',
    });
  });
});
