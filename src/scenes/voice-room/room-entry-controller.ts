import { resolveRoomName, type RoomName } from './room-name';
import { NameDirectory, type NameDirectoryEntry, type DirectoryTransport } from './name-directory';
import { HostNameDirectoryRtm } from './host/name-directory-rtm';
import { AudienceNameDirectoryRtm } from './audience/name-directory-rtm';
import type { RtcHelper } from "../../shared/rtc";
import {
  type BrowserRoomDirectory,
  type BrowserRoomDirectoryEntry,
  directoryStorageKey,
} from "./browser-room-directory";
import { resolveEntryNickname } from "./nickname";
import {
  SingleRoomClient,
  type SingleRoomClientOptions,
} from "./event-driven-single-room-client";
import type { AppRtmSession } from "./app-rtm";
import {
  payloadDirectoryEntry,
  isNamedVoiceRoomPayload,
  type NamedVoiceRoomUrlPayload,
  withVoiceRoomPageIdentity,
  type VoiceRoomUrlPayload,
} from "./voice-room-url";

export type RoomEntryPhase = "idle" | "admitting" | "subscribing" | "room" | "ended";

export interface RoomEntryView {
  phase: RoomEntryPhase;
  client?: SingleRoomClient;
  entry?: BrowserRoomDirectoryEntry;
  payload?: VoiceRoomUrlPayload;
  error?: string;
  statusText?: string;
  directoryConnected?: boolean;
  managing?: boolean;
}

export interface RoomEntryControllerOptions {
  appId: string;
  session: AppRtmSession;
  directory: BrowserRoomDirectory;
  createClient?: (options: SingleRoomClientOptions) => SingleRoomClient;
  createRtc?: () => RtcHelper;
  randomRoomId?: () => string;
  now?: () => number;
  replaceUrl?: (payload: VoiceRoomUrlPayload) => void;
  onDirectoryTransport?: (transport: DirectoryTransport) => void;
  directoryTimeoutMs?: number;
  creationGraceMs?: number;
}

function randomRoomId(): string {
  const suffix = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 12);
  return `voice-room-${suffix}`;
}

export class RoomEntryController {
  private readonly createClient: (options: SingleRoomClientOptions) => SingleRoomClient;
  private readonly now: () => number;
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private currentClient: SingleRoomClient | undefined;
  private view: RoomEntryView = { phase: "idle" };
  private currentDirectory?: NameDirectory;
  private unwatchDirectory?: () => void;
  private busy = false;
  private ownEnding = false;
  private pendingOperation?: Promise<void>;
  private leavePromise?: Promise<void>;

  constructor(private readonly options: RoomEntryControllerOptions) {
    this.createClient = options.createClient ?? ((clientOptions) => new SingleRoomClient(clientOptions));
    this.now = options.now ?? (() => Date.now());
  }

  getView(): RoomEntryView { return this.view; }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  createHostRoom(input: { roomName: string; nickname?: string }): Promise<void> {
    return this.runNamed(async generation => {
      const nickname = resolveEntryNickname(input.nickname, 'host', this.options.session.userId);
      const name = await resolveRoomName(input.roomName);
      this.checkGeneration(generation);
      const directory = await this.openDirectory('host', name.nameKey, generation);
      await this.createNamedHost(name, directory, generation, nickname);
    });
  }

  joinAudienceByName(roomName: string, inputNickname?: string): Promise<void> {
    return this.runNamed(async generation => {
      const nickname = resolveEntryNickname(inputNickname, 'audience', this.options.session.userId);
      const name = await resolveRoomName(roomName);
      this.checkGeneration(generation);
      const directory = await this.openDirectory('audience', name.nameKey, generation);
      await this.admitNamed('audience', directory, generation, nickname);
    });
  }

