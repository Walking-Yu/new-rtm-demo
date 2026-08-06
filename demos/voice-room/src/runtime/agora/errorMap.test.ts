import { describe, expect, it } from 'vitest';
import { mapRtcError, mapRtmError } from './errorMap';

describe('Agora error mapping', () => {
  it('maps invalid and expired RTM tokens', () => {
    expect(mapRtmError({ code: 'INVALID_TOKEN' })).toBe('RTM Token 无效，请重新生成');
    expect(mapRtmError(new Error('TOKEN_EXPIRED'))).toBe('RTM Token 已过期，请重新生成');
  });

  it('maps duplicate login, network, and Lock conflict failures', () => {
    expect(mapRtmError({ message: 'SAME_UID_LOGIN' })).toBe('该 RTM User ID 已在其他实例登录');
    expect(mapRtmError({ code: 'CONNECTION_ERROR' })).toBe('RTM 网络连接失败，请检查网络后重试');
    expect(mapRtmError({ code: 'LOCK_NOT_ACQUIRED' })).toBe('房间状态正在被其他客户端更新，请重试');
  });

  it('maps RTC token and microphone permission failures', () => {
    expect(mapRtcError({ code: 'INVALID_TOKEN' })).toBe('RTC Token 无效或已过期，请重新生成');
    expect(mapRtcError(new DOMException('Permission denied', 'NotAllowedError')))
      .toBe('浏览器未授予麦克风权限');
  });

  it('uses safe source-specific defaults', () => {
    expect(mapRtmError({ privateDetail: 'do not leak' })).toBe('RTM 操作失败，请稍后重试');
    expect(mapRtcError({ privateDetail: 'do not leak' })).toBe('RTC 音频操作失败，请稍后重试');
  });
});
