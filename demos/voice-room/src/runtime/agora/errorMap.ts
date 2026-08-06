function errorDetail(error: unknown): string {
  if (error instanceof Error) return `${error.name} ${error.message}`.toUpperCase();
  if (typeof error === 'string') return error.toUpperCase();
  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>;
    return [record.code, record.name, record.message]
      .filter((value) => typeof value === 'string' || typeof value === 'number')
      .join(' ')
      .toUpperCase();
  }
  return '';
}

export function mapRtmError(error: unknown): string {
  const detail = errorDetail(error);
  if (detail.includes('TOKEN_EXPIRED')) return 'RTM Token 已过期，请重新生成';
  if (detail.includes('INVALID_TOKEN') || detail.includes('TOKEN_INVALID')) {
    return 'RTM Token 无效，请重新生成';
  }
  if (detail.includes('SAME_UID') || detail.includes('DUPLICATE_LOGIN')) {
    return '该 RTM User ID 已在其他实例登录';
  }
  if (detail.includes('LOCK_NOT_ACQUIRED') || detail.includes('LOCK_CONFLICT')) {
    return '房间状态正在被其他客户端更新，请重试';
  }
  if (detail.includes('CONNECTION') || detail.includes('NETWORK') || detail.includes('DISCONNECTED')) {
    return 'RTM 网络连接失败，请检查网络后重试';
  }
  return 'RTM 操作失败，请稍后重试';
}

export function mapRtcError(error: unknown): string {
  const detail = errorDetail(error);
  if (detail.includes('INVALID_TOKEN') || detail.includes('TOKEN_EXPIRED') || detail.includes('DYNAMIC_USE_STATIC_KEY')) {
    return 'RTC Token 无效或已过期，请重新生成';
  }
  if (detail.includes('NOTALLOWEDERROR') || detail.includes('PERMISSION_DENIED') || detail.includes('PERMISSION DENIED')) {
    return '浏览器未授予麦克风权限';
  }
  if (detail.includes('CONNECTION') || detail.includes('NETWORK') || detail.includes('DISCONNECTED')) {
    return 'RTC 网络连接失败，请检查网络后重试';
  }
  return 'RTC 音频操作失败，请稍后重试';
}

export function rtmError(error: unknown): Error {
  return new Error(mapRtmError(error));
}

export function rtcError(error: unknown): Error {
  return new Error(mapRtcError(error));
}
