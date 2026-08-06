export type RtmErrorKind = 'token' | 'duplicate-login' | 'network' | 'permission' | 'operation';

export interface NormalizedRtmError {
  kind: RtmErrorKind;
  message: string;
}

function readableError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>;
    return [record.code, record.message].filter((value): value is string => typeof value === 'string').join(' ');
  }
  return '';
}

export function mapRtmError(error: unknown): NormalizedRtmError {
  const detail = readableError(error).toUpperCase();
  if (detail.includes('TOKEN')) return { kind: 'token', message: 'Token 无效或已过期' };
  if (detail.includes('SAME_UID') || detail.includes('DUPLICATE_LOGIN')) {
    return { kind: 'duplicate-login', message: '该用户已在其他设备登录' };
  }
  if (detail.includes('NETWORK') || detail.includes('CONNECTION') || detail.includes('DISCONNECTED')) {
    return { kind: 'network', message: '网络连接已断开' };
  }
  if (detail.includes('PERMISSION') || detail.includes('NOT_AUTHORIZED') || detail.includes('FORBIDDEN')) {
    return { kind: 'permission', message: '当前 Token 没有执行该操作的权限' };
  }
  return { kind: 'operation', message: 'RTM 操作失败' };
}
