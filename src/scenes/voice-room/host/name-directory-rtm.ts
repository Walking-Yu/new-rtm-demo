import type { RTMEvents } from 'agora-rtm';
import type { AppRtmSession } from '../app-rtm';
import type { DirectoryTransport, NameDirectoryEntry } from '../name-directory';
import type { TraceEntry, TraceInput } from '../../../shared/timeline/traceStore';

/** host directory operations share the page client, independently of room listeners. */
export class HostNameDirectoryRtm implements DirectoryTransport {
  private readonly traces: TraceEntry[] = [];
  private snapshot?: readonly TraceEntry[];
  private seq = 0;
  private readonly listeners = new Set<() => void>();
  constructor(private readonly session: AppRtmSession, readonly nameKey: string) {}
  isConnected(): boolean { return this.session.getCurrentLinkState() === 'connected'; }
  observe(onStorage: (event: RTMEvents.StorageEvent) => void, onConnection: (connected: boolean) => void): () => void {
    return this.session.observeDirectory(this.nameKey, event => {
      this.record({ at: event.timestamp || Date.now(), kind: 'event', name: 'storage', eventTag: event.eventType,
        summary: `名称目录 · revision=${event.data.majorRevision}` });
      onStorage(event);
    }, onConnection);
  }
  subscribeDirectory(): Promise<unknown> {
    return this.track('rtm.subscribe', '名称目录 · 仅订阅 Metadata', () => this.session.getDirectoryPort().subscribe(this.nameKey));
  }
  unsubscribeDirectory(): Promise<unknown> {
    return this.track('rtm.unsubscribe', '名称目录 · 停止观察', () => this.session.getDirectoryPort().unsubscribe(this.nameKey));
  }

  reserveName(entry: NameDirectoryEntry, revision: number): Promise<unknown> { return this.write(entry, revision, '登记房间名称'); }
  activateRoom(entry: NameDirectoryEntry, revision: number): Promise<unknown> { return this.write(entry, revision, '开放房间'); }
  endRoom(entry: NameDirectoryEntry, revision: number): Promise<unknown> { return this.write(entry, revision, '解散房间'); }
  banMember(entry: NameDirectoryEntry, revision: number): Promise<unknown> { return this.write(entry, revision, '同步封禁'); }
  private write(entry: NameDirectoryEntry, revision: number, summary: string): Promise<unknown> {
    return this.track('storage.setChannelMetadata', `名称目录 · ${summary}`, () =>
      this.session.getDirectoryPort().write(this.nameKey, JSON.stringify(entry), revision));
  }

  getTraces(): readonly TraceEntry[] { return this.snapshot ??= this.traces.map(entry => ({ ...entry })); }
  subscribeTraces(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  clearTraces(): void { this.traces.length = 0; this.notify(); }
  private record(input: TraceInput): void {
    this.traces.push({ ...input, seq: ++this.seq, uid: this.session.userId, role: 'host' });
    this.notify();
  }
  private notify(): void { this.snapshot = undefined; for (const listener of this.listeners) listener(); }
  private async track(name: string, summary: string, operation: () => Promise<unknown>): Promise<unknown> {
    const at = Date.now(), start = performance.now();
    try {
      const result = await operation();
      this.record({ at, kind: 'api', name, summary, durationMs: performance.now() - start });
      return result;
    } catch (error) {
      const candidate = error as { errorCode?: number; code?: number; message?: string };
      this.record({ at, kind: 'api', name, summary, durationMs: performance.now() - start,
        errorCode: candidate?.errorCode ?? candidate?.code, errorMessage: candidate?.message ?? '房间目录操作失败' });
      throw error;
    }
  }
}
