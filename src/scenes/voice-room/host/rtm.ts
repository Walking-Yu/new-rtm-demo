import type { AppRoomRtmPort } from "../app-rtm";

const MESSAGE_TTL_MS = 15_000;
const ROLE = "host";

export interface ChannelMetadataResult {
  majorRevision: number;
  metadata: Record<string, { value: string; revision?: number }>;
}

export type VoiceRoomLinkState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed";

export type TraceKind = "api" | "event";

export interface TraceEntry {
  seq: number;
  at: number;
  kind: TraceKind;
  uid: string;
  role: string;
  name: string;
  eventTag?: string;
  summary?: string;
  durationMs?: number;
  errorCode?: number;
  errorMessage?: string;
}

export interface RtmMessageContext {
  channelName: string;
  channelType: "MESSAGE" | "USER";
  publisher: string;
}

export interface RoomMetadataWrite {
  key: string;
  value: string;
  revision?: number;
}

export interface SeatMetadataValue {
  seatId: string;
  userId: string | null;
  displayName: string | null;
}

export interface ApproveSeatRequestInput {
  seats: Record<string, SeatMetadataValue>;
}

export interface RoomRtmEnvelope {
  schemaVersion: 1;
  messageId: string;
  type: string;
  roomId: string;
  targetUserId?: string;
  sentAt: number;
  expiresAt: number;
  payload: Record<string, unknown>;
}

export interface RtmEventConsumption {
  summary?: string;
  /** Defers business consumption until after the event trace is recorded. */
  consume?: () => void | Promise<void>;
}

export interface HostRtmEventObserver {
  /** Records one accepted SDK event in the Host trace stream. */
  record(name: string, summary?: string, eventTag?: string): void;
  /** Reports an event-consumption error to the Host business store. */
  reportError(error: unknown): void;
}

export interface HostRtmEventBinding {
  /** Binds the current Host event listeners and returns their cleanup function. */
  bind(observer: HostRtmEventObserver): () => void;
}

export interface HostRoomRtmSession {
  /** Returns the already-logged-in page-level RTM operation port. */
  getRoomPort(): AppRoomRtmPort;
}

export interface HostRoomRtmOptions {
  roomId: string;
  userId: string;
  session: HostRoomRtmSession;
  events: HostRtmEventBinding;
  /** Resolves a UID for readable API trace summaries. */
  describeUser(userId: string): string | undefined;
  /** Describes only the seat changes relevant to the current API trace. */
  describeSeats(seats: Record<string, SeatMetadataValue>): string;
  /** Receives normalized asynchronous event-consumption errors. */
  onError?(message: string): void;
  /** Supplies Unix timestamps for envelopes, trace ordering, and deterministic tests. */
  now?: () => number;
  /** Supplies a monotonic high-resolution clock for API durations. */
  monotonicNow?: () => number;
}

/** Returns true when a value is a non-array object record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Creates a unique message ID for one outbound RTM envelope. */
function newMessageId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Extracts a numeric SDK error code when the thrown value exposes one. */
function sdkErrorCode(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  const code = error.errorCode ?? error.code;
  return typeof code === "number" ? code : undefined;
}

/** Converts an unknown failure into the user-facing RTM error message. */
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (isRecord(error)) {
    const detail = [error.reason, error.message]
      .filter((value): value is string => typeof value === "string")
      .join(" ")
      .trim();
    if (detail) return detail;
  }
  return "RTM 操作失败";
}

