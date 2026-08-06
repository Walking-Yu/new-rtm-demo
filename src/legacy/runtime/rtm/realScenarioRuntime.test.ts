import { describe, expect, it, vi } from 'vitest';
import type { ConnectionSettings } from '../../components/ConnectionDialog';
import { getScenario } from '../../domain/scenarioCatalog';
import { createEnvelope } from '../protocol';
import type {
  ChannelSnapshot,
  RtmCredentials,
  RtmPort,
  RtmPortHandlers,
  SetMetadataOptions,
} from './RtmPort';
import { createRealScenarioRuntime } from './realScenarioRuntime';

class MemoryRtmPort implements RtmPort {
  operations: string[] = [];
  handlers?: RtmPortHandlers;
  failAcquire = false;
  snapshot: ChannelSnapshot = {
    revision: 1,
    values: { 'voice-room-state': JSON.stringify({ revision: 1, seats: {} }) },
  };

  registerEvents(handlers: RtmPortHandlers) {
    this.operations.push('register-events');
    this.handlers = handlers;
  }

  async connect(credentials: RtmCredentials) {
    this.operations.push(`connect:${credentials.userId}`);
  }

  async disconnect() {
    this.operations.push('disconnect');
  }

  async subscribe(channelId: string) {
    this.operations.push(`subscribe:${channelId}`);
  }

  async unsubscribe(channelId: string) {
    this.operations.push(`unsubscribe:${channelId}`);
  }

  async publishChannel(channelId: string, message: string) {
    const envelope = JSON.parse(message) as { type: string };
    this.operations.push(`publish:channel:${channelId}:${envelope.type}`);
  }

  async publishUser(userId: string, message: string) {
    const envelope = JSON.parse(message) as { type: string; payload?: { status?: string } };
    this.operations.push(`publish:user:${userId}:${envelope.type}:${envelope.payload?.status ?? ''}`);
  }

  async getOnlineUsers(channelId: string) {
    this.operations.push(`presence:${channelId}`);
    return ['host-1', 'audience-1', 'device-1', 'controller-1'];
  }

  async getChannelMetadata(channelId: string) {
    this.operations.push(`storage:get:${channelId}`);
    return this.snapshot;
  }

  async setChannelMetadata(
    channelId: string,
    _key: string,
    value: string,
    _options?: SetMetadataOptions,
  ) {
    const snapshot = JSON.parse(value) as { revision: number };
    this.operations.push(`storage:set:${channelId}:${snapshot.revision}`);
    this.snapshot = { revision: this.snapshot.revision + 1, values: { 'voice-room-state': value } };
  }

  async acquireLock(channelId: string, lockName: string) {
    this.operations.push(`lock:acquire:${channelId}:${lockName}`);
    if (this.failAcquire) throw new Error('LOCK_ALREADY_ACQUIRED');
  }

  async releaseLock(channelId: string, lockName: string) {
    this.operations.push(`lock:release:${channelId}:${lockName}`);
  }

  emitMessage(message: string, publisher: string) {
    this.handlers?.message({
      channelType: 'USER',
      channelName: publisher,
      message,
      publisher,
      timestamp: Date.now(),
    });
  }
}

const voiceSettings: ConnectionSettings = {
  appId: 'app-id',
  userId: 'host-1',
  token: 'token',
  channelId: 'voice-room-001',
  targetUserId: 'audience-1',
};

describe('real scenario runtime', () => {
  it('hydrates voice-room state before locking and publishing a seat approval', async () => {
    const port = new MemoryRtmPort();
    const runtime = createRealScenarioRuntime({
      port,
      scenario: getScenario('voice-room-seats')!,
      roleId: 'host',
      settings: voiceSettings,
    });

    await runtime.connect();
    await runtime.execute('approve-seat');

    expect(port.operations).toEqual([
      'register-events',
      'connect:host-1',
      'subscribe:voice-room-001',
      'presence:voice-room-001',
      'storage:get:voice-room-001',
      'lock:acquire:voice-room-001:seat-1',
      'storage:get:voice-room-001',
      'storage:set:voice-room-001:2',
      'publish:channel:voice-room-001:mic.accept',
      'lock:release:voice-room-001:seat-1',
    ]);
    expect(runtime.getState().voiceSeats['seat-1']).toMatchObject({ userId: 'audience-1', muted: false });
  });

  it('refreshes state after a seat lock conflict without overwriting the holder', async () => {
    const port = new MemoryRtmPort();
    port.failAcquire = true;
    const runtime = createRealScenarioRuntime({
      port,
      scenario: getScenario('voice-room-seats')!,
      roleId: 'host',
      settings: voiceSettings,
    });

    await runtime.connect();
    await runtime.execute('approve-seat');

    expect(port.operations.slice(-2)).toEqual([
      'lock:acquire:voice-room-001:seat-1',
      'storage:get:voice-room-001',
    ]);
    expect(runtime.getState().voiceSeats['seat-1']).toBeUndefined();
    expect(runtime.getState().events.at(-1)).toMatchObject({ kind: 'error' });
  });

  it('sends RECEIVED and EXECUTED ACK once for a device command', async () => {
    const port = new MemoryRtmPort();
    const settings = { ...voiceSettings, userId: 'device-1', channelId: 'device-presence', targetUserId: 'controller-1' };
    const runtime = createRealScenarioRuntime({
      port,
      scenario: getScenario('device-control')!,
      roleId: 'device',
      settings,
    });
    await runtime.connect();
    port.operations = [];

    const command = createEnvelope({
      sceneId: 'device-control',
      type: 'device.command',
      senderId: 'controller-1',
      targetId: 'device-1',
      channelId: 'device-presence',
      requiresAck: true,
      payload: { actionId: 'power-on', nextStatus: '设备运行中' },
    });
    port.emitMessage(JSON.stringify(command), 'controller-1');
    await vi.waitFor(() => expect(port.operations).toHaveLength(2));
    port.emitMessage(JSON.stringify(command), 'controller-1');
    await Promise.resolve();

    expect(port.operations).toEqual([
      'publish:user:controller-1:device.ack:RECEIVED',
      'publish:user:controller-1:device.ack:EXECUTED',
    ]);
    expect(runtime.getState().status).toBe('设备运行中');
  });

  it('marks controller commands timed out when EXECUTED ACK does not arrive', async () => {
    vi.useFakeTimers();
    const port = new MemoryRtmPort();
    const settings = { ...voiceSettings, userId: 'controller-1', channelId: 'device-presence', targetUserId: 'device-1' };
    const runtime = createRealScenarioRuntime({
      port,
      scenario: getScenario('device-control')!,
      roleId: 'controller',
      settings,
      ackTimeoutMs: 1000,
    });
    await runtime.connect();

    await runtime.execute('power-on');
    expect(runtime.getState().commands[0].status).toBe('SENT');
    await vi.advanceTimersByTimeAsync(1001);
    expect(runtime.getState().commands[0].status).toBe('TIMED_OUT');
    runtime.destroy();
    vi.useRealTimers();
  });
});
