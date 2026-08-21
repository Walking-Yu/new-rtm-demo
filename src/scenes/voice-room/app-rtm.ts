import AgoraRTM from "agora-rtm";
import type { RTMConfig, RTMEvents } from "agora-rtm";
import type { TraceEntry } from "../../shared/timeline/traceStore";

type AppEventName =
  | "linkState"
  | "message"
  | "presence"
  | "storage"
  | "token";

export type AppRtmLinkState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed";

export type AppRtmEventListeners = Partial<{
  [EventName in AppEventName]: RTMEvents.RTMClientEventMap[EventName];
}>;

export interface AppRtmEventSource {
  /** Replaces the active role listeners and returns a generation-safe cleanup. */
  bindRtmEvents(listeners: AppRtmEventListeners): () => void;
}

export interface AppRtmClient {
  /** Registers one SDK event listener before login. */
  addEventListener<EventName extends keyof RTMEvents.RTMClientEventMap>(
    eventName: EventName,
    listener: RTMEvents.RTMClientEventMap[EventName],
  ): void;
  /** Removes one previously registered SDK event listener. */
  removeEventListener<EventName extends keyof RTMEvents.RTMClientEventMap>(
    eventName: EventName,
    listener: RTMEvents.RTMClientEventMap[EventName],
  ): void;
  /** Logs the application-scoped RTM client in. */
  login(options?: { token?: string }): Promise<unknown>;
  /** Logs the application-scoped RTM client out. */
  logout(): Promise<unknown>;
  /** Subscribes the client to one Message Channel. */
  subscribe(
    channelName: string,
    options?: {
      withMessage?: boolean;
      withPresence?: boolean;
      withMetadata?: boolean;
      withLock?: boolean;
    },
  ): Promise<unknown>;
  /** Unsubscribes the client from one Message Channel. */
  unsubscribe(channelName: string): Promise<unknown>;
  /** Publishes one USER or MESSAGE channel payload. */
  publish(
    channelName: string,
    message: string,
    options?: { channelType?: "MESSAGE" | "USER" },
  ): Promise<unknown>;
  presence: {
    /** Writes incremental Presence State for the current user. */
    setState(
      channelName: string,
      channelType: "MESSAGE",
      state: Record<string, string>,
    ): Promise<unknown>;
    /** Removes selected Presence State keys for the current user. */
    removeState(
      channelName: string,
      channelType: "MESSAGE",
      options: { states: string[] },
    ): Promise<unknown>;
  };
  storage: {
    /** Writes one or more Channel Metadata entries. */
    setChannelMetadata(
      channelName: string,
      channelType: "MESSAGE",
      data: Array<{ key: string; value: string; revision?: number }>,
      options?: { majorRevision?: number },
    ): Promise<unknown>;
  };
}

/** Creates the production, E2E, or test RTM client owned by the application page. */
export type AppRtmClientFactory = (
  appId: string,
  userId: string,
  config: RTMConfig,
) => AppRtmClient;

export interface AppRoomRtmPort {
  /** Subscribes a role to room Message, Presence, and Metadata events. */
  subscribe(
    roomId: string,
    options: {
      withMessage: true;
      withPresence: true;
      withMetadata: true;
      withLock: false;
    },
  ): Promise<unknown>;
  /** Unsubscribes the active role from its room. */
  unsubscribe(roomId: string): Promise<unknown>;
  /** Publishes a serialized role message through the application client. */
  publish(
    channelName: string,
    message: string,
    channelType: "MESSAGE" | "USER",
  ): Promise<unknown>;
  /** Writes incremental Presence State through the application client. */
  setPresenceState(
    roomId: string,
    state: Record<string, string>,
  ): Promise<unknown>;
  /** Removes selected Presence State keys through the application client. */
  removePresenceState(roomId: string, keys: readonly string[]): Promise<unknown>;
  /** Writes authoritative room metadata through the application client. */
  setRoomMetadata(
    roomId: string,
    data: Array<{ key: string; value: string; revision?: number }>,
    majorRevision?: number,
  ): Promise<unknown>;
}

