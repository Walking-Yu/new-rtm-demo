import type { VoiceRoomSnapshot } from '../domain/types';
import type { RtmPort } from './ports/RtmPort';

const SNAPSHOT_KEY = 'voice-room-state';
const MUTATION_LOCK = 'room-state';

function isSnapshot(value: unknown): value is VoiceRoomSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const snapshot = value as Partial<VoiceRoomSnapshot>;
  return (
    typeof snapshot.revision === 'number' &&
    typeof snapshot.hostUserId === 'string' &&
    typeof snapshot.announcement === 'string' &&
    typeof snapshot.seats === 'object' && snapshot.seats !== null &&
    Array.isArray(snapshot.queue) &&
    Array.isArray(snapshot.bannedUserIds) &&
    (snapshot.invitation === null || typeof snapshot.invitation === 'object')
  );
}

export class RoomStateRepository {
  constructor(
    private readonly port: RtmPort,
    private readonly channelId: string,
    private readonly fallback: VoiceRoomSnapshot,
  ) {}

  parseSnapshot(serialized: string | undefined): VoiceRoomSnapshot {
    if (!serialized) return this.fallback;
    try {
      const value: unknown = JSON.parse(serialized);
      return isSnapshot(value) ? value : this.fallback;
    } catch {
      return this.fallback;
    }
  }

  async read(): Promise<VoiceRoomSnapshot> {
    const result = await this.port.getChannelMetadata(this.channelId);
    return this.parseSnapshot(result.values[SNAPSHOT_KEY]);
  }

  async mutate(
    transition: (snapshot: VoiceRoomSnapshot) => VoiceRoomSnapshot,
  ): Promise<VoiceRoomSnapshot> {
    let acquired = false;
    try {
      await this.port.acquireLock(this.channelId, MUTATION_LOCK);
      acquired = true;
      const channelSnapshot = await this.port.getChannelMetadata(this.channelId);
      const current = this.parseSnapshot(channelSnapshot.values[SNAPSHOT_KEY]);
      const next = transition(current);
      await this.port.setChannelMetadata(
        this.channelId,
        SNAPSHOT_KEY,
        JSON.stringify(next),
        { majorRevision: channelSnapshot.revision, lockName: MUTATION_LOCK },
      );
      return next;
    } finally {
      if (acquired) await this.port.releaseLock(this.channelId, MUTATION_LOCK);
    }
  }
}