  private runNamed(action: (generation: number) => Promise<void>): Promise<void> {
    if (this.busy || this.currentClient || this.leavePromise) return Promise.reject(new Error('已有房间操作进行中，请先完成或取消'));
    this.busy = true;
    const generation = ++this.generation;
    this.setView({ phase: 'admitting', statusText: '正在查找房间…' });
    const operation = (async () => {
      try { await action(generation); }
      catch (error) {
        if (this.generation === generation) {
          const message = error instanceof Error ? error.message : '暂时无法确认房间状态，请重试';
          this.unwatchDirectory?.();
          this.unwatchDirectory = undefined;
          const client = this.currentClient;
          this.currentClient = undefined;
          try { await client?.leaveRoom(); } catch { /* Preserve admission failure. */ }
          try { await this.currentDirectory?.close(); } catch { /* Preserve admission failure. */ }
          this.currentDirectory = undefined;
          this.setView({ phase: 'idle', error: message });
          throw error;
        }
      } finally { this.busy = false; this.pendingOperation = undefined; }
    })();
    this.pendingOperation = operation;
    return operation;
  }

  private async openDirectory(role: 'host' | 'audience', nameKey: string, generation: number): Promise<NameDirectory> {
    this.checkGeneration(generation);
    const transport = role === 'host'
      ? new HostNameDirectoryRtm(this.options.session, nameKey)
      : new AudienceNameDirectoryRtm(this.options.session, nameKey);
    const directory = new NameDirectory(transport, this.options.directoryTimeoutMs);
    this.currentDirectory = directory;
    this.options.onDirectoryTransport?.(transport);
    await directory.open();
    this.checkGeneration(generation);
    return directory;
  }

  private async createNamedHost(name: RoomName, directory: NameDirectory, generation: number, nickname: string): Promise<void> {
    let snapshot = directory.current!;
    let existing = snapshot.entry;
    let candidate = this.readAttempt(name.nameKey);
    if (existing?.status === 'active') {
      if (candidate?.roomId === existing.roomId && candidate.attemptId === existing.attemptId && existing.hostUserId === this.options.session.userId) {
        await this.admitNamed('host', directory, generation, nickname, this.namedPayload('host', name.nameKey, existing.roomId, nickname));
        return;
      }
      throw new Error('该名称已被使用，可在右侧输入名称以听众身份加入');
    }
    if (existing?.status === 'creating' && !(candidate?.attemptId === existing.attemptId && existing.hostUserId === this.options.session.userId)) {
      this.setView({ phase: 'admitting', statusText: '房间正在准备，正在等待创建结果…' });
      const observedAttempt = existing.attemptId;
      const grace = this.options.creationGraceMs ?? 60000;
      // Takeover needs a continuously observed unchanged record, never another device's clock.
      while (directory.current?.entry?.attemptId === observedAttempt && directory.current.entry.status === 'creating') {
        const remaining = Math.max(0, grace - (Date.now() - directory.unchangedSince));
        if (!remaining) break;
        await new Promise<void>(resolve => {
          let off = () => {};
          const timer = setTimeout(() => { off(); resolve(); }, remaining);
          off = directory.observe(() => { clearTimeout(timer); off(); resolve(); });
        });
        this.checkGeneration(generation);
        if (!directory.current) await directory.waitFor(value => value);
      }
      snapshot = await directory.refresh();
      this.checkGeneration(generation);
      existing = snapshot.entry;
      if (existing?.status === 'active') throw new Error('该名称已被使用，可在右侧输入名称以听众身份加入');
      if (existing?.status === 'creating' && existing.attemptId !== observedAttempt) throw new Error('房间仍在准备，请稍后重试');
      candidate = undefined;
    }
    if (!candidate || existing?.status === 'inactive') {
      candidate = { schemaVersion: 1, roomName: name.roomName, canonicalName: name.canonicalName, roomId: (this.options.randomRoomId ?? randomRoomId)(),
        hostUserId: this.options.session.userId, status: 'creating', attemptId: crypto.randomUUID(),
        createdAt: this.now(), banUserIds: [] };
    }
    const attempt = candidate;
    this.saveAttempt(name.nameKey, attempt);
    this.options.replaceUrl?.(this.namedPayload('host', name.nameKey, attempt.roomId, nickname));
    const host = directory.transport as HostNameDirectoryRtm;
    if (!existing || existing.attemptId !== attempt.attemptId || existing.status !== 'creating') {
      this.setView({ phase: 'admitting', statusText: '正在登记房间名称…' });
      await directory.confirmWrite(() => host.reserveName(attempt, snapshot.majorRevision), attempt);
      this.checkGeneration(generation);
    }
    const entry = this.namedEntry(name.nameKey, attempt);
    const payload = this.namedPayload('host', name.nameKey, attempt.roomId, nickname);
    const client = this.makeClient('host', entry, nickname);
    this.currentClient = client;
    this.watchNamed(directory, entry, client, true);
    this.setView({ phase: 'subscribing', client, entry, payload, statusText: '正在准备房间…' });
    await client.subscribeRoom();
    this.checkGeneration(generation);
    await client.waitUntilReady(this.options.directoryTimeoutMs);
    this.checkGeneration(generation);
    const latest = await directory.waitFor(value => value);
    if (latest.entry?.attemptId !== attempt.attemptId || latest.entry.roomId !== attempt.roomId || latest.entry.hostUserId !== this.options.session.userId || latest.entry.status !== 'creating') {
      throw new Error('本次创建已失效，请重新创建');
    }
    const active = { ...attempt, status: 'active' as const };
    await directory.confirmWrite(() => host.activateRoom(active, latest.majorRevision), active);
    this.checkGeneration(generation);
    this.finishNamed(client, this.namedEntry(name.nameKey, active), payload);
  }

