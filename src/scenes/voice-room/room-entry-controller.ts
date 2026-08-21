import type { RtcHelper } from "../../shared/rtc";
import {
  type BrowserRoomDirectory,
  type BrowserRoomDirectoryEntry,
  directoryStorageKey,
} from "./browser-room-directory";
import { createAudienceDisplayName } from "./audience-display-name";
import {
  SingleRoomClient,
  type SingleRoomClientOptions,
} from "./event-driven-single-room-client";
import type { AppRtmSession } from "./app-rtm";
import {
  payloadDirectoryEntry,
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

  constructor(private readonly options: RoomEntryControllerOptions) {
    this.createClient = options.createClient ?? ((clientOptions) => new SingleRoomClient(clientOptions));
    this.now = options.now ?? (() => Date.now());
  }

  getView(): RoomEntryView { return this.view; }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async createHostRoom(input: { roomName: string }): Promise<void> {
    const roomName = input.roomName.trim();
    if (!roomName) throw new Error("房间名称不能为空");
    const timestamp = this.now();
    const entry: BrowserRoomDirectoryEntry = {
      roomId: (this.options.randomRoomId ?? randomRoomId)(),
      roomName,
      createdAt: timestamp,
      updatedAt: timestamp,
      hostUserId: this.options.session.userId,
      banUserIds: [],
      status: "active",
    };
    this.options.directory.upsert(entry);
    const stored = this.requireEntry(entry.roomId);
    const payload: VoiceRoomUrlPayload = {
      localStorage: { [directoryStorageKey(new Date(stored.createdAt))]: stored },
      role: "host",
      pageUid: this.options.session.userId,
      nickname: null,
    };
    await this.enter("host", stored, payload);
  }

  async joinAudienceFromUrlPayload(payload: VoiceRoomUrlPayload): Promise<void> {
    if (payload.role !== "audience") throw new Error("邀请 URL 不是 Audience 入口");
    const { storageKey, entry } = payloadDirectoryEntry(payload);
    this.options.directory.merge(storageKey, entry);
    await this.joinAudienceFromDirectory(entry.roomId, payload);
  }

  async joinAudienceFromDirectory(roomId: string, sourcePayload?: VoiceRoomUrlPayload): Promise<void> {
    const generation = ++this.generation;
    const entry = this.requireEntry(roomId);
    this.assertActive(entry);
    this.assertNotBanned(entry);
    const nickname = sourcePayload?.nickname ?? createAudienceDisplayName(this.options.session.userId);
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
    if (payload.role !== "host" || payload.pageUid !== this.options.session.userId) {
      throw new Error("Host 刷新 URL 与当前页面身份不匹配");
    }
    const { storageKey, entry } = payloadDirectoryEntry(payload);
    this.options.directory.merge(storageKey, entry);
    const stored = this.requireEntry(entry.roomId);
    this.assertActive(stored);
    await this.enter("host", stored, payload);
  }

  async leaveRoom(): Promise<void> {
    this.generation += 1;
    const client = this.currentClient;
    this.currentClient = undefined;
    if (client) await client.leaveRoom();
    this.setView({ phase: "idle" });
  }

  private async enter(
    role: "host",
    entry: BrowserRoomDirectoryEntry,
    payload: VoiceRoomUrlPayload,
  ): Promise<void> {
    const generation = ++this.generation;
    const client = this.makeClient(role, entry);
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
          payload.nickname ?? createAudienceDisplayName(this.options.session.userId),
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
    audienceDisplayName?: string,
  ): SingleRoomClient {
    const banLocally = (userId: string) => {
      const latest = this.requireEntry(entry.roomId);
      this.options.directory.upsert({
        ...latest,
        updatedAt: this.now(),
        banUserIds: [...new Set([...latest.banUserIds, userId])],
      });
    };
    const markRoomInactive = () => {
      const latest = this.requireEntry(entry.roomId);
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
      displayName: role === "host"
        ? "Host"
        : audienceDisplayName ?? createAudienceDisplayName(this.options.session.userId),
      role,
      session: this.options.session,
      createRtc: this.options.createRtc,
      onBanUser: banLocally,
      onSelfBanned: () => banLocally(this.options.session.userId),
      onRoomDissolved: markRoomInactive,
      now: this.now,
    });
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