export interface AppRtmSessionOptions {
  token?: string;
  createClient?: AppRtmClientFactory;
  /** Supplies a monotonic high-resolution clock for the login API duration. */
  monotonicNow?: () => number;
}

type RegisteredListeners = {
  [EventName in AppEventName]: RTMEvents.RTMClientEventMap[EventName];
};

/** Creates the real SDK client, or the local E2E adapter in E2E mode. */
const defaultClientFactory: AppRtmClientFactory = (
  appId,
  userId,
  config,
) => import.meta.env.MODE === "e2e"
  ? createE2eAppRtmClient(userId)
  : new AgoraRTM.RTM(appId, userId, config) as unknown as AppRtmClient;

/** Creates the in-memory application client used by browser E2E tests. */
function createE2eAppRtmClient(userId: string): AppRtmClient {
  const listeners = new Map<string, Set<(event: never) => void>>();
  /** Queues one synthetic SDK event for all listeners registered under its name. */
  const emit = (name: string, event: unknown) => {
    queueMicrotask(() => {
      for (const listener of listeners.get(name) ?? []) listener(event as never);
    });
  };
  return {
    /** Stores one synthetic E2E event listener. */
    addEventListener(name, listener) {
      const set = listeners.get(name) ?? new Set();
      set.add(listener as (event: never) => void);
      listeners.set(name, set);
    },
    /** Removes one synthetic E2E event listener. */
    removeEventListener(name, listener) {
      listeners.get(name)?.delete(listener as (event: never) => void);
    },
    /** Emits the successful login link-state event. */
    async login() {
      emit("linkState", {
        timestamp: Date.now(),
        previousState: "CONNECTING",
        currentState: "CONNECTED",
        operation: "LOGIN",
        reasonCode: "LOGIN_SUCCESS",
        reason: "",
        affectedChannels: [],
        unrestoredChannels: [],
        isResumed: false,
        serviceType: "RTM",
      });
    },
    /** Completes the synthetic application logout. */
    async logout() {},
    /** Emits initial Presence and Storage snapshots for the subscribed room. */
    async subscribe(channelName) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      emit("presence", {
        timestamp: Date.now(), channelName, channelType: "MESSAGE", eventType: "SNAPSHOT",
        publisher: "", snapshot: [{ userId, states: {} }], interval: null,
      });
      emit("storage", {
        timestamp: Date.now(), channelName, channelType: "MESSAGE", storageType: "CHANNEL",
        eventType: "SNAPSHOT", publisher: "", data: { majorRevision: 0, totalCount: 0, metadata: {} },
      });
    },
    /** Completes the synthetic room unsubscribe. */
    async unsubscribe() {},
    /** Completes a synthetic message publish without network I/O. */
    async publish() {},
    presence: {
      /** Completes a synthetic Presence State write. */
      async setState() {},
      /** Completes a synthetic Presence State removal. */
      async removeState() {},
    },
    storage: {
      /** Emits a synthetic Channel Metadata update after a write. */
      async setChannelMetadata(channelName, _channelType, data) {
        emit("storage", {
          timestamp: Date.now(), channelName, channelType: "MESSAGE", storageType: "CHANNEL",
          eventType: "UPDATE", publisher: userId,
          data: {
            majorRevision: 1,
            totalCount: data.length,
            metadata: Object.fromEntries(data.map(({ key, value, revision = 1 }) => [key, { value, revision }])),
          },
        });
      },
    },
  };
}

/** Owns the single RTM client for the lifetime of the voice-room application page. */
export class AppRtmSession {
  private readonly createClient: AppRtmClientFactory;
  private readonly token: string | undefined;
  private readonly monotonicNow: () => number;
  private client: AppRtmClient | undefined;
  private listeners: RegisteredListeners | undefined;
  private loginPromise: Promise<AppRoomRtmPort> | undefined;
  private activeListeners: AppRtmEventListeners | undefined;
  private latestLinkStateEvent: RTMEvents.LinkStateEvent | undefined;
  private handlerGeneration = 0;
  private readonly traces: TraceEntry[] = [];
  private readonly traceListeners = new Set<() => void>();
  private traceSnapshot: readonly TraceEntry[] | undefined;
  private traceSeq = 0;