  private async joinNamedPayload(payload: NamedVoiceRoomUrlPayload): Promise<void> {
    return this.runNamed(async generation => {
      const nickname = resolveEntryNickname(payload.nickname, payload.role, this.options.session.userId);
      const source = { ...payload, nickname };
      const directory = await this.openDirectory(payload.role, payload.nameKey, generation);
      const record = directory.current?.entry;
      if (payload.role === 'host' && (!record || record.status === 'creating')) {
        const attempt = this.readAttempt(payload.nameKey) ?? (record?.roomId === payload.roomId && record.hostUserId === this.options.session.userId ? record : undefined);
        if (attempt) this.saveAttempt(payload.nameKey, attempt);
        if (attempt?.roomId === payload.roomId && (!record || record.roomId === payload.roomId)) {
          await this.createNamedHost(await resolveRoomName(attempt.roomName), directory, generation, nickname);
          return;
        }
      }
      await this.admitNamed(payload.role, directory, generation, nickname, source);
    });
  }

  private async admitNamed(role: 'host' | 'audience', directory: NameDirectory, generation: number, nickname: string, source?: NamedVoiceRoomUrlPayload): Promise<void> {
    const snapshot = await directory.waitFor(value => value);
    const record = snapshot.entry;
    this.checkGeneration(generation);
    if (!record) throw new Error('未找到该房间，请检查名称');
    if (source && record.roomId !== source.roomId) throw new Error('原房间已结束，此邀请不能加入同名的新房间');
    if (record.status === 'inactive') throw new Error('房间已解散');
    if (record.status === 'creating') throw new Error('房间正在准备，请稍后加入');
    if (record.banUserIds.includes(this.options.session.userId)) throw new Error('你已被该房间封禁');
    if (role === 'host' && record.hostUserId !== this.options.session.userId) throw new Error('房主身份与房间登记不匹配');
    const entry = this.namedEntry(directory.transport.nameKey, record);
    const payload = source ?? this.namedPayload(role, directory.transport.nameKey, record.roomId, nickname);
    const client = this.makeClient(role, entry, nickname);
    this.currentClient = client;
    this.watchNamed(directory, entry, client, false);
    this.setView({ phase: 'subscribing', client, entry, payload, statusText: '正在加入房间…' });
    await client.subscribeRoom();
    this.checkGeneration(generation);
    await client.waitUntilReady(this.options.directoryTimeoutMs);
    this.checkGeneration(generation);
    const final = await directory.waitFor(value => value);
    if (final.entry?.roomId !== record.roomId || final.entry.status !== 'active') throw new Error('房间已结束');
    if (final.entry.banUserIds.includes(this.options.session.userId)) throw new Error('你已被该房间封禁');
    this.finishNamed(client, entry, role === 'audience' ? withVoiceRoomPageIdentity(payload, this.options.session.userId, nickname) : payload);
  }

