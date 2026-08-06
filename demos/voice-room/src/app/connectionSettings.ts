export const CONNECTION_SETTINGS_KEY = 'agora.voice-room.connection.v1';

export interface EndpointConnectionSettings {
  displayName: string;
  userId: string;
  rtmToken?: string;
  rtcToken?: string;
}

export interface VoiceRoomConnectionSettings {
  appId: string;
  roomId: string;
  host: EndpointConnectionSettings;
  audience: EndpointConnectionSettings;
}

export const emptyConnectionSettings: VoiceRoomConnectionSettings = {
  appId: '',
  roomId: 'voice-room-001',
  host: { displayName: '房主', userId: 'host-001', rtmToken: '', rtcToken: '' },
  audience: { displayName: '听众', userId: 'audience-001', rtmToken: '', rtcToken: '' },
};

export class SettingsValidationError extends Error {
  constructor(public readonly field: string, message: string) {
    super(message);
    this.name = 'SettingsValidationError';
  }
}

function required(field: string, label: string, value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new SettingsValidationError(field, `请填写${label}`);
  }
  return value.trim();
}

function optionalToken(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.trim() || undefined;
}

function normalizeEndpoint(
  prefix: 'host' | 'audience',
  label: '房主' | '听众',
  endpoint: EndpointConnectionSettings,
): EndpointConnectionSettings {
  return {
    displayName: required(`${prefix}.displayName`, `${label}显示名`, endpoint?.displayName),
    userId: required(`${prefix}.userId`, `${label} User ID`, endpoint?.userId),
    rtmToken: optionalToken(endpoint?.rtmToken),
    rtcToken: optionalToken(endpoint?.rtcToken),
  };
}

export function normalizeConnectionSettings(
  settings: VoiceRoomConnectionSettings,
): VoiceRoomConnectionSettings {
  const normalized = {
    appId: required('appId', ' App ID', settings?.appId),
    roomId: required('roomId', '房间 ID', settings?.roomId),
    host: normalizeEndpoint('host', '房主', settings?.host),
    audience: normalizeEndpoint('audience', '听众', settings?.audience),
  };
  if (normalized.host.userId === normalized.audience.userId) {
    throw new SettingsValidationError('audience.userId', '房主和听众必须使用不同的 User ID');
  }
  return normalized;
}

export function saveConnectionSettings(
  settings: VoiceRoomConnectionSettings,
): VoiceRoomConnectionSettings {
  const normalized = normalizeConnectionSettings(settings);
  sessionStorage.setItem(CONNECTION_SETTINGS_KEY, JSON.stringify(normalized));
  return normalized;
}

export function loadConnectionSettings(): VoiceRoomConnectionSettings | null {
  const serialized = sessionStorage.getItem(CONNECTION_SETTINGS_KEY);
  if (!serialized) return null;
  try {
    return normalizeConnectionSettings(JSON.parse(serialized) as VoiceRoomConnectionSettings);
  } catch {
    return null;
  }
}