  private readonly roomPort: AppRoomRtmPort = {
    /** Delegates one room subscription to the owned SDK client. */
    subscribe: (roomId, options) => this.requireClient().subscribe(roomId, options),
    /** Delegates one room unsubscribe to the owned SDK client. */
    unsubscribe: (roomId) => this.requireClient().unsubscribe(roomId),
    /** Delegates one serialized role publish to the owned SDK client. */
    publish: (channelName, message, channelType) =>
      this.requireClient().publish(channelName, message, { channelType }),
    /** Delegates an incremental Presence write to the owned SDK client. */
    setPresenceState: (roomId, state) =>
      this.requireClient().presence.setState(roomId, "MESSAGE", state),
    /** Delegates a Presence key removal to the owned SDK client. */
    removePresenceState: (roomId, keys) =>
      this.requireClient().presence.removeState(roomId, "MESSAGE", { states: [...keys] }),
    /** Delegates a Channel Metadata write to the owned SDK client. */
    setRoomMetadata: (roomId, data, majorRevision) =>
      this.requireClient().storage.setChannelMetadata(
        roomId,
        "MESSAGE",
        data,
        majorRevision === undefined ? undefined : { majorRevision },
      ),
  };

  /** Creates the application-lifetime RTM owner for one page UID. */
  constructor(
    private readonly appId: string,
    readonly userId: string,
    options: AppRtmSessionOptions = {},
  ) {
    this.createClient = options.createClient ?? defaultClientFactory;
    this.token = options.token;
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
  }

  /** Registers SDK listeners, logs in once, and returns the reusable room port. */
  login(): Promise<AppRoomRtmPort> {
    if (this.loginPromise) return this.loginPromise;

    const client = this.createClient(this.appId, this.userId, {
      logLevel: "debug",
      useStringUserId: true,
      presenceTimeout: 5,
    });
    this.client = client;
    this.latestLinkStateEvent = undefined;
    this.attachListeners(client);
    const startedAt = Date.now();
    const startedMonotonic = this.monotonicNow();

    const pending = client
      .login(this.token === undefined ? {} : { token: this.token })
      .then(() => {
        this.recordLoginTrace(startedAt, startedMonotonic);
        return this.roomPort;
      })
      .catch(async (error: unknown) => {
        this.recordLoginTrace(startedAt, startedMonotonic, error);
        if (this.client === client) {
          this.detachListeners(client);
          this.client = undefined;
          this.loginPromise = undefined;
          this.latestLinkStateEvent = undefined;
        }
        try {
          await client.logout();
        } catch {
          // 登录失败后的清理不得覆盖最初错误。
        }
        throw error;
      });
    this.loginPromise = pending;
    return pending;
  }

  /** Returns the reusable room port after application login has started. */
  getRoomPort(): AppRoomRtmPort {
    if (!this.client || !this.loginPromise) {
      throw new Error("RTM 尚未登录");
    }
    return this.roomPort;
  }

  /** Maps the latest SDK link-state event to the application connection state. */
  getCurrentLinkState(): AppRtmLinkState {
    const event = this.latestLinkStateEvent;
    if (!event) return "disconnected";
    if (event.currentState === "CONNECTED") return "connected";
    if (event.currentState === "FAILED") return "failed";
    if (event.currentState === "IDLE") return "disconnected";
    if (event.currentState === "DISCONNECTED" || event.currentState === "SUSPENDED") {
      return "reconnecting";
    }
    return event.operation === "AUTO_RECONNECT" ? "reconnecting" : "connecting";
  }

  /** Returns the memoized read-only application trace snapshot. */
  getTraces(): readonly TraceEntry[] {
    this.traceSnapshot ??= this.traces.map((entry) => ({ ...entry }));
    return this.traceSnapshot;
  }

  /** Subscribes to application trace changes and returns a cleanup function. */
  subscribeTraces(listener: () => void): () => void {
    this.traceListeners.add(listener);
    return () => this.traceListeners.delete(listener);
  }

