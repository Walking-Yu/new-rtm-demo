import { describe, expect, it } from 'vitest';
import { createEnvelope, createMessageDeduper, parseEnvelope } from './protocol';

describe('voice-room protocol', () => {
  it('creates and parses a valid targeted message', () => {
    const message = createEnvelope({
      type: 'seat.request',
      roomId: 'room-1',
      senderId: 'audience-1',
      targetId: 'host-1',
      requiresAck: true,
      payload: { seatId: 'seat-1' },
      now: 1000,
    });

    expect(parseEnvelope(JSON.stringify(message), {
      roomId: 'room-1',
      userId: 'host-1',
      now: 1000,
    })).toEqual(message);
  });

  it('rejects unsupported, expired, wrong-room, and wrong-target messages', () => {
    const message = createEnvelope({
      type: 'member.kick',
      roomId: 'room-1',
      senderId: 'host-1',
      targetId: 'audience-1',
      requiresAck: true,
      payload: {},
      now: 1000,
      ttlMs: 100,
    });

    expect(() => parseEnvelope(JSON.stringify({ ...message, schemaVersion: 2 }), {
      roomId: 'room-1', userId: 'audience-1', now: 1000,
    })).toThrow('不支持的消息版本');
    expect(() => parseEnvelope(JSON.stringify(message), {
      roomId: 'room-1', userId: 'audience-1', now: 1101,
    })).toThrow('消息已过期');
    expect(() => parseEnvelope(JSON.stringify(message), {
      roomId: 'room-2', userId: 'audience-1', now: 1000,
    })).toThrow('消息房间不匹配');
    expect(() => parseEnvelope(JSON.stringify(message), {
      roomId: 'room-1', userId: 'audience-2', now: 1000,
    })).toThrow('消息目标不匹配');
  });

  it('rejects malformed identifiers and payloads', () => {
    expect(() => parseEnvelope('{}', { roomId: 'room-1', userId: 'user-1', now: 0 })).toThrow('RTM 消息格式无效');
    expect(() => parseEnvelope('not-json', { roomId: 'room-1', userId: 'user-1', now: 0 })).toThrow('RTM 消息不是有效 JSON');
  });

  it('deduplicates messages with a bounded cache', () => {
    const deduper = createMessageDeduper(2);
    expect(deduper.accept('message-1')).toBe(true);
    expect(deduper.accept('message-1')).toBe(false);
    expect(deduper.accept('message-2')).toBe(true);
    expect(deduper.accept('message-3')).toBe(true);
    expect(deduper.accept('message-1')).toBe(true);
  });
});
