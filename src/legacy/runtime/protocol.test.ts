import { describe, expect, it, vi } from 'vitest';
import { createEnvelope, createMessageDeduper, parseEnvelope } from './protocol';

describe('RTM message protocol', () => {
  it('creates and parses a versioned message envelope', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_722_000_000_000);
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('29a9da62-8b6d-4c3a-a744-0ad7afd710e1');

    const message = createEnvelope({
      sceneId: 'device-control',
      type: 'device.command',
      senderId: 'controller-1',
      targetId: 'device-1',
      channelId: 'devices',
      requiresAck: true,
      payload: { command: 'power.on' },
    });

    expect(message).toEqual({
      schemaVersion: 1,
      messageId: '29a9da62-8b6d-4c3a-a744-0ad7afd710e1',
      sceneId: 'device-control',
      type: 'device.command',
      senderId: 'controller-1',
      targetId: 'device-1',
      channelId: 'devices',
      sentAt: 1_722_000_000_000,
      requiresAck: true,
      payload: { command: 'power.on' },
    });
    expect(parseEnvelope(JSON.stringify(message))).toEqual(message);
  });

  it('rejects unsupported versions and incomplete messages', () => {
    expect(() => parseEnvelope('{"schemaVersion":2}')).toThrow('不支持的消息版本');
    expect(() => parseEnvelope('{"schemaVersion":1}')).toThrow('消息字段不完整');
    expect(() => parseEnvelope('not-json')).toThrow('消息不是有效 JSON');
  });

  it('deduplicates messages for a page session', () => {
    const deduper = createMessageDeduper();

    expect(deduper.accept('message-1')).toBe(true);
    expect(deduper.accept('message-1')).toBe(false);
    deduper.clear();
    expect(deduper.accept('message-1')).toBe(true);
  });
});
