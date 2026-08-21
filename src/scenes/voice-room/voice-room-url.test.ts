import { describe, expect, it } from "vitest";

import {
  createVoiceRoomInviteCode,
  createVoiceRoomUrl,
  decodeVoiceRoomUrlPayload,
  encodeVoiceRoomUrlPayload,
  parseVoiceRoomUrl,
  payloadDirectoryEntry,
  withVoiceRoomPageIdentity,
  type VoiceRoomUrlPayload,
} from "./voice-room-url";

function payload(overrides: Partial<VoiceRoomUrlPayload> = {}): VoiceRoomUrlPayload {
  return {
    localStorage: {
      "record-channel-list-20260818": {
        roomId: "voice-room-1",
        roomName: "周五晚间语聊",
        createdAt: 1780000000000,
        updatedAt: 1780000000000,
        hostUserId: "user-host-1",
        banUserIds: [],
        status: "active",
      },
    },
    role: "audience",
    pageUid: null,
    nickname: null,
    ...overrides,
  };
}

describe("语聊房 URL payload", () => {
  it("用 UTF-8 Base64URL 往返保留中文，URL 只有 data 参数", () => {
    const encoded = encodeVoiceRoomUrlPayload(payload());
    const url = createVoiceRoomUrl("https://example.com/", payload());

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeVoiceRoomUrlPayload(encoded)).toEqual(payload());
    expect([...new URL(url).searchParams.keys()]).toEqual(["data"]);
    expect(parseVoiceRoomUrl(url)).toEqual(payload());
  });

  it("短邀请内容只包含 data，并兼容完整 URL、查询串、data 字段和纯 payload", () => {
    const encoded = encodeVoiceRoomUrlPayload(payload());
    const inviteCode = createVoiceRoomInviteCode(payload());

    expect(inviteCode).toBe(`data=${encoded}`);
    expect(parseVoiceRoomUrl(createVoiceRoomUrl("http://10.103.1.149:8080", payload()))).toEqual(payload());
    expect(parseVoiceRoomUrl(`?data=${encoded}`)).toEqual(payload());
    expect(parseVoiceRoomUrl(`data=${encoded}`)).toEqual(payload());
    expect(parseVoiceRoomUrl(encoded)).toEqual(payload());
  });

  it("拒绝额外顶层字段、额外查询参数和多个目录 key", () => {
    const extraTopLevel = { ...payload(), roomId: "smuggled" };
    const twoEntries = payload({
      localStorage: {
        ...payload().localStorage,
        "record-channel-list-20260817": Object.values(payload().localStorage)[0],
      },
    });

    const encodeRaw = (value: unknown) => {
      const bytes = new TextEncoder().encode(JSON.stringify(value));
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
    };

    expect(decodeVoiceRoomUrlPayload(encodeRaw(extraTopLevel))).toBeUndefined();
    expect(decodeVoiceRoomUrlPayload(encodeRaw(twoEntries))).toBeUndefined();
    expect(parseVoiceRoomUrl(`?data=${encodeVoiceRoomUrlPayload(payload())}&room=voice-room-1`)).toBeUndefined();
  });

  it("拒绝数组或 JSON 字符串形式的目录 value，以及非法日期 key", () => {
    const entry = Object.values(payload().localStorage)[0];
    const invalidValues = [
      payload({ localStorage: { "record-channel-list-20260818": [entry] as never } }),
      payload({ localStorage: { "record-channel-list-20260818": JSON.stringify(entry) as never } }),
      payload({ localStorage: { "rooms": entry } }),
    ];

    for (const invalid of invalidValues) {
      expect(() => encodeVoiceRoomUrlPayload(invalid)).toThrow("非法的语聊房 URL payload");
    }
  });

  it("Audience 首次成功入房后同时写回 pageUid 和 nickname，目录快照保持不变", () => {
    const initial = payload();
    const updated = withVoiceRoomPageIdentity(initial, "user-audience-1", "Alice_037");

    expect(updated.pageUid).toBe("user-audience-1");
    expect(updated.nickname).toBe("Alice_037");
    expect(updated.localStorage).toBe(initial.localStorage);
    expect(payloadDirectoryEntry(updated)).toEqual({
      storageKey: "record-channel-list-20260818",
      entry: Object.values(initial.localStorage)[0],
    });
  });

  it("兼容不含 nickname 的旧 URL，解码后归一为 null", () => {
    const legacy = payload();
    const { nickname: _removed, ...legacyValue } = legacy;
    const bytes = new TextEncoder().encode(JSON.stringify(legacyValue));
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const encoded = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");

    expect(decodeVoiceRoomUrlPayload(encoded)).toEqual(legacy);
  });
});
