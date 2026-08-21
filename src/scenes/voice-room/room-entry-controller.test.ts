import { describe, expect, it, vi } from "vitest";

import {
  createBrowserRoomDirectory,
  type StorageLike,
} from "./browser-room-directory";
import type {
  SingleRoomClient,
  SingleRoomClientOptions,
} from "./event-driven-single-room-client";
import type { AppRtmSession } from "./app-rtm";
import { RoomEntryController } from "./room-entry-controller";
import type { VoiceRoomUrlPayload } from "./voice-room-url";

function createStorage(operations: string[]): StorageLike {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) { operations.push(`localStorage:set:${key}`); values.set(key, value); },
    removeItem: (key) => values.delete(key),
    keys: () => [...values.keys()],
  };
}

function invitePayload(banUserIds: string[] = []): VoiceRoomUrlPayload {
  return {
    localStorage: {
      "record-channel-list-20260818": {
        roomId: "room-1",
        roomName: "邀请房间",
        createdAt: Date.parse("2026-08-18T01:00:00.000Z"),
        updatedAt: Date.parse("2026-08-18T01:00:00.000Z"),
        hostUserId: "host-1",
        banUserIds,
        status: "active",
      },
    },
    role: "audience",
    pageUid: null,
    nickname: null,
  };
}

function setup(options: { userId?: string } = {}) {
  const operations: string[] = [];
  const storage = createStorage(operations);
  const directory = createBrowserRoomDirectory(storage, () => new Date("2026-08-18T02:00:00.000Z"));
  const clients: Array<{ options: SingleRoomClientOptions; client: SingleRoomClient }> = [];
  const createClient = vi.fn((clientOptions: SingleRoomClientOptions) => {
    const client = {
      async subscribeRoom() { operations.push("rtm:subscribe"); },
      startRoomRuntime() { operations.push("runtime:start"); },
      async leaveRoom() { operations.push("room:leave"); },
    } as SingleRoomClient;
    clients.push({ options: clientOptions, client });
    return client;
  });
  const replaced: VoiceRoomUrlPayload[] = [];
  const session = { userId: options.userId ?? "audience-1" } as AppRtmSession;
  const controller = new RoomEntryController({
    appId: "app",
    session,
    directory,
    createClient,
    randomRoomId: () => "room-created",
    now: () => Date.parse("2026-08-18T02:00:00.000Z"),
    replaceUrl: (payload) => replaced.push(payload),
  });
  controller.subscribe(() => operations.push(`view:${controller.getView().phase}`));
  return { controller, directory, operations, createClient, clients, replaced };
}

describe("RoomEntryController", () => {
  it("Host 创建先写 Local Storage，再挂载 room/subscribing，最后调用 subscribe", async () => {
    const context = setup({ userId: "host-1" });

    await context.controller.createHostRoom({ roomName: "新房间" });

    expect(context.operations).toEqual([
      "localStorage:set:record-channel-list-20260818",
      "view:subscribing",
      "rtm:subscribe",
      "view:room",
      "runtime:start",
    ]);
    expect(context.replaced[0]).toMatchObject({ role: "host", pageUid: "host-1" });
    expect(context.directory.get("room-created")?.status).toBe("active");
  });

  it("Host 封禁回调把目标 UID 写入 Local Storage 目录项", async () => {
    const context = setup({ userId: "host-1" });
    await context.controller.createHostRoom({ roomName: "封禁测试房间" });
    const clientOptions = context.clients[0].options;

    clientOptions.onBanUser?.("audience-2");

    expect(context.directory.get("room-created")?.banUserIds).toContain("audience-2");
  });

  it("解散回调把 Local Storage 房间置为 inactive，且 inactive 房间不再准入", async () => {
    const host = setup({ userId: "host-1" });
    await host.controller.createHostRoom({ roomName: "解散测试房间" });
    host.clients[0].options.onRoomDissolved?.();

    expect(host.directory.get("room-created")?.status).toBe("inactive");

    const audience = setup();
    const inactivePayload = invitePayload();
    Object.values(inactivePayload.localStorage)[0].status = "inactive";
    await expect(audience.controller.joinAudienceFromUrlPayload(inactivePayload))
      .rejects.toThrow("房间已解散");
    expect(audience.operations).not.toContain("whoNow:host-1");
    expect(audience.operations).not.toContain("rtm:subscribe");
  });

  it("Audience URL 先合并目录再重读 active 状态，然后直接订阅", async () => {
    const context = setup();

    await context.controller.joinAudienceFromUrlPayload(invitePayload());

    expect(context.operations).toEqual([
      "localStorage:set:record-channel-list-20260818",
      "view:subscribing",
      "rtm:subscribe",
      "view:room",
      "runtime:start",
    ]);
    expect(context.replaced[0].pageUid).toBe("audience-1");
    expect(context.replaced[0].nickname).toMatch(/^[A-Z][a-z]+_\d{3}$/u);
    expect(context.clients[0].options.displayName).toBe(context.replaced[0].nickname);
  });

  it("本地封禁命中时不创建 client、不调用 subscribe", async () => {
    const context = setup();

    await expect(context.controller.joinAudienceFromUrlPayload(invitePayload(["audience-1"])))
      .rejects.toThrow("你已被该房间封禁");

    expect(context.createClient).not.toHaveBeenCalled();
    expect(context.operations).toEqual(["localStorage:set:record-channel-list-20260818"]);
  });

  it("带 pageUid 的 Audience 刷新 URL 不校验 Host Presence，直接订阅 active 房间", async () => {
    const context = setup();
    const refreshPayload = {
      ...invitePayload(),
      pageUid: "audience-1",
      nickname: "Alice_037",
    };

    await context.controller.joinAudienceFromUrlPayload(refreshPayload);

    expect(context.operations.some((operation) => operation.startsWith("whoNow:"))).toBe(false);
    expect(context.operations).toContain("rtm:subscribe");
    expect(context.controller.getView().phase).toBe("room");
  });

  it("离房调用当前单角色 client，并回到 idle", async () => {
    const context = setup();
    await context.controller.joinAudienceFromUrlPayload(invitePayload());

    await context.controller.leaveRoom();

    expect(context.operations.slice(-2)).toEqual(["room:leave", "view:idle"]);
  });
});