  private finishNamed(client: SingleRoomClient, entry: BrowserRoomDirectoryEntry, payload: VoiceRoomUrlPayload): void {
    this.options.replaceUrl?.(payload);
    this.setView({ phase: 'room', client, entry, payload, directoryConnected: true });
    client.startRoomRuntime();
  }

  private watchNamed(directory: NameDirectory, entry: BrowserRoomDirectoryEntry, client: SingleRoomClient, creating: boolean): void {
    this.unwatchDirectory?.();
    const check = () => {
      if (this.currentClient !== client || directory.isClosed) return;
      const record = directory.current?.entry;
      const invalid = directory.failure ? directory.failure.message : record && (
        record.roomId !== entry.roomId ? '原房间已结束' :
        record.status === 'inactive' && !this.ownEnding ? '房间已解散' :
        record.banUserIds.includes(this.options.session.userId) ? '你已被该房间封禁' :
        record.status === 'creating' && !creating ? '房间状态已变化' : undefined);
      if (invalid) {
        void client.leaveRoom(invalid).catch(() => {});
      } else if (this.view.client === client && this.view.directoryConnected !== !!directory.current) {
        this.setView({ ...this.view, directoryConnected: !!directory.current });
      }
    };
    const unDirectory = directory.observe(check);
    const unClient = client.subscribe(() => {
      if (client.getView().endedReason) {
        this.ownEnding = false;
        unDirectory();
        void directory.close().catch(() => {});
      }
    });
    this.unwatchDirectory = () => { unDirectory(); unClient(); };
  }

  private namedEntry(nameKey: string, record: NameDirectoryEntry): BrowserRoomDirectoryEntry {
    const entry: BrowserRoomDirectoryEntry = { version: 2, nameKey, roomId: record.roomId, roomName: record.roomName,
      hostUserId: record.hostUserId, createdAt: record.createdAt, updatedAt: this.now(),
      status: record.status === 'inactive' ? 'inactive' : 'active', banUserIds: record.banUserIds };
    return entry;
  }

  private namedPayload(role: 'host' | 'audience', nameKey: string, roomId: string, nickname: string): NamedVoiceRoomUrlPayload {
    return { version: 2, nameKey, roomId, role, pageUid: role === 'host' ? this.options.session.userId : null, nickname };
  }

  private readAttempt(nameKey: string): NameDirectoryEntry | undefined {
    try {
      const value = JSON.parse(sessionStorage.getItem(`vr-attempt:${nameKey}:${this.options.session.userId}`) ?? 'null');
      return value?.hostUserId === this.options.session.userId && value?.status === 'creating' ? value : undefined;
    } catch { return undefined; }
  }
  private saveAttempt(nameKey: string, entry: NameDirectoryEntry): void {
    try { sessionStorage.setItem(`vr-attempt:${nameKey}:${this.options.session.userId}`, JSON.stringify(entry)); } catch { /* Cloud reservation still has the attempt identity. */ }
  }
  private checkGeneration(generation: number): void {
    if (this.generation !== generation) throw new Error('操作已取消');
    if (this.currentClient?.getView().endedReason) throw new Error(this.currentClient.getView().endedReason);
  }

  async joinAudienceFromUrlPayload(payload: VoiceRoomUrlPayload): Promise<void> {
    if (this.leavePromise) throw new Error('已有房间操作进行中，请先完成或取消');
    if (payload.role !== "audience") throw new Error("邀请 URL 不是 Audience 入口");
    if (isNamedVoiceRoomPayload(payload)) return this.joinNamedPayload(payload);
    const nickname = resolveEntryNickname(payload.nickname, 'audience', this.options.session.userId);
    const { storageKey, entry } = payloadDirectoryEntry(payload);
    this.options.directory.merge(storageKey, entry);
    await this.joinAudienceFromDirectory(entry.roomId, { ...payload, nickname });
  }

