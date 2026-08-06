import { describe, expect, it } from 'vitest';
import {
  CONNECTION_SETTINGS_KEY,
  SettingsValidationError,
  loadConnectionSettings,
  normalizeConnectionSettings,
  saveConnectionSettings,
  type VoiceRoomConnectionSettings,
} from './connectionSettings';

const validSettings: VoiceRoomConnectionSettings = {
  appId: ' app-id ',
  roomId: ' room-1 ',
  host: {
    displayName: ' 房主 ', userId: ' host-1 ', rtmToken: ' host-rtm ', rtcToken: ' host-rtc ',
  },
  audience: {
    displayName: ' 听众 ', userId: ' audience-1 ', rtmToken: ' audience-rtm ', rtcToken: ' audience-rtc ',
  },
};

describe('connection settings', () => {
  it('requires shared and endpoint identity fields', () => {
    const entries: Array<[string, VoiceRoomConnectionSettings]> = [
      ['appId', { ...validSettings, appId: ' ' }],
      ['roomId', { ...validSettings, roomId: '' }],
      ['host.displayName', { ...validSettings, host: { ...validSettings.host, displayName: '' } }],
      ['host.userId', { ...validSettings, host: { ...validSettings.host, userId: '' } }],
      ['audience.displayName', { ...validSettings, audience: { ...validSettings.audience, displayName: '' } }],
      ['audience.userId', { ...validSettings, audience: { ...validSettings.audience, userId: '' } }],
    ];

    for (const [field, settings] of entries) {
      expect(() => normalizeConnectionSettings(settings)).toThrowError(
        expect.objectContaining<Partial<SettingsValidationError>>({ field }),
      );
    }
  });

  it('normalizes blank endpoint tokens to undefined', () => {
    const normalized = normalizeConnectionSettings({
      ...validSettings,
      host: { ...validSettings.host, rtmToken: ' ', rtcToken: '' },
      audience: { ...validSettings.audience, rtmToken: '', rtcToken: '  ' },
    });

    expect(normalized.host).toMatchObject({ rtmToken: undefined, rtcToken: undefined });
    expect(normalized.audience).toMatchObject({ rtmToken: undefined, rtcToken: undefined });
  });

  it('requires distinct host and audience User IDs', () => {
    const settings = {
      ...validSettings,
      audience: { ...validSettings.audience, userId: 'host-1' },
    };
    expect(() => normalizeConnectionSettings(settings)).toThrow('房主和听众必须使用不同的 User ID');
  });

  it('normalizes values and persists only in sessionStorage', () => {
    const normalized = saveConnectionSettings(validSettings);

    expect(normalized).toMatchObject({
      appId: 'app-id', roomId: 'room-1',
      host: { userId: 'host-1', rtmToken: 'host-rtm' },
      audience: { userId: 'audience-1', rtcToken: 'audience-rtc' },
    });
    expect(sessionStorage.getItem(CONNECTION_SETTINGS_KEY)).toBe(JSON.stringify(normalized));
    expect(localStorage.length).toBe(0);
    expect(loadConnectionSettings()).toEqual(normalized);
  });

  it('returns null for missing, malformed, or incomplete stored settings', () => {
    expect(loadConnectionSettings()).toBeNull();
    sessionStorage.setItem(CONNECTION_SETTINGS_KEY, '{bad-json');
    expect(loadConnectionSettings()).toBeNull();
    sessionStorage.setItem(CONNECTION_SETTINGS_KEY, JSON.stringify({ appId: 'only-app-id' }));
    expect(loadConnectionSettings()).toBeNull();
  });
});
