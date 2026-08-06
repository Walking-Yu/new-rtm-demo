export interface RtmEnvelope {
  schemaVersion: 1;
  messageId: string;
  sceneId: string;
  type: string;
  senderId: string;
  targetId?: string;
  channelId: string;
  sentAt: number;
  requiresAck: boolean;
  payload: Record<string, unknown>;
}

export type NewEnvelope = Omit<RtmEnvelope, 'schemaVersion' | 'messageId' | 'sentAt'>;

export function createEnvelope(input: NewEnvelope): RtmEnvelope {
  return {
    schemaVersion: 1,
    messageId: crypto.randomUUID(),
    sentAt: Date.now(),
    ...input,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasString(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === 'string' && record[key] !== '';
}

export function parseEnvelope(serialized: string): RtmEnvelope {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error('消息不是有效 JSON');
  }

  if (!isRecord(value)) {
    throw new Error('消息字段不完整');
  }
  if (value.schemaVersion !== 1) {
    throw new Error('不支持的消息版本');
  }

  const requiredStrings = ['messageId', 'sceneId', 'type', 'senderId', 'channelId'];
  const targetIsValid = value.targetId === undefined || typeof value.targetId === 'string';
  if (
    !requiredStrings.every((key) => hasString(value, key)) ||
    !targetIsValid ||
    typeof value.sentAt !== 'number' ||
    typeof value.requiresAck !== 'boolean' ||
    !isRecord(value.payload)
  ) {
    throw new Error('消息字段不完整');
  }

  return value as unknown as RtmEnvelope;
}

export function createMessageDeduper() {
  const processedIds = new Set<string>();

  return {
    accept(messageId: string): boolean {
      if (processedIds.has(messageId)) return false;
      processedIds.add(messageId);
      return true;
    },
    clear(): void {
      processedIds.clear();
    },
  };
}