  async joinAudienceFromDirectory(roomId: string, sourcePayload?: VoiceRoomUrlPayload): Promise<void> {
    const entry = this.requireEntry(roomId);
    if (entry.nameKey) return this.joinNamedPayload(this.namedPayload('audience', entry.nameKey, entry.roomId,
      resolveEntryNickname(sourcePayload?.nickname, 'audience', this.options.session.userId)));
    if (this.busy || this.currentClient || this.leavePromise) throw new Error('已有房间操作进行中，请先完成或取消');
    const generation = ++this.generation;
    this.assertActive(entry);
    this.assertNotBanned(entry);
    const nickname = resolveEntryNickname(sourcePayload?.nickname, 'audience', this.options.session.userId);
    const payload: VoiceRoomUrlPayload = sourcePayload
      ? { ...sourcePayload, nickname }
      : {
      localStorage: { [directoryStorageKey(new Date(entry.createdAt))]: entry },
      role: "audience" as const,
      pageUid: null,
      nickname,
    };
    const client = this.makeClient("audience", entry, nickname);
    this.currentClient = client;
    await this.subscribePreparedClient(generation, client, entry, payload);
  }

  async restoreHostFromUrlPayload(payload: VoiceRoomUrlPayload): Promise<void> {
    if (this.leavePromise) throw new Error('已有房间操作进行中，请先完成或取消');
    if (payload.role !== "host" || payload.pageUid !== this.options.session.userId) {
      throw new Error("Host 刷新 URL 与当前页面身份不匹配");
    }
    if (isNamedVoiceRoomPayload(payload)) return this.joinNamedPayload(payload);
    const nickname = resolveEntryNickname(payload.nickname, 'host', this.options.session.userId);
    const { storageKey, entry } = payloadDirectoryEntry(payload);
    this.options.directory.merge(storageKey, entry);
    const stored = this.requireEntry(entry.roomId);
    this.assertActive(stored);
    await this.enter("host", stored, { ...payload, nickname });
  }

  leaveRoom(): Promise<void> {
    if (this.leavePromise) return this.leavePromise;
    this.generation += 1;
    const client = this.currentClient;
    this.currentClient = undefined;
    this.unwatchDirectory?.();
    this.unwatchDirectory = undefined;
    const directory = this.currentDirectory;
    this.currentDirectory = undefined;
    const pendingOperation = this.pendingOperation;
    this.leavePromise = Promise.resolve().then(async () => {
      await Promise.allSettled([client?.leaveRoom(), directory?.close()]);
      await pendingOperation?.catch(() => {});
      this.setView({ phase: "idle" });
    }).finally(() => { this.leavePromise = undefined; });
    return this.leavePromise;
  }

  private async enter(
    role: "host",
    entry: BrowserRoomDirectoryEntry,
    payload: VoiceRoomUrlPayload,
  ): Promise<void> {
    const generation = ++this.generation;
    const client = this.makeClient(role, entry, resolveEntryNickname(payload.nickname, role, this.options.session.userId));
    this.currentClient = client;
    await this.subscribePreparedClient(generation, client, entry, payload);
  }

  private async subscribePreparedClient(
    generation: number,
    client: SingleRoomClient,
    entry: BrowserRoomDirectoryEntry,
    payload: VoiceRoomUrlPayload,
  ): Promise<void> {
    // 先发布可挂载的房间表面，再发起 subscribe。
    this.setView({ phase: "subscribing", client, entry, payload });
    try {
      await client.subscribeRoom();
      if (!this.isCurrent(generation, client)) {
        await client.leaveRoom();
        return;
      }
      const updatedPayload = payload.role === "audience"
        ? withVoiceRoomPageIdentity(
          payload,
          this.options.session.userId,
          resolveEntryNickname(payload.nickname, 'audience', this.options.session.userId),
        )
        : payload;
      this.options.replaceUrl?.(updatedPayload);
      this.setView({ phase: "room", client, entry, payload: updatedPayload });
      client.startRoomRuntime();
    } catch (error) {
      if (!this.isCurrent(generation, client)) return;
      this.currentClient = undefined;
      try { await client.leaveRoom(); } catch { /* 保留订阅的最初错误。 */ }
      const message = error instanceof Error ? error.message : "加入房间失败";
      this.setView({ phase: "idle", error: message });
      throw error;
    }
  }

