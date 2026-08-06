import { describe, expect, it } from 'vitest';
import { createInitialSnapshot, updateAnnouncement } from '../domain/transitions';
import type { VoiceRoomSnapshot } from '../domain/types';
import { RoomStateRepository } from './RoomStateRepository';
import type {
  ChannelSnapshot,
  RtmCredentials,
  RtmPort,
  RtmPortHandlers,
  SetMetadataOptions,
} from './ports/RtmPort';

class MemoryStoragePort implements RtmPort {
  operations: string[] = [];
  failSet = false;
  handlers?: RtmPortHandlers;
  channelSnapshot: ChannelSnapshot;

  constructor(snapshot: VoiceRoomSnapshot) {
    this.channelSnapshot = {
      revision: 10,
      values: { 'voice-room-state': JSON.stringify(snapshot) },
    };
  }

  registerEvents(handlers: RtmPortHandlers) { this.handlers = handlers; }
  async connect(_credentials: RtmCredentials) {}
  async disconnect() {}
  async subscribe(_channelId: string) {}
  async unsubscribe(_channelId: string) {}
  async publishChannel(_channelId: string, _message: string) {}
  async publishUser(_userId: string, _message: string) {}
  async getOnlineUsers(_channelId: string) { return []; }
  async getChannelMetadata(_channelId: string) {
    this.operations.push('storage:get');
    return this.channelSnapshot;
  }
  async setChannelMetadata(
    _channelId: string,
    _key: string,
    value: string,
    options?: SetMetadataOptions,
  ) {
    const snapshot = JSON.parse(value) as VoiceRoomSnapshot;
    this.operations.push(`storage:set:${snapshot.revision}:${options?.lockName ?? ''}`);
    if (this.failSet) throw new Error('storage failed');
    this.channelSnapshot = {
      revision: this.channelSnapshot.revision + 1,
      values: { 'voice-room-state': value },
    };
  }
  async acquireLock(_channelId: string, lockName: string) {
    this.operations.push(`lock:acquire:${lockName}`);
  }
  async releaseLock(_channelId: string, lockName: string) {
    this.operations.push(`lock:release:${lockName}`);
  }
}

describe('RoomStateRepository', () => {
  it('serializes one snapshot mutation under a named lock', async () => {
    const initial = createInitialSnapshot('host-1');
    const port = new MemoryStoragePort(initial);
    const repository = new RoomStateRepository(port, 'room-1', initial);

    const updated = await repository.mutate((snapshot) =>
      updateAnnouncement(snapshot, 'host-1', '欢迎参加周五派对'),
    );

    expect(updated).toMatchObject({ revision: 1, announcement: '欢迎参加周五派对' });
    expect(port.operations).toEqual([
      'lock:acquire:room-state',
      'storage:get',
      'storage:set:1:room-state',
      'lock:release:room-state',
    ]);
  });

  it('always releases the lock when Storage write fails', async () => {
    const initial = createInitialSnapshot('host-1');
    const port = new MemoryStoragePort(initial);
    port.failSet = true;
    const repository = new RoomStateRepository(port, 'room-1', initial);

    await expect(repository.mutate((snapshot) =>
      updateAnnouncement(snapshot, 'host-1', '不会提交'),
    )).rejects.toThrow('storage failed');
    expect(port.operations.at(-1)).toBe('lock:release:room-state');
  });

  it('falls back safely when Storage is missing or malformed', async () => {
    const initial = createInitialSnapshot('host-1');
    const port = new MemoryStoragePort(initial);
    port.channelSnapshot.values = { 'voice-room-state': '{bad-json' };
    const repository = new RoomStateRepository(port, 'room-1', initial);

    expect(await repository.read()).toEqual(initial);
    expect(repository.parseSnapshot(undefined)).toEqual(initial);
  });
});