  /** Clears application traces only after an explicit user action. */
  clearTraces(): void {
    this.traces.length = 0;
    this.notifyTraces();
  }

  /** Switches SDK event delivery to the current Host or Audience binding. */
  bindRtmEvents(listeners: AppRtmEventListeners): () => void {
    const generation = ++this.handlerGeneration;
    this.activeListeners = listeners;
    return () => {
      if (this.handlerGeneration !== generation) return;
      this.activeListeners = undefined;
    };
  }

  /** Removes SDK listeners and logs out when the application page unmounts. */
  async logout(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    this.loginPromise = undefined;
    this.activeListeners = undefined;
    this.latestLinkStateEvent = undefined;
    this.handlerGeneration += 1;
    if (!client) return;
    this.detachListeners(client);
    await client.logout();
  }

  /** Returns the owned client or throws when application login has not started. */
  private requireClient(): AppRtmClient {
    if (!this.client) throw new Error("RTM 尚未登录");
    return this.client;
  }

  /** Records one application login API trace using wall and monotonic clocks. */
  private recordLoginTrace(
    startedAt: number,
    startedMonotonic: number,
    error?: unknown,
  ): void {
    const candidate = error as { errorCode?: unknown; code?: unknown; message?: unknown } | undefined;
    const code = candidate?.errorCode ?? candidate?.code;
    this.traces.push({
      seq: ++this.traceSeq,
      at: startedAt,
      kind: "api",
      uid: this.userId,
      role: "app",
      name: "rtm.login",
      durationMs: Math.max(0, this.monotonicNow() - startedMonotonic),
      ...(typeof code === "number" ? { errorCode: code } : {}),
      ...(error ? { errorMessage: error instanceof Error ? error.message : "RTM 登录失败" } : {}),
    });
    this.notifyTraces();
  }

  /** Invalidates the application trace snapshot and notifies subscribers. */
  private notifyTraces(): void {
    this.traceSnapshot = undefined;
    for (const listener of this.traceListeners) listener();
  }

  /** Records one page-lifetime SDK link-state event. */
  private recordLinkStateTrace(event: RTMEvents.LinkStateEvent): void {
    this.traces.push({
      seq: ++this.traceSeq,
      at: event.timestamp || Date.now(),
      kind: "event",
      uid: this.userId,
      role: "app",
      name: "linkState",
      eventTag: event.currentState,
      summary: `${event.previousState}→${event.currentState}`,
    });
    this.notifyTraces();
  }

  /** Registers all SDK listeners before application login. */
  private attachListeners(client: AppRtmClient): void {
    const listeners: RegisteredListeners = {
      /** Records link state before forwarding it to the active role. */
      linkState: (event) => {
        this.latestLinkStateEvent = event;
        this.recordLinkStateTrace(event);
        this.activeListeners?.linkState?.(event);
      },
      /** Forwards messages to the active role binding. */
      message: (event) => this.activeListeners?.message?.(event),
      /** Forwards Presence events to the active role binding. */
      presence: (event) => this.activeListeners?.presence?.(event),
      /** Forwards Storage events to the active role binding. */
      storage: (event) => this.activeListeners?.storage?.(event),
      /** Forwards token events to the active role binding. */
      token: (event) => this.activeListeners?.token?.(event),
    };
    this.listeners = listeners;
    client.addEventListener("linkState", listeners.linkState);
    client.addEventListener("message", listeners.message);
    client.addEventListener("presence", listeners.presence);
    client.addEventListener("storage", listeners.storage);
    client.addEventListener("token", listeners.token);
  }

  /** Removes all SDK listeners during final application logout or failed login cleanup. */
  private detachListeners(client: AppRtmClient): void {
    const listeners = this.listeners;
    if (!listeners) return;
    client.removeEventListener("linkState", listeners.linkState);
    client.removeEventListener("message", listeners.message);
    client.removeEventListener("presence", listeners.presence);
    client.removeEventListener("storage", listeners.storage);
    client.removeEventListener("token", listeners.token);
    this.listeners = undefined;
  }
}