  private makeClient(
    role: "host" | "audience",
    entry: BrowserRoomDirectoryEntry,
    displayName: string,
  ): SingleRoomClient {
    const sharedDirectory = entry.nameKey ? this.currentDirectory : undefined;
    const banLocally = (userId: string) => {
      if (entry.nameKey) return; // Named rooms use only the shared directory.
      const latest = this.options.directory.get(entry.roomId) ?? entry;
      this.options.directory.upsert({
        ...latest,
        updatedAt: this.now(),
        banUserIds: [...new Set([...latest.banUserIds, userId])],
      });
    };
    const markRoomInactive = () => {
      if (entry.nameKey) return;
      const latest = this.options.directory.get(entry.roomId) ?? entry;
      this.options.directory.upsert({
        ...latest,
        status: "inactive",
        updatedAt: this.now(),
      });
    };
    return this.createClient({
      appId: this.options.appId,
      roomId: entry.roomId,
      roomName: entry.roomName,
      hostUserId: entry.hostUserId!,
      userId: this.options.session.userId,
      displayName,
      role,
      session: this.options.session,
      createRtc: this.options.createRtc,
      onBanUser: sharedDirectory ? async (userId) => {
        await this.changeNamedRoom(sharedDirectory, entry, userId);
        banLocally(userId);
      } : banLocally,
      onSelfBanned: () => banLocally(this.options.session.userId),
      onRoomDissolved: sharedDirectory && role === 'host' ? async () => {
        await this.changeNamedRoom(sharedDirectory, entry);
        markRoomInactive();
      } : markRoomInactive,
      now: this.now,
    });
  }

  private async changeNamedRoom(directory: NameDirectory, entry: BrowserRoomDirectoryEntry, banUserId?: string): Promise<void> {
    if (this.view.managing) throw new Error('正在同步房间状态，请稍候');
    this.setView({ ...this.view, managing: true });
    this.ownEnding = !banUserId;
    let committed = false;
    try {
      const snapshot = await directory.waitFor(value => value);
      const record = snapshot.entry;
      if (!record || record.roomId !== entry.roomId || record.hostUserId !== this.options.session.userId) throw new Error('原房间已结束，无法修改同名的新房间');
      if (record.status === 'inactive' && !banUserId) { committed = true; return; }
      if (record.status !== 'active') throw new Error('房间已结束');
      const next: NameDirectoryEntry = banUserId ? { ...record, banUserIds: [...new Set([...record.banUserIds, banUserId])] }
        : { ...record, status: 'inactive', endedAt: this.now() };
      const transport = directory.transport as HostNameDirectoryRtm;
      await directory.confirmWrite(() => banUserId ? transport.banMember(next, snapshot.majorRevision) : transport.endRoom(next, snapshot.majorRevision), next);
      committed = true;
    } finally {
      if (!committed || banUserId) this.ownEnding = false;
      this.setView({ ...this.view, managing: false });
    }
  }

  private requireEntry(roomId: string): BrowserRoomDirectoryEntry {
    const entry = this.options.directory.get(roomId);
    if (!entry?.hostUserId) throw new Error("本地房间目录不完整");
    return entry;
  }

  private assertNotBanned(entry: BrowserRoomDirectoryEntry): void {
    if (entry.banUserIds.includes(this.options.session.userId)) {
      throw new Error("你已被该房间封禁");
    }
  }

  private assertActive(entry: BrowserRoomDirectoryEntry): void {
    if (entry.status === "inactive") {
      this.setView({ phase: "ended", entry, error: "房间已解散" });
      throw new Error("房间已解散");
    }
  }

  private isCurrent(generation: number, client: SingleRoomClient): boolean {
    return this.generation === generation && this.currentClient === client;
  }

  private setView(view: RoomEntryView): void {
    this.view = view;
    for (const listener of this.listeners) listener();
  }
}