/** Formats primitive object fields as a compact key=value trace summary. */
function keyValueSummary(state: Record<string, unknown>): string {
  return Object.entries(state)
    .filter(([, value]) => typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(", ");
}

/** Formats every Presence write field, including displayName, for API traces. */
function presenceStateSummary(state: Record<string, unknown>): string {
  return keyValueSummary(state);
}

/** Provides the Host's atomic RTM operations without owning business state. */
export class HostRoomRtm {
  private readonly port: AppRoomRtmPort;
  private readonly now: () => number;
  private readonly monotonicNow: () => number;
  private readonly traces: TraceEntry[] = [];
  private readonly traceListeners = new Set<() => void>();
  private traceSnapshot: readonly TraceEntry[] | undefined;
  private traceSeq = 0;
  private subscriptionGeneration = 0;
  private subscribed = false;
  private unbindEvents: (() => void) | undefined;

  /** Captures the logged-in port and the clock used by this Host instance. */
  constructor(private readonly options: HostRoomRtmOptions) {
    this.port = options.session.getRoomPort();
    this.now = options.now ?? (() => Date.now());
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
  }

  /** Binds Host events and subscribes to room Message, Presence, and Metadata. */
  async subscribeRoom(): Promise<void> {
    if (this.subscribed) return;
    const generation = ++this.subscriptionGeneration;
    this.unbindEvents?.();
    this.unbindEvents = this.options.events.bind({
      record: (name, summary, eventTag) => this.recordEvent(name, summary, eventTag),
      reportError: (error) => this.reportError(error),
    });
    try {
      await this.track("rtm.subscribe", this.options.roomId, () =>
        this.port.subscribe(this.options.roomId, {
          withMessage: true,
          withPresence: true,
          withMetadata: true,
          withLock: false,
        }),
      );
      if (generation !== this.subscriptionGeneration) {
        await this.safeUnsubscribe();
        throw new Error("RTM 订阅已取消");
      }
      this.subscribed = true;
    } catch (error) {
      if (generation === this.subscriptionGeneration) {
        this.unbindEvents?.();
        this.unbindEvents = undefined;
      }
      throw error;
    }
  }

  /** Unsubscribes the room and detaches the current Host event binding. */
  async unsubscribeRoom(): Promise<void> {
    const hadSubscription = this.subscribed;
    this.subscriptionGeneration += 1;
    this.subscribed = false;
    try {
      if (hadSubscription) {
        await this.track("rtm.unsubscribe", this.options.roomId, () =>
          this.port.unsubscribe(this.options.roomId),
        );
      }
    } finally {
      this.unbindEvents?.();
      this.unbindEvents = undefined;
    }
  }

  /** Initializes all four authoritative room metadata keys from an empty snapshot revision. */
  async initializeRoom(data: RoomMetadataWrite[], majorRevision: number): Promise<void> {
    await this.track("storage.setChannelMetadata", "initialize", () =>
      this.port.setRoomMetadata(this.options.roomId, data, majorRevision),
    );
  }

  /** Writes the room announcement metadata key. */
  async updateAnnouncement(text: string): Promise<void> {
    await this.setRoomMetadata([{ key: "announcement", value: text }], `announcement=${text}`);
  }

  /** Writes the complete authoritative seat assignment metadata value. */
  async updateSeats(seats: Record<string, SeatMetadataValue>): Promise<void> {
    await this.setRoomMetadata(
      [{ key: "seats", value: JSON.stringify(seats) }],
      `seats=${this.options.describeSeats(seats)}`,
    );
  }

  /** Writes the complete forced-muted UID list to room metadata. */
  async updateForcedMutedUsers(userIds: readonly string[]): Promise<void> {
    const names = userIds.flatMap((userId) => this.options.describeUser(userId) ?? []);
    await this.setRoomMetadata(
      [{ key: "forcedMutedUserIds", value: JSON.stringify(userIds) }],
      `forcedMutedUserIds=${names.join(", ") || "空"}`,
    );
  }

  /** Publishes the Host nickname and initial unmuted state to Presence. */
  async initializeMemberState(displayName: string): Promise<void> {
    await this.setPresenceState({ displayName, muted: "false" });
  }

  /** Marks the Host microphone as voluntarily muted in Presence. */
  async muteMicrophone(): Promise<void> {
    await this.setPresenceState({ muted: "true" });
  }

  /** Marks the Host microphone as voluntarily unmuted in Presence. */
  async unmuteMicrophone(): Promise<void> {
    await this.setPresenceState({ muted: "false" });
  }

  /** Reports a confirmed local microphone-capture failure through Presence. */
  async reportMicrophoneError(): Promise<void> {
    await this.setPresenceState({ microphoneError: "true" });
  }

  /** Clears the Host microphone-capture error after recovery. */
  async clearMicrophoneError(): Promise<void> {
    await this.setPresenceState({ microphoneError: "false" });
  }

  /** Approves a seat request by writing the resulting complete seat map. */
  async approveSeatRequest(input: ApproveSeatRequestInput): Promise<void> {
    await this.updateSeats(input.seats);
  }

  /** Rejects one Audience seat request with a targeted P2P message. */
  async rejectSeatRequest(targetUserId: string, requestId: string, seatId: string): Promise<void> {
    await this.publishToUser(targetUserId, "seat.rejected", { requestId, seatId });
  }

  /** Sends one targeted invitation for an Audience member to take a seat. */
  async inviteToSeat(targetUserId: string, invitationId: string, seatId: string): Promise<void> {
    await this.publishToUser(targetUserId, "seat.invited", { invitationId, seatId });
  }

  /** Sends the cooperative member.kick control message to one Audience member. */
  async kickMember(targetUserId: string): Promise<void> {
    await this.publishToUser(targetUserId, "member.kick", {});
  }

  /** Sends the cooperative member.ban control message to one Audience member. */
  async banMember(targetUserId: string): Promise<void> {
    await this.publishToUser(targetUserId, "member.ban", {});
  }

  /** Broadcasts the room.dissolved terminal message to the room channel. */
  async dissolveRoom(): Promise<void> {
    await this.publishToRoom("room.dissolved", {});
  }

  /** Broadcasts one plain-text chat message to the room channel. */
  async sendChatMessage(text: string): Promise<void> {
    await this.publishToRoom("chat.message", { value: text });
  }

  /** Broadcasts the fixed gift interaction to the room channel. */
  async sendGiftMessage(): Promise<void> {
    await this.publishToRoom("gift.sent", { value: "🎁" });
  }

  /** Broadcasts the fixed heart reaction to the room channel. */
  async sendHeartMessage(): Promise<void> {
    await this.publishToRoom("emoji.reaction", { value: "❤️" });
  }

  /** Returns the memoized read-only snapshot of Host RTM traces. */
  getTraces(): readonly TraceEntry[] {
    this.traceSnapshot ??= this.traces.map((entry) => ({ ...entry }));
    return this.traceSnapshot;
  }

  /** Subscribes to Host trace changes and returns an unsubscribe function. */
  subscribeTraces(listener: () => void): () => void {
    this.traceListeners.add(listener);
    return () => this.traceListeners.delete(listener);
  }

  /** Clears Host traces only when the user explicitly requests it. */
  clearTraces(): void {
    this.traces.length = 0;
    this.notifyTraces();
  }

  /** Performs one incremental room metadata write with API tracing. */
  private async setRoomMetadata(data: RoomMetadataWrite[], summary: string): Promise<void> {
    await this.track("storage.setChannelMetadata", summary, () =>
      this.port.setRoomMetadata(this.options.roomId, data),
    );
  }

  /** Performs one incremental Presence state write with API tracing. */
  private async setPresenceState(state: Record<string, string>): Promise<void> {
    await this.track("presence.setState", presenceStateSummary(state), () =>
      this.port.setPresenceState(this.options.roomId, state),
    );
  }

  /** Wraps and publishes one targeted USER-channel message. */
  private async publishToUser(
    userId: string,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const envelope = this.createEnvelope(type, payload, userId);
    await this.track("rtm.publish", `USER ${type} from ${this.describeUser(this.options.userId)}`, () =>
      this.port.publish(userId, JSON.stringify(envelope), "USER"),
    );
  }

  /** Wraps and publishes one room MESSAGE-channel broadcast. */
  private async publishToRoom(type: string, payload: Record<string, unknown>): Promise<void> {
    const envelope = this.createEnvelope(type, payload);
    await this.track("rtm.publish", `MESSAGE ${type} from ${this.describeUser(this.options.userId)}`, () =>
      this.port.publish(this.options.roomId, JSON.stringify(envelope), "MESSAGE"),
    );
  }

  /** Builds the versioned, targeted, and expiring wire envelope for an outbound message. */
  private createEnvelope(
    type: string,
    payload: Record<string, unknown>,
    targetUserId?: string,
  ): RoomRtmEnvelope {
    const sentAt = this.now();
    return {
      schemaVersion: 1,
      messageId: newMessageId(),
      type,
      roomId: this.options.roomId,
      ...(targetUserId ? { targetUserId } : {}),
      sentAt,
      expiresAt: sentAt + MESSAGE_TTL_MS,
      payload,
    };
  }

  /** Returns the readable Host trace label for a UID. */
  private describeUser(userId: string): string {
    return this.options.describeUser(userId) ?? "暂无昵称";
  }

  /** Best-effort cleanup for a subscribe operation invalidated by a newer generation. */
  private async safeUnsubscribe(): Promise<void> {
    try {
      await this.port.unsubscribe(this.options.roomId);
    } catch {
      // 取消过期订阅只是回收，不覆盖取消语义。
    }
  }

  /** Normalizes and forwards an asynchronous event-consumption error. */
  private reportError(error: unknown): void {
    this.options.onError?.(errorMessage(error));
  }

  /** Executes one RTM API call and records its duration or failure. */
  private async track<T>(name: string, summary: string, operation: () => Promise<T>): Promise<T> {
    const startedAt = this.now();
    const startedMonotonic = this.monotonicNow();
    try {
      const result = await operation();
      this.recordTrace({
        at: startedAt,
        kind: "api",
        name,
        summary,
        durationMs: Math.max(0, this.monotonicNow() - startedMonotonic),
      });
      return result;
    } catch (error) {
      this.recordTrace({
        at: startedAt,
        kind: "api",
        name,
        summary,
        durationMs: Math.max(0, this.monotonicNow() - startedMonotonic),
        errorCode: sdkErrorCode(error),
        errorMessage: errorMessage(error),
      });
      throw error;
    }
  }

  /** Records one accepted SDK event from the Host event binding. */
  private recordEvent(name: string, summary?: string, eventTag?: string): void {
    this.recordTrace({ at: this.now(), kind: "event", name, summary, eventTag });
  }

  /** Appends one fully attributed entry to the Host trace stream. */
  private recordTrace(input: Omit<TraceEntry, "seq" | "uid" | "role">): void {
    this.traces.push({
      ...input,
      seq: ++this.traceSeq,
      uid: this.options.userId,
      role: ROLE,
    });
    this.notifyTraces();
  }

  /** Invalidates the trace snapshot and notifies all trace subscribers. */
  private notifyTraces(): void {
    this.traceSnapshot = undefined;
    for (const listener of this.traceListeners) listener();
  }
}

/** Creates one Host RTM operation module for a room role instance. */
export function createHostRoomRtm(options: HostRoomRtmOptions): HostRoomRtm {
  return new HostRoomRtm(options);
}
