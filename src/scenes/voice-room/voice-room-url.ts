import {
  isDirectoryStorageKey,
  type BrowserRoomDirectoryEntry,
} from "./browser-room-directory";
import { isAudienceDisplayName } from "./audience-display-name";

export interface VoiceRoomUrlPayload {
  localStorage: Record<string, BrowserRoomDirectoryEntry>;
  role: "host" | "audience";
  pageUid: string | null;
  nickname: string | null;
}

const PAYLOAD_KEYS = ["localStorage", "nickname", "pageUid", "role"];
const LEGACY_PAYLOAD_KEYS = ["localStorage", "pageUid", "role"];
const ENTRY_KEYS = [
  "banUserIds",
  "createdAt",
  "hostUserId",
  "roomId",
  "roomName",
  "updatedAt",
  "status",
];
const LEGACY_ENTRY_KEYS = ENTRY_KEYS.filter((key) => key !== "status");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseEntry(value: unknown): BrowserRoomDirectoryEntry | undefined {
  if (!isRecord(value) || (!hasExactKeys(value, ENTRY_KEYS) && !hasExactKeys(value, LEGACY_ENTRY_KEYS))) return undefined;
  if (
    !isNonEmptyString(value.roomId) ||
    !isNonEmptyString(value.roomName) ||
    !isNonEmptyString(value.hostUserId) ||
    typeof value.createdAt !== "number" ||
    !Number.isFinite(value.createdAt) ||
    typeof value.updatedAt !== "number" ||
    !Number.isFinite(value.updatedAt) ||
    !Array.isArray(value.banUserIds) ||
    value.banUserIds.some((userId) => !isNonEmptyString(userId))
  ) return undefined;
  if ("status" in value && value.status !== "active" && value.status !== "inactive") return undefined;
  return {
    roomId: value.roomId,
    roomName: value.roomName,
    hostUserId: value.hostUserId,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    banUserIds: [...new Set(value.banUserIds)],
    status: value.status === "inactive" ? "inactive" : "active",
  };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

function base64UrlToBytes(encoded: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) throw new Error("非法的 Base64URL");
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/")
    .padEnd(Math.ceil(encoded.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function encodeVoiceRoomUrlPayload(payload: VoiceRoomUrlPayload): string {
  const validated = parseVoiceRoomUrlPayloadValue(payload);
  if (!validated) throw new Error("非法的语聊房 URL payload");
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(validated)));
}

export function decodeVoiceRoomUrlPayload(encoded: string): VoiceRoomUrlPayload | undefined {
  try {
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(base64UrlToBytes(encoded)));
    return parseVoiceRoomUrlPayloadValue(value);
  } catch {
    return undefined;
  }
}

export function parseVoiceRoomUrlPayloadValue(value: unknown): VoiceRoomUrlPayload | undefined {
  if (!isRecord(value) ||
    (!hasExactKeys(value, PAYLOAD_KEYS) && !hasExactKeys(value, LEGACY_PAYLOAD_KEYS))) return undefined;
  if (value.role !== "host" && value.role !== "audience") return undefined;
  if (value.pageUid !== null && !isNonEmptyString(value.pageUid)) return undefined;
  const nickname = "nickname" in value ? value.nickname : null;
  if (nickname !== null && !isAudienceDisplayName(nickname)) return undefined;
  if (!isRecord(value.localStorage)) return undefined;
  const entries = Object.entries(value.localStorage);
  if (entries.length !== 1 || !isDirectoryStorageKey(entries[0][0])) return undefined;
  const entry = parseEntry(entries[0][1]);
  if (!entry) return undefined;
  return {
    localStorage: { [entries[0][0]]: entry },
    role: value.role,
    pageUid: value.pageUid,
    nickname,
  };
}

export function parseVoiceRoomUrl(urlOrSearch: string): VoiceRoomUrlPayload | undefined {
  const input = urlOrSearch.trim();
  if (/^[A-Za-z0-9_-]+$/u.test(input)) return decodeVoiceRoomUrlPayload(input);
  if (input.startsWith("data=")) {
    const encoded = input.slice("data=".length);
    return /^[A-Za-z0-9_-]+$/u.test(encoded) ? decodeVoiceRoomUrlPayload(encoded) : undefined;
  }
  try {
    const url = new URL(input, "http://localhost/social/voice-room");
    const keys = [...url.searchParams.keys()];
    if (keys.length !== 1 || keys[0] !== "data") return undefined;
    const values = url.searchParams.getAll("data");
    return values.length === 1 ? decodeVoiceRoomUrlPayload(values[0]) : undefined;
  } catch {
    return undefined;
  }
}

export function createVoiceRoomInviteCode(payload: VoiceRoomUrlPayload): string {
  return `data=${encodeVoiceRoomUrlPayload(payload)}`;
}

export function createVoiceRoomUrl(origin: string, payload: VoiceRoomUrlPayload): string {
  const base = origin.replace(/\/$/u, "");
  return `${base}/social/voice-room?data=${encodeVoiceRoomUrlPayload(payload)}`;
}

export function payloadDirectoryEntry(payload: VoiceRoomUrlPayload): {
  storageKey: string;
  entry: BrowserRoomDirectoryEntry;
} {
  const [storageKey, entry] = Object.entries(payload.localStorage)[0];
  return { storageKey, entry };
}

export function withVoiceRoomPageIdentity(
  payload: VoiceRoomUrlPayload,
  pageUid: string,
  nickname: string,
): VoiceRoomUrlPayload {
  if (!isNonEmptyString(pageUid)) throw new Error("页面 UID 不能为空");
  if (!isAudienceDisplayName(nickname)) throw new Error("Audience 昵称格式不正确");
  return { ...payload, pageUid, nickname };
}
