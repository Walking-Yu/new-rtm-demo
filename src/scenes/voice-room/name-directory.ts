import type { RTMEvents } from 'agora-rtm';
import type { TraceEntry } from '../../shared/timeline/traceStore';
import { normalizeRoomName, resolveRoomName } from './room-name';

export interface NameDirectoryEntry {
  schemaVersion: 1;
  canonicalName: string;
  roomName: string;
  roomId: string;
  hostUserId: string;
  status: 'creating' | 'active' | 'inactive';
  attemptId: string;
  createdAt: number;
  endedAt?: number;
  banUserIds: string[];
}

export interface NameDirectorySnapshot {
  majorRevision: number;
  entry?: NameDirectoryEntry;
}

export interface DirectoryTransport {
  readonly nameKey: string;
  isConnected(): boolean;
  observe(onStorage: (event: RTMEvents.StorageEvent) => void, onConnection: (connected: boolean) => void): () => void;
  subscribeDirectory(): Promise<unknown>;
  unsubscribeDirectory(): Promise<unknown>;
  getTraces(): readonly TraceEntry[];
  subscribeTraces(listener: () => void): () => void;
  clearTraces(): void;
}

export function parseNameDirectoryEntry(value: unknown): NameDirectoryEntry {
  if (!value || typeof value !== 'object') throw new Error('房间登记信息不完整');
  const entry = value as NameDirectoryEntry;
  if (entry.schemaVersion !== 1 || !['creating', 'active', 'inactive'].includes(entry.status) ||
      ![entry.canonicalName, entry.roomName, entry.roomId, entry.hostUserId, entry.attemptId].every(v => typeof v === 'string' && v.length > 0) ||
      !Number.isFinite(entry.createdAt) || (entry.endedAt !== undefined && !Number.isFinite(entry.endedAt)) ||
      !Array.isArray(entry.banUserIds) || !entry.banUserIds.every(v => typeof v === 'string' && v.length > 0) ||
      normalizeRoomName(entry.roomName).canonicalName !== entry.canonicalName) {
    throw new Error('房间登记格式不兼容，请联系房主重新创建');
  }
  return { ...entry, banUserIds: [...new Set(entry.banUserIds)] };
}

/** Business state for one name. Role transports retain their own RTM calls and traces. */
export class NameDirectory {
  private snapshot?: NameDirectorySnapshot;
  private error?: Error;
  private connected: boolean;
  private fresh = false;
  private closed = false;
  private unobserve?: () => void;
  private subscription?: Promise<unknown>;
  private closePromise?: Promise<void>;
  private revisionGeneration = 0;
  private highestReceivedRevision = -1;
  private readonly listeners = new Set<() => void>();
  unchangedSince = Date.now();

  constructor(readonly transport: DirectoryTransport, private readonly timeoutMs = 12000) {
    this.connected = transport.isConnected();
  }

  get current(): NameDirectorySnapshot | undefined { return this.fresh && !this.error ? this.snapshot : undefined; }
  get failure(): Error | undefined { return this.error; }
  get isClosed(): boolean { return this.closed; }

  observe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async open(): Promise<NameDirectorySnapshot> {
    this.unobserve = this.transport.observe(event => { void this.consume(event); }, connected => {
      this.connected = connected;
      if (!connected) { this.fresh = false; this.unchangedSince = Date.now(); }
      this.notify();
    });
    this.subscription = this.transport.subscribeDirectory();
    await this.subscription;
    return this.waitFor(snapshot => snapshot);
  }

  async refresh(): Promise<NameDirectorySnapshot> {
    if (this.closed) throw new Error('操作已取消');
    this.fresh = false;
    this.error = undefined;
    await this.transport.unsubscribeDirectory();
    if (this.closed) throw new Error('操作已取消');
    this.subscription = this.transport.subscribeDirectory();
    await this.subscription;
    return this.waitFor(snapshot => snapshot);
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.revisionGeneration++;
    this.unobserve?.();
    this.notify();
    this.closePromise = (async () => {
      try { await this.subscription; } catch { /* Unsubscribe also rolls back partial admission. */ }
      await this.transport.unsubscribeDirectory();
    })();
    return this.closePromise;
  }

  waitFor<T>(select: (snapshot: NameDirectorySnapshot) => T | undefined, timeoutMs = this.timeoutMs): Promise<T> {
    return new Promise((resolve, reject) => {
      let cleanup = () => {};
      const check = () => {
        if (this.closed || this.error) { cleanup(); reject(this.error ?? new Error('操作已取消')); return; }
        const result = this.current && select(this.current);
        if (result !== undefined) { cleanup(); resolve(result); }
      };
      const timer = setTimeout(() => { cleanup(); reject(new Error('暂时无法确认房间状态，请检查网络后重试')); }, timeoutMs);
      const unlisten = this.observe(check);
      cleanup = () => { clearTimeout(timer); unlisten(); };
      check();
    });
  }

  async confirmWrite(write: () => Promise<unknown>, expected: NameDirectoryEntry): Promise<NameDirectorySnapshot> {
    let failure: unknown;
    try { await write(); } catch (error) { failure = error; }
    const matches = (snapshot: NameDirectorySnapshot) => {
      const entry = snapshot.entry;
      return entry && entry.roomId === expected.roomId && entry.attemptId === expected.attemptId &&
        entry.status === expected.status && expected.banUserIds.every(id => entry.banUserIds.includes(id)) ? snapshot : undefined;
    };
    if (!failure) {
      try { return await this.waitFor(matches); } catch (error) { failure = error; }
    }
    // An ambiguous write is resolved from a fresh cloud snapshot, never from local cache.
    const latest = await this.refresh();
    const confirmed = matches(latest);
    if (confirmed) return confirmed;
    const code = (failure as { errorCode?: number })?.errorCode;
    throw new Error(code === -12014 ? '房间状态已变化，请重试' : '操作结果尚未确认，请重试确认房间状态');
  }

  private async consume(event: RTMEvents.StorageEvent): Promise<void> {
    if (event.data.majorRevision < this.highestReceivedRevision) return;
    this.highestReceivedRevision = event.data.majorRevision;
    const generation = ++this.revisionGeneration;
    try {
      const data = event.data;
      if (!Number.isSafeInteger(data.majorRevision) || data.majorRevision < 0) throw new Error('房间登记版本无效');
      let entry: NameDirectoryEntry | undefined;
      if (Object.keys(data.metadata).length > 0) {
        if (!data.metadata.entry) throw new Error('房间登记信息不完整');
        entry = parseNameDirectoryEntry(JSON.parse(data.metadata.entry.value));
        if ((await resolveRoomName(entry.roomName)).nameKey !== this.transport.nameKey) throw new Error('房间名称与登记信息不匹配');
      }
      if (this.closed || generation !== this.revisionGeneration) return;
      if (this.snapshot && data.majorRevision < this.snapshot.majorRevision) return;
      if (!this.fresh || data.majorRevision !== this.snapshot?.majorRevision) this.unchangedSince = Date.now();
      this.snapshot = { majorRevision: data.majorRevision, entry };
      this.error = undefined;
      this.fresh = this.connected;
      this.notify();
    } catch (error) {
      if (this.closed || generation !== this.revisionGeneration) return;
      this.error = error instanceof Error ? error : new Error('房间登记信息无法读取');
      this.fresh = false;
      this.notify();
    }
  }

  private notify(): void { for (const listener of this.listeners) listener(); }
}
