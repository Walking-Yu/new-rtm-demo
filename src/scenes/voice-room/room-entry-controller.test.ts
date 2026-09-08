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
import type { VoiceRoomUrlPayload, LegacyVoiceRoomUrlPayload } from "./voice-room-url";
import { createDirectoryTestHub } from "./name-directory.testing";
import type { RtcHelper } from "../../shared/rtc";

function createStorage(operations: string[]): StorageLike {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) { operations.push(`localStorage:set:${key}`); values.set(key, value); },
    removeItem: (key) => values.delete(key),
    keys: () => [...values.keys()],
  };
}

function invitePayload(banUserIds: string[] = []): LegacyVoiceRoomUrlPayload {
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
  const restoreLegacyHost = (roomName: string) => controller.restoreHostFromUrlPayload({
    ...invitePayload(), role: 'host', pageUid: session.userId,
    localStorage: { 'record-channel-list-20260818': { ...Object.values(invitePayload().localStorage)[0], roomId: 'room-created', roomName, hostUserId: session.userId } },
  });
  return { controller, directory, operations, createClient, clients, replaced, restoreLegacyHost };
}

describe("RoomEntryController", () => {
  it.each(['host', 'audience'] as const)("旧 V1 %s URL 恢复自定义昵称，pageUid 为空仍保留有效昵称", async role => {
    const userId = role === 'host' ? 'host-1' : 'new-audience-uid';
    const context = setup({ userId });
    const payload = { ...invitePayload(), role, pageUid: role === 'host' ? userId : null, nickname: '小明 👩‍💻' };
    if (role === 'host') await context.controller.restoreHostFromUrlPayload(payload);
    else await context.controller.joinAudienceFromUrlPayload(payload);
    expect(context.clients[0].options).toMatchObject({ userId, displayName: '小明 👩‍💻', role });
    expect(context.replaced[0]).toMatchObject({ pageUid: userId, nickname: '小明 👩‍💻' });
    await context.controller.leaveRoom();
  });

  it("旧 Host 邀请恢复先合并 Local Storage，再挂载与订阅", async () => {
    const context = setup({ userId: "host-1" });

    await context.restoreLegacyHost("新房间");

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
    await context.restoreLegacyHost("封禁测试房间");
    const clientOptions = context.clients[0].options;

    clientOptions.onBanUser?.("audience-2");

    expect(context.directory.get("room-created")?.banUserIds).toContain("audience-2");
  });

  it("解散回调把 Local Storage 房间置为 inactive，且 inactive 房间不再准入", async () => {
    const host = setup({ userId: "host-1" });
    await host.restoreLegacyHost("解散测试房间");
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

  it("重复离房等待同一次清理，完成前拒绝创建、加入和旧链接恢复", async () => {
    const context = setup({ userId: "host-1" });
    await context.restoreLegacyHost("离房等待");
    let finishLeave!: () => void;
    const cleanup = new Promise<void>(resolve => { finishLeave = resolve; });
    const leave = vi.spyOn(context.clients[0].client, "leaveRoom").mockReturnValue(cleanup);
    const first = context.controller.leaveRoom();
    const second = context.controller.leaveRoom();
    try {
      expect(second).toBe(first);
      await expect(context.controller.createHostRoom({ roomName: "新房" })).rejects.toThrow("已有房间操作");
      await expect(context.controller.joinAudienceByName("新房")).rejects.toThrow("已有房间操作");
      await expect(context.controller.joinAudienceFromUrlPayload(invitePayload())).rejects.toThrow("已有房间操作");
      await expect(context.controller.joinAudienceFromDirectory("room-created")).rejects.toThrow("已有房间操作");
      await expect(context.restoreLegacyHost("恢复房间")).rejects.toThrow("已有房间操作");
      expect(context.controller.getView().phase).toBe("room");
      expect(leave).toHaveBeenCalledTimes(1);
    } finally {
      finishLeave();
      await Promise.all([first, second]);
    }
    expect(context.controller.getView().phase).toBe("idle");
    await context.restoreLegacyHost("恢复房间");
    expect(context.controller.getView().phase).toBe("room");
  });

  it("自动退出后重复返回会等待清理，恢复同一房间不会被旧退出退订", async () => {
    const hub = createDirectoryTestHub();
    const session = hub.session("controller-reentry-host");
    await session.login();
    let finishFirstLeave!: () => void;
    const firstRtcLeave = new Promise<void>(resolve => { finishFirstLeave = resolve; });
    let rtcCount = 0;
    const noop = async () => {};
    const controller = new RoomEntryController({
      appId: "test-app", session,
      directory: createBrowserRoomDirectory(createStorage([])),
      directoryTimeoutMs: 300,
      createRtc: (): RtcHelper => ({
        registerEvents() {}, join: noop, leave: ++rtcCount === 1 ? () => firstRtcLeave : noop,
        publishMicrophone: noop, unpublishMicrophone: noop, setMicrophoneMuted: noop,
        isMicrophoneCaptureHealthy: () => true, publishCamera: noop, unpublishCamera: noop,
        setCameraMuted: noop, getLocalVideoTrack: () => undefined,
      }),
    });
    let automaticLeave: Promise<void> | undefined;
    try {
      await controller.createHostRoom({ roomName: "自动退出重入回归", nickname: '昵称 A' });
      const roomId = controller.getView().entry!.roomId;
      expect(controller.getView().client!.getView().displayName).toBe('昵称 A');
      automaticLeave = controller.getView().client!.leaveRoom("五分钟无操作，本次体验已结束");
      const first = controller.leaveRoom();
      const second = controller.leaveRoom();
      let returnedToEntry = false;
      void Promise.all([first, second]).then(() => { returnedToEntry = true; });
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(returnedToEntry).toBe(false);
      expect(controller.getView().phase).toBe("room");
      await expect(controller.createHostRoom({ roomName: '自动退出重入回归', nickname: '昵称 B' })).rejects.toThrow('已有房间操作');
      finishFirstLeave();
      await Promise.all([automaticLeave, first, second]);
      expect(controller.getView().phase).toBe("idle");
      await controller.createHostRoom({ roomName: "自动退出重入回归", nickname: '昵称 B' });
      expect(controller.getView().entry!.roomId).toBe(roomId);
      expect(controller.getView().phase).toBe("room");
      expect(controller.getView().client!.getView()).toMatchObject({ userId: session.userId, displayName: '昵称 B' });
      expect(controller.getView().payload).toMatchObject({ pageUid: session.userId, nickname: '昵称 B' });
      expect(hub.clients.get(session.userId)!.channels.has(roomId)).toBe(true);
    } finally {
      finishFirstLeave();
      await automaticLeave;
      await controller.leaveRoom();
      await session.logout();
    }
  });
});
