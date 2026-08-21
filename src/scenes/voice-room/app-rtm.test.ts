import type { RTMEvents } from "agora-rtm";
import { describe, expect, it, vi } from "vitest";

import {
  AppRtmSession,
  type AppRtmClient,
} from "./app-rtm";

type EventName = "linkState" | "message" | "presence" | "storage" | "token";

function createFakeClient(options: { failLogin?: boolean } = {}) {
  const operations: string[] = [];
  const listeners = new Map<EventName, Set<(event: never) => void>>();
  const client: AppRtmClient = {
    addEventListener(name, listener) {
      operations.push(`on:${name}`);
      const set = listeners.get(name as EventName) ?? new Set();
      set.add(listener as (event: never) => void);
      listeners.set(name as EventName, set);
    },
    removeEventListener(name, listener) {
      operations.push(`off:${name}`);
      listeners.get(name as EventName)?.delete(listener as (event: never) => void);
    },
    async login() {
      operations.push("login");
      if (options.failLogin) throw new Error("登录失败");
    },
    async logout() { operations.push("logout"); },
    async subscribe(roomId) { operations.push(`subscribe:${roomId}`); },
    async unsubscribe(roomId) { operations.push(`unsubscribe:${roomId}`); },
    async publish(channelName, _message, publishOptions) {
      operations.push(`publish:${publishOptions?.channelType}:${channelName}`);
    },
    presence: {
      async setState(roomId) { operations.push(`presence:set:${roomId}`); },
      async removeState(roomId) { operations.push(`presence:remove:${roomId}`); },
    },
    storage: {
      async setChannelMetadata(roomId, _type, _data, metadataOptions) {
        operations.push(`storage:set:${roomId}:${metadataOptions?.majorRevision ?? "none"}`);
      },
    },
  };

  return {
    client,
    operations,
    emit<Event extends EventName>(
      name: Event,
      event: Parameters<RTMEvents.RTMClientEventMap[Event]>[0],
    ) {
      for (const listener of listeners.get(name) ?? []) listener(event as never);
    },
  };
}

describe("AppRtmSession", () => {
  it("使用单调高精度时钟计算 login durationMs", async () => {
    const fake = createFakeClient();
    let monotonicNow = 100;
    const session = new AppRtmSession("app", "user-1", {
      createClient: () => fake.client,
      monotonicNow: () => monotonicNow,
    });

    const loggingIn = session.login();
    monotonicNow = 114.5;
    await loggingIn;

    expect(session.getTraces()).toContainEqual(
      expect.objectContaining({ name: "rtm.login", durationMs: 14.5 }),
    );
  });

  it("真实 login 调用完成后保留页面级 rtm.login trace", async () => {
    const fake = createFakeClient();
    const session = new AppRtmSession("app", "user-1", { createClient: () => fake.client });

    await session.login();

    expect(session.getTraces()).toEqual([
      expect.objectContaining({ kind: "api", role: "app", name: "rtm.login", uid: "user-1" }),
    ]);
  });

  it("页面级 port 把 Presence State 删除映射到 SDK removeState", async () => {
    const fake = createFakeClient();
    const session = new AppRtmSession("app", "user-1", { createClient: () => fake.client });
    const port = await session.login();

    await port.removePresenceState("room-1", ["muted", "microphoneError"]);

    expect(fake.operations).toContain("presence:remove:room-1");
  });

  it("在 login 前注册全部事件，并发登录只创建一个 client", async () => {
    const fake = createFakeClient();
    const createClient = vi.fn(() => fake.client);
    const session = new AppRtmSession("app", "user-1", { createClient });

    const [left, right] = await Promise.all([session.login(), session.login()]);

    expect(left).toBe(right);
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(fake.operations.slice(0, 6)).toEqual([
      "on:linkState",
      "on:message",
      "on:presence",
      "on:storage",
      "on:token",
      "login",
    ]);
  });

  it("只把事件分发给当前角色 handler，旧 cleanup 不解绑新角色", async () => {
    const fake = createFakeClient();
    const session = new AppRtmSession("app", "user-1", {
      createClient: () => fake.client,
    });
    const first = vi.fn();
    const second = vi.fn();
    await session.login();

    const unbindFirst = session.bindRtmEvents({ storage: first });
    fake.emit("storage", { timestamp: 1, channelName: "room", channelType: "MESSAGE", storageType: "CHANNEL", eventType: "SNAPSHOT", data: { majorRevision: 1, totalCount: 0, metadata: {} }, publisher: "" });
    session.bindRtmEvents({ storage: second });
    unbindFirst();
    fake.emit("storage", { timestamp: 2, channelName: "room", channelType: "MESSAGE", storageType: "CHANNEL", eventType: "SNAPSHOT", data: { majorRevision: 2, totalCount: 0, metadata: {} }, publisher: "" });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("角色晚于登录绑定时只读当前状态，不回放历史 linkState 事件", async () => {
    const fake = createFakeClient();
    const session = new AppRtmSession("app", "user-1", {
      createClient: () => fake.client,
    });
    await session.login();
    const event = {
      timestamp: 1,
      previousState: "CONNECTING",
      currentState: "CONNECTED",
      operation: "LOGIN",
      reasonCode: "LOGIN_SUCCESS",
      reason: "",
      affectedChannels: [],
      unrestoredChannels: [],
      isResumed: false,
      serviceType: "RTM",
    } as unknown as RTMEvents.LinkStateEvent;
    fake.emit("linkState", event);
    const handler = vi.fn();

    session.bindRtmEvents({ linkState: handler });

    expect(session.getCurrentLinkState()).toBe("connected");
    expect(handler).not.toHaveBeenCalled();
    expect(session.getTraces()).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "event", role: "app", name: "linkState", eventTag: "CONNECTED" }),
    ]));
  });

  it("登录失败后清理 listener 并允许重试，保留最初错误", async () => {
    const failed = createFakeClient({ failLogin: true });
    const succeeded = createFakeClient();
    const createClient = vi
      .fn<() => AppRtmClient>()
      .mockReturnValueOnce(failed.client)
      .mockReturnValueOnce(succeeded.client);
    const session = new AppRtmSession("app", "user-1", { createClient });

    await expect(session.login()).rejects.toThrow("登录失败");
    await expect(session.login()).resolves.toBe(session.getRoomPort());

    expect(createClient).toHaveBeenCalledTimes(2);
    expect(failed.operations).toContain("off:storage");
    expect(failed.operations.at(-1)).toBe("logout");
  });

  it("离房只取消订阅，页面注销才移除 listener 并 logout", async () => {
    const fake = createFakeClient();
    const session = new AppRtmSession("app", "user-1", {
      createClient: () => fake.client,
    });
    const port = await session.login();

    await port.unsubscribe("room-1");
    expect(fake.operations).not.toContain("logout");

    await session.logout();
    expect(fake.operations.slice(-6)).toEqual([
      "off:linkState",
      "off:message",
      "off:presence",
      "off:storage",
      "off:token",
      "logout",
    ]);
  });
});
