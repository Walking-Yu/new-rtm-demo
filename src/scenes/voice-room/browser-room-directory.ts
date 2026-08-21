export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  keys?(): readonly string[];
}

export interface BrowserRoomDirectoryEntry {
  roomId: string;
  roomName: string;
  createdAt: number;
  updatedAt: number;
  hostUserId?: string;
  banUserIds: string[];
  status: "active" | "inactive";
}

type BrowserRoomDirectoryInput = Omit<BrowserRoomDirectoryEntry, 'createdAt' | 'updatedAt' | 'banUserIds' | 'status'> &
  Partial<Pick<BrowserRoomDirectoryEntry, 'createdAt' | 'updatedAt' | 'banUserIds' | 'status'>>;

export interface BrowserRoomDirectory {
  upsert(entry: BrowserRoomDirectoryInput): void;
  list(): BrowserRoomDirectoryEntry[];
  get(roomId: string): BrowserRoomDirectoryEntry | undefined;
  listForUser(userId: string): BrowserRoomDirectoryEntry[];
  merge(storageKey: string, entry: BrowserRoomDirectoryEntry): BrowserRoomDirectoryEntry;
}

const DIRECTORY_KEY_PATTERN = /^record-channel-list-\d{8}$/;

export function isDirectoryStorageKey(key: string): boolean {
  return DIRECTORY_KEY_PATTERN.test(key);
}

function mergeEntry(current: BrowserRoomDirectoryEntry | undefined, input: BrowserRoomDirectoryInput, timestamp: number): BrowserRoomDirectoryEntry {
  const inputUpdatedAt = input.updatedAt ?? timestamp;
  const latest = !current || inputUpdatedAt >= current.updatedAt ? input : current;
  return {
    roomId: input.roomId,
    roomName: latest.roomName,
    // 增量更新未提供 Host UID 时必须保留已有值，不能用 undefined 覆盖。
    hostUserId: latest.hostUserId ?? current?.hostUserId ?? input.hostUserId,
    createdAt: input.createdAt ?? current?.createdAt ?? timestamp,
    updatedAt: Math.max(current?.updatedAt ?? 0, inputUpdatedAt),
    banUserIds: [...new Set([...(current?.banUserIds ?? []), ...(input.banUserIds ?? [])])],
    status: current?.status === 'inactive' || input.status === 'inactive' ? 'inactive' : 'active',
  };
}

export function directoryStorageKey(date: Date): string {
  const [year, month, day] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0'));
  return `record-channel-list-${year}${month}${day}`;
}

function readEntries(storage: StorageLike, key: string): BrowserRoomDirectoryEntry[] {
  try {
    const value: unknown = JSON.parse(storage.getItem(key) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is BrowserRoomDirectoryEntry =>
      typeof item === 'object' && item !== null &&
      typeof (item as BrowserRoomDirectoryEntry).roomId === 'string' &&
      (typeof (item as BrowserRoomDirectoryEntry).roomName === 'string' || typeof (item as { title?: unknown }).title === 'string') &&
      typeof (item as BrowserRoomDirectoryEntry).createdAt === 'number',
    ).map((item) => ({
      roomId: item.roomId,
      roomName: (item as BrowserRoomDirectoryEntry).roomName ?? (item as unknown as { title: string }).title,
      createdAt: item.createdAt,
      updatedAt: typeof (item as BrowserRoomDirectoryEntry).updatedAt === 'number' ? (item as BrowserRoomDirectoryEntry).updatedAt : item.createdAt,
      hostUserId: typeof (item as BrowserRoomDirectoryEntry).hostUserId === 'string' ? (item as BrowserRoomDirectoryEntry).hostUserId : undefined,
      banUserIds: Array.isArray((item as BrowserRoomDirectoryEntry).banUserIds) ? (item as BrowserRoomDirectoryEntry).banUserIds.filter((id): id is string => typeof id === 'string') : [],
      status: (item as BrowserRoomDirectoryEntry).status === 'inactive' ? 'inactive' : 'active',
    }));
  } catch {
    return [];
  }
}

export function createBrowserRoomDirectory(
  storage: StorageLike,
  now: () => Date = () => new Date(),
  retentionDays = 7,
): BrowserRoomDirectory {
  const knownKeys = () =>
    storage.keys?.().filter(isDirectoryStorageKey) ?? [];

  const cleanup = () => {
    const threshold = now().getTime() - retentionDays * 24 * 60 * 60 * 1000;
    const discovered = knownKeys();
    return discovered.filter((key) => {
      const entries = readEntries(storage, key);
      const keep = entries.some((entry) => entry.createdAt >= threshold);
      if (!keep) storage.removeItem(key);
      return keep;
    });
  };

  const allEntries = () => cleanup()
    .flatMap((key) => readEntries(storage, key))
    .sort((left, right) => right.createdAt - left.createdAt);

  const writeMerged = (
    key: string,
    input: BrowserRoomDirectoryEntry,
  ): BrowserRoomDirectoryEntry => {
    if (!isDirectoryStorageKey(key)) throw new Error('非法的房间目录 key');
    const entries = readEntries(storage, key);
    const current = allEntries().find((entry) => entry.roomId === input.roomId);
    const next = mergeEntry(current, input, now().getTime());
    storage.setItem(key, JSON.stringify(
      [...entries.filter((entry) => entry.roomId !== input.roomId), next]
        .sort((left, right) => right.createdAt - left.createdAt),
    ));
    return next;
  };

  return {
    upsert(input) {
      const timestamp = now().getTime();
      const existingKey = knownKeys().find((key) =>
        readEntries(storage, key).some((entry) => entry.roomId === input.roomId),
      );
      const key = existingKey ?? directoryStorageKey(now());
      const entries = readEntries(storage, key);
      const current = entries.find((entry) => entry.roomId === input.roomId);
      const next = mergeEntry(current, input, timestamp);
      storage.setItem(key, JSON.stringify(
        [...entries.filter((entry) => entry.roomId !== input.roomId), next]
          .sort((left, right) => right.createdAt - left.createdAt),
      ));
      cleanup();
    },
    list() {
      return allEntries();
    },
    get(roomId) {
      return allEntries().find((entry) => entry.roomId === roomId);
    },
    listForUser(userId) {
      return allEntries().filter((entry) => entry.status === 'active' && !entry.banUserIds.includes(userId));
    },
    merge(storageKey, entry) {
      const merged = writeMerged(storageKey, entry);
      cleanup();
      return merged;
    },
  };
}
