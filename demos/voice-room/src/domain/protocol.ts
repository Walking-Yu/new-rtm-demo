export interface VoiceRoomEnvelope {
  schemaVersion: 1;
  messageId: string;
  type: string;
  roomId: string;
  senderId: string;
  targetId?: string;
  sentAt: number;
  expiresAt: number;
  requiresAck: boolean;
  payload: Record<string, unknown>;
}

interface CreateEnvelopeInput {
  type: string;
  roomId: string;
  senderId: string;
  targetId?: string;
  requiresAck: boolean;
  payload: Record<string, unknown>;
  now?: number;
  ttlMs?: number;
}

interface ParseContext {
  roomId: string;
  userId: string;
  now?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function createEnvelope(input: CreateEnvelopeInput): VoiceRoomEnvelope {
  const sentAt = input.now ?? Date.now();
  return {
    schemaVersion: 1,
    messageId: crypto.randomUUID(),
    type: input.type,
    roomId: input.roomId,
    senderId: input.senderId,
    targetId: input.targetId,
    sentAt,
    expiresAt: sentAt + (input.ttlMs ?? 15_000),
    requiresAck: input.requiresAck,
    payload: input.payload,
  };
}

export function parseEnvelope(serialized: string, context: ParseContext): VoiceRoomEnvelope {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error('RTM 消息不是有效 JSON');
  }
  if (!isRecord(value)) throw new Error('RTM 消息格式无效');
  if (typeof value.schemaVersion !== 'number') throw new Error('RTM 消息格式无效');
  if (value.schemaVersion !== 1) throw new Error('不支持的消息版本');
  if (
    !isNonEmptyString(value.messageId) ||
    !isNonEmptyString(value.type) ||
    !isNonEmptyString(value.roomId) ||
    !isNonEmptyString(value.senderId) ||
    (value.targetId !== undefined && !isNonEmptyString(value.targetId)) ||
    typeof value.sentAt !== 'number' ||
    typeof value.expiresAt !== 'number' ||
    typeof value.requiresAck !== 'boolean' ||
    !isRecord(value.payload)
  ) {
    throw new Error('RTM 消息格式无效');
  }

  const envelope = value as unknown as VoiceRoomEnvelope;
  if (envelope.roomId !== context.roomId) throw new Error('消息房间不匹配');
  if (envelope.targetId && envelope.targetId !== context.userId) throw new Error('消息目标不匹配');
  if ((context.now ?? Date.now()) > envelope.expiresAt) throw new Error('消息已过期');
  return envelope;
}

export function createMessageDeduper(maxSize = 500) {
  const ids = new Set<string>();
  return {
    accept(messageId: string): boolean {
      if (ids.has(messageId)) return false;
      while (ids.size >= Math.max(1, maxSize)) {
        const oldest = ids.values().next().value as string | undefined;
        if (oldest === undefined) break;
        ids.delete(oldest);
      }
      ids.add(messageId);
      return true;
    },
    clear(): void {
      ids.clear();
    },
  };
}
