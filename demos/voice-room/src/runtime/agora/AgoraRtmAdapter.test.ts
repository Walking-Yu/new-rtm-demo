import { describe, expect, it, vi } from 'vitest';
import { AgoraRtmAdapter } from './AgoraRtmAdapter';

vi.mock('agora-rtm', () => ({
  default: { RTM: class TestRtm {} },
}));

describe('AgoraRtmAdapter', () => {
  it('passes an undefined token to RTM login when token authentication is disabled', async () => {
    const login = vi.fn(async () => undefined);
    const client = {
      addEventListener: vi.fn(),
      login,
    };
    const createClient = vi.fn(() => client as never);
    const adapter = new AgoraRtmAdapter(createClient);

    await adapter.connect({ appId: 'app-id', userId: 'host-1' });

    expect(createClient).toHaveBeenCalledWith('app-id', 'host-1', {
      logLevel: 'debug',
      useStringUserId: true,
    });
    expect(login).toHaveBeenCalledWith({ token: undefined });
  });

  it('logs out after login rejects and preserves the original login error', async () => {
    const loginError = Object.assign(new Error('TOKEN_INVALID'), { code: 'TOKEN_INVALID' });
    const logout = vi.fn().mockRejectedValue(new Error('logout cleanup failed'));
    const client = {
      addEventListener: vi.fn(),
      login: vi.fn().mockRejectedValue(loginError),
      logout,
    };
    const adapter = new AgoraRtmAdapter(() => client as never);

    await expect(adapter.connect({ appId: 'app-id', userId: 'host-1' }))
      .rejects.toMatchObject({ message: 'RTM Token 无效，请重新生成' });

    expect(logout).toHaveBeenCalledOnce();
    await expect(adapter.disconnect()).resolves.toBeUndefined();
  });

  it('uses linkState as the single connection source and maps automatic reconnects', async () => {
    const listeners = new Map<string, (event: never) => void>();
    const client = {
      addEventListener: vi.fn((name: string, listener: (event: never) => void) => {
        listeners.set(name, listener);
      }),
      login: vi.fn(async () => undefined),
    };
    const connection = vi.fn();
    const adapter = new AgoraRtmAdapter(() => client as never);
    adapter.registerEvents({
      connection, message: vi.fn(), presence: vi.fn(), storage: vi.fn(), tokenExpiring: vi.fn(),
    });

    await adapter.connect({ appId: 'app-id', userId: 'host-1' });
    listeners.get('linkState')?.({
      currentState: 'DISCONNECTED', previousState: 'CONNECTED', operation: 'HEARTBEAT_TIMEOUT',
      reasonCode: 'KEEP_ALIVE_TIMEOUT', reason: 'Keep alive timeout',
    } as never);
    listeners.get('linkState')?.({
      currentState: 'CONNECTING', previousState: 'DISCONNECTED', operation: 'AUTO_RECONNECT',
      reasonCode: 'AUTO_RECONNECT', reason: 'Reconnecting',
    } as never);
    listeners.get('linkState')?.({
      currentState: 'CONNECTED', previousState: 'CONNECTING', operation: 'AUTO_RECONNECT',
      reasonCode: 'RECONNECT_SUCCESS', reason: 'Reconnect success',
    } as never);

    expect(client.addEventListener).not.toHaveBeenCalledWith('status', expect.any(Function));
    expect(connection.mock.calls.map(([state]) => state)).toEqual([
      'reconnecting', 'reconnecting', 'connected',
    ]);
  });

  it('uses the token event without duplicating or misclassifying permission changes', async () => {
    const listeners = new Map<string, (event: never) => void>();
    const client = {
      addEventListener: vi.fn((name: string, listener: (event: never) => void) => {
        listeners.set(name, listener);
      }),
      login: vi.fn(async () => undefined),
    };
    const tokenExpiring = vi.fn();
    const adapter = new AgoraRtmAdapter(() => client as never);
    adapter.registerEvents({
      connection: vi.fn(), message: vi.fn(), presence: vi.fn(), storage: vi.fn(), tokenExpiring,
    });

    await adapter.connect({ appId: 'app-id', userId: 'host-1' });
    listeners.get('token')?.({ eventType: 'READ_PERMISSION_REVOKED' } as never);
    listeners.get('token')?.({ eventType: 'WILL_EXPIRE' } as never);

    expect(client.addEventListener).not.toHaveBeenCalledWith(
      'tokenPrivilegeWillExpire',
      expect.any(Function),
    );
    expect(tokenExpiring).toHaveBeenCalledTimes(1);
  });

  it('loads every Presence page without requesting unused temporary state', async () => {
    const getOnlineUsers = vi.fn(async (
      _channelId: string,
      _channelType: string,
      options: { includedUserId?: boolean; includedState?: boolean; page?: string },
    ) => options.page === 'page-2'
      ? { occupants: [{ userId: 'audience-1' }], nextPage: '' }
      : { occupants: [{ userId: 'host-1' }], nextPage: 'page-2' });
    const client = {
      addEventListener: vi.fn(),
      login: vi.fn(async () => undefined),
      presence: { getOnlineUsers },
    };
    const adapter = new AgoraRtmAdapter(() => client as never);
    await adapter.connect({ appId: 'app-id', userId: 'host-1' });

    await expect(adapter.getOnlineUsers('room-1')).resolves.toEqual(['host-1', 'audience-1']);
    expect(getOnlineUsers).toHaveBeenNthCalledWith(1, 'room-1', 'MESSAGE', {
      includedUserId: true,
      includedState: false,
    });
    expect(getOnlineUsers).toHaveBeenNthCalledWith(2, 'room-1', 'MESSAGE', {
      includedUserId: true,
      includedState: false,
      page: 'page-2',
    });
  });

  it('creates a missing distributed lock before retrying acquisition', async () => {
    const acquireLock = vi.fn()
      .mockRejectedValueOnce({ errorCode: -14008, reason: 'Lock not exist' })
      .mockResolvedValueOnce(undefined);
    const setLock = vi.fn(async () => undefined);
    const client = {
      addEventListener: vi.fn(),
      login: vi.fn(async () => undefined),
      lock: { acquireLock, setLock },
    };
    const adapter = new AgoraRtmAdapter(() => client as never);
    await adapter.connect({ appId: 'app-id', userId: 'host-1' });

    await expect(adapter.acquireLock('room-1', 'room-state')).resolves.toBeUndefined();
    expect(setLock).toHaveBeenCalledWith('room-1', 'MESSAGE', 'room-state');
    expect(acquireLock).toHaveBeenCalledTimes(2);
  });

  it('continues acquiring when another client creates the missing lock first', async () => {
    const acquireLock = vi.fn()
      .mockRejectedValueOnce({ errorCode: -14008, reason: 'Lock not exist' })
      .mockResolvedValueOnce(undefined);
    const setLock = vi.fn()
      .mockRejectedValueOnce({ errorCode: -14004, reason: 'Lock already exist' });
    const client = {
      addEventListener: vi.fn(),
      login: vi.fn(async () => undefined),
      lock: { acquireLock, setLock },
    };
    const adapter = new AgoraRtmAdapter(() => client as never);
    await adapter.connect({ appId: 'app-id', userId: 'audience-1' });

    await expect(adapter.acquireLock('room-1', 'room-state')).resolves.toBeUndefined();
    expect(setLock).toHaveBeenCalledOnce();
    expect(acquireLock).toHaveBeenCalledTimes(2);
  });

  it('registers SDK events before login and maps Message Channel capabilities', async () => {
    const operations: string[] = [];
    const listeners = new Map<string, (event: never) => void>();
    const client = {
      addEventListener: (name: string, listener: (event: never) => void) => {
        operations.push(`listen:${name}`);
        listeners.set(name, listener);
      },
      login: vi.fn(async ({ token }: { token: string }) => { operations.push(`login:${token}`); }),
      logout: vi.fn(async () => undefined),
      subscribe: vi.fn(async () => undefined),
      unsubscribe: vi.fn(async () => undefined),
      publish: vi.fn(async () => undefined),
      presence: {
        getOnlineUsers: vi.fn(async () => ({ occupants: [{ userId: 'host-1' }], nextPage: '' })),
      },
      storage: {
        getChannelMetadata: vi.fn(async () => ({
          majorRevision: 3,
          metadata: { state: { value: '{"revision":3}' } },
        })),
        setChannelMetadata: vi.fn(async () => undefined),
      },
      lock: {
        acquireLock: vi.fn(async () => undefined),
        releaseLock: vi.fn(async () => undefined),
      },
    };
    const adapter = new AgoraRtmAdapter(() => client as never);
    const message = vi.fn();
    adapter.registerEvents({
      connection: vi.fn(), message, presence: vi.fn(), storage: vi.fn(), tokenExpiring: vi.fn(),
    });

    await adapter.connect({ appId: 'app-id', userId: 'host-1', token: 'rtm-token' });
    await adapter.subscribe('room-1');
    await adapter.publishChannel('room-1', 'channel-message');
    await adapter.publishUser('audience-1', 'user-message');
    expect(await adapter.getOnlineUsers('room-1')).toEqual(['host-1']);
    expect(await adapter.getChannelMetadata('room-1')).toEqual({
      revision: 3, values: { state: '{"revision":3}' },
    });
    await adapter.setChannelMetadata('room-1', 'state', '{}', { majorRevision: 3, lockName: 'room-state' });
    await adapter.acquireLock('room-1', 'room-state');
    await adapter.releaseLock('room-1', 'room-state');

    expect(operations.indexOf('listen:message')).toBeLessThan(operations.indexOf('login:rtm-token'));
    expect(client.subscribe).toHaveBeenCalledWith('room-1', {
      withMessage: true, withPresence: true, withMetadata: true, withLock: true,
    });
    expect(client.publish).toHaveBeenCalledWith('room-1', 'channel-message');
    expect(client.publish).toHaveBeenCalledWith('audience-1', 'user-message', { channelType: 'USER' });
    expect(client.storage.setChannelMetadata).toHaveBeenCalledWith(
      'room-1', 'MESSAGE', [{ key: 'state', value: '{}', revision: -1 }],
      { majorRevision: 3, lockName: 'room-state', addTimeStamp: true, addUserId: true },
    );

    listeners.get('message')?.({
      channelType: 'MESSAGE', channelName: 'room-1', message: 'hello', publisher: 'audience-1', timestamp: 10,
    } as never);
    expect(message).toHaveBeenCalledWith(expect.objectContaining({ message: 'hello', publisher: 'audience-1' }));
  });
});
