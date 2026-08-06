import type { ConnectionSettings } from '../../components/ConnectionDialog';
import type { ScenarioDefinition, TimelineEvent } from '../../domain/scenario';
import { createEnvelope, createMessageDeduper, parseEnvelope, type RtmEnvelope } from '../protocol';
import { mapRtmError } from './errorMap';
import type { RtmConnectionState, RtmPort, RtmPortHandlers } from './RtmPort';

export interface VoiceSeat {
  userId: string;
  muted: boolean;
}

export type DeviceCommandStatus = 'SENT' | 'RECEIVED' | 'EXECUTED' | 'TIMED_OUT';

export interface DeviceCommand {
  messageId: string;
  actionId: string;
  label: string;
  status: DeviceCommandStatus;
  sentAt: number;
}

export interface RealScenarioState {
  connection: RtmConnectionState;
  hydrating: boolean;
  status: string;
  revision: number;
  onlineUsers: string[];
  voiceSeats: Record<string, VoiceSeat>;
  commands: DeviceCommand[];
  events: TimelineEvent[];
}

interface RealScenarioRuntimeOptions {
  port: RtmPort;
  scenario: ScenarioDefinition;
  roleId: string;
  settings: ConnectionSettings;
  ackTimeoutMs?: number;
}

interface VoiceSnapshot {
  revision: number;
  seats: Record<string, VoiceSeat>;
}

const VOICE_STATE_KEY = 'voice-room-state';

export class RealScenarioRuntime {
  private state: RealScenarioState;
  private readonly port: RtmPort;
  private readonly scenario: ScenarioDefinition;
  private readonly roleId: string;
  private readonly settings: ConnectionSettings;
  private readonly ackTimeoutMs: number;
  private readonly listeners = new Set<(state: RealScenarioState) => void>();
  private readonly deduper = createMessageDeduper();
  private readonly ackTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor({ port, scenario, roleId, settings, ackTimeoutMs = 6000 }: RealScenarioRuntimeOptions) {
    this.port = port;
    this.scenario = scenario;
    this.roleId = roleId;
    this.settings = settings;
    this.ackTimeoutMs = ackTimeoutMs;
    this.state = {
      connection: 'disconnected',
      hydrating: false,
      status: scenario.initialStatus,
      revision: 0,
      onlineUsers: [],
      voiceSeats: {},
      commands: [],
      events: [],
    };
  }

  getState(): RealScenarioState {
    return this.state;
  }

  subscribe(listener: (state: RealScenarioState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  async connect(): Promise<void> {
    this.patch({ connection: 'connecting', hydrating: true });
    this.port.registerEvents(this.createHandlers());
    try {
      await this.port.connect({
        appId: this.settings.appId,
        userId: this.settings.userId,
        token: this.settings.token,
      });
      await this.port.subscribe(this.settings.channelId);
      await this.hydrate();
      this.patch({ connection: 'connected', hydrating: false });
      this.addEvent('connection', 'RTM 已连接，场景状态已恢复');
    } catch (error) {
      const normalized = mapRtmError(error);
      this.patch({ connection: 'failed', hydrating: false });
      this.addEvent('error', normalized.message);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.clearTimers();
    try {
      if (this.settings.channelId) await this.port.unsubscribe(this.settings.channelId);
    } finally {
      await this.port.disconnect();
      this.patch({ connection: 'disconnected', hydrating: false });
    }
  }

  async execute(actionId: string): Promise<void> {
    const selectedAction = this.scenario.actions.find((action) => action.id === actionId);
    if (!selectedAction) return;
    if (this.state.connection !== 'connected') {
      this.addEvent('error', 'RTM 尚未连接，无法发送操作');
      return;
    }

    if (this.scenario.id === 'voice-room-seats') {
      await this.executeVoiceAction(actionId);
      return;
    }
    if (this.scenario.id === 'device-control') {
      await this.executeDeviceAction(actionId, selectedAction.label, selectedAction.nextStatus);
    }
  }

  destroy(): void {
    this.clearTimers();
    this.listeners.clear();
    this.deduper.clear();
  }

  private createHandlers(): RtmPortHandlers {
    return {
      connection: (state, reason) => {
        const previous = this.state.connection;
        this.patch({ connection: state });
        if (state === 'reconnecting') this.addEvent('connection', '网络波动，RTM 正在自动重连');
        if (state === 'failed') this.addEvent('error', mapRtmError(reason).message);
        if (state === 'connected' && previous === 'reconnecting') void this.restoreAfterReconnect();
      },
      message: (event) => {
        void this.handleMessage(event.message).catch((error) => this.addEvent('error', mapRtmError(error).message));
      },
      presence: (event) => {
        if (event.users.length > 0) this.patch({ onlineUsers: event.users });
        this.addEvent('received', `Presence 更新：${event.eventType}`);
      },
      storage: (event) => {
        if (this.scenario.id === 'voice-room-seats') this.applyVoiceSnapshot(event.values[VOICE_STATE_KEY]);
        this.addEvent('received', `Storage 快照已更新（revision ${event.revision}）`);
      },
      tokenExpiring: () => this.addEvent('error', 'Token 即将过期，请在连接设置中更新'),
    };
  }

  private async hydrate(): Promise<void> {
    const onlineUsers = await this.port.getOnlineUsers(this.settings.channelId);
    this.patch({ onlineUsers });
    if (this.scenario.id === 'voice-room-seats') await this.refreshVoiceSnapshot();
  }

  private async restoreAfterReconnect(): Promise<void> {
    this.patch({ hydrating: true });
    try {
      await this.port.subscribe(this.settings.channelId);
      await this.hydrate();
      this.patch({ hydrating: false, connection: 'connected' });
      this.addEvent('connection', 'RTM 重连完成，Presence 与快照已恢复');
    } catch (error) {
      this.patch({ hydrating: false, connection: 'failed' });
      this.addEvent('error', mapRtmError(error).message);
    }
  }

  private async refreshVoiceSnapshot(): Promise<VoiceSnapshot> {
    const channelSnapshot = await this.port.getChannelMetadata(this.settings.channelId);
    const voiceSnapshot = this.parseVoiceSnapshot(channelSnapshot.values[VOICE_STATE_KEY]);
    this.patch({ voiceSeats: voiceSnapshot.seats, revision: voiceSnapshot.revision });
    return voiceSnapshot;
  }

  private applyVoiceSnapshot(serialized: string | undefined): void {
    const snapshot = this.parseVoiceSnapshot(serialized);
    if (snapshot.revision >= this.state.revision) {
      this.patch({ voiceSeats: snapshot.seats, revision: snapshot.revision });
    }
  }

  private parseVoiceSnapshot(serialized: string | undefined): VoiceSnapshot {
    if (!serialized) return { revision: 0, seats: {} };
    try {
      const value = JSON.parse(serialized) as Partial<VoiceSnapshot>;
      if (typeof value.revision !== 'number' || typeof value.seats !== 'object' || value.seats === null) {
        return { revision: 0, seats: {} };
      }
      return { revision: value.revision, seats: value.seats as Record<string, VoiceSeat> };
    } catch {
      return { revision: 0, seats: {} };
    }
  }

  private async executeVoiceAction(actionId: string): Promise<void> {
    const simpleMessages: Record<string, string> = {
      'raise-hand': 'mic.request',
      'reject-seat': 'mic.reject',
    };
    if (simpleMessages[actionId]) {
      await this.publishVoice(simpleMessages[actionId], { seatId: 'seat-1' });
      const selectedAction = this.scenario.actions.find((action) => action.id === actionId)!;
      this.patch({ status: selectedAction.nextStatus });
      this.addEvent('sent', `${selectedAction.label}：消息已广播`);
      return;
    }

    if (actionId === 'approve-seat') {
      await this.mutateSeat('mic.accept', (seats) => ({
        ...seats,
        'seat-1': { userId: this.settings.targetUserId || this.firstRemoteUser(), muted: false },
      }));
    } else if (actionId === 'mute-seat') {
      await this.mutateSeat('mic.mute', (seats) => ({
        ...seats,
        'seat-1': {
          userId: seats['seat-1']?.userId || this.settings.targetUserId || this.firstRemoteUser(),
          muted: true,
        },
      }));
    } else if (actionId === 'leave-seat') {
      await this.mutateSeat('mic.leave', (seats) => {
        const next = { ...seats };
        delete next['seat-1'];
        return next;
      });
    }
  }

  private async mutateSeat(
    eventType: string,
    mutate: (seats: Record<string, VoiceSeat>) => Record<string, VoiceSeat>,
  ): Promise<void> {
    const lockName = 'seat-1';
    let acquired = false;
    try {
      await this.port.acquireLock(this.settings.channelId, lockName);
      acquired = true;
      const channelSnapshot = await this.port.getChannelMetadata(this.settings.channelId);
      const current = this.parseVoiceSnapshot(channelSnapshot.values[VOICE_STATE_KEY]);
      const next: VoiceSnapshot = { revision: current.revision + 1, seats: mutate(current.seats) };
      await this.port.setChannelMetadata(
        this.settings.channelId,
        VOICE_STATE_KEY,
        JSON.stringify(next),
        { majorRevision: channelSnapshot.revision, lockName },
      );
      this.patch({ voiceSeats: next.seats, revision: next.revision });
      await this.publishVoice(eventType, { seatId: lockName, snapshotRevision: next.revision });
      const action = this.scenario.actions.find((item) =>
        (eventType === 'mic.accept' && item.id === 'approve-seat') ||
        (eventType === 'mic.mute' && item.id === 'mute-seat') ||
        (eventType === 'mic.leave' && item.id === 'leave-seat'),
      );
      if (action) this.patch({ status: action.nextStatus });
      this.addEvent('ack', `麦位快照已提交（revision ${next.revision}）`);
    } catch {
      await this.refreshVoiceSnapshot();
      this.addEvent('error', '麦位正在被其他用户修改，已刷新最新状态');
    } finally {
      if (acquired) await this.port.releaseLock(this.settings.channelId, lockName);
    }
  }

  private async publishVoice(type: string, payload: Record<string, unknown>): Promise<void> {
    const envelope = createEnvelope({
      sceneId: this.scenario.id,
      type,
      senderId: this.settings.userId,
      targetId: this.settings.targetUserId || undefined,
      channelId: this.settings.channelId,
      requiresAck: false,
      payload,
    });
    await this.port.publishChannel(this.settings.channelId, JSON.stringify(envelope));
  }

  private async executeDeviceAction(actionId: string, label: string, nextStatus: string): Promise<void> {
    if (this.roleId === 'device') {
      this.addEvent('error', '设备端等待控制端下发指令');
      return;
    }
    const targetUserId = this.settings.targetUserId;
    if (!targetUserId) {
      this.addEvent('error', '请在连接设置中填写 Target User ID');
      return;
    }
    if (!this.state.onlineUsers.includes(targetUserId)) {
      this.addEvent('error', '目标设备当前不在线');
      return;
    }

    const envelope = createEnvelope({
      sceneId: this.scenario.id,
      type: 'device.command',
      senderId: this.settings.userId,
      targetId: targetUserId,
      channelId: this.settings.channelId,
      requiresAck: true,
      payload: { actionId, nextStatus },
    });
    const command: DeviceCommand = {
      messageId: envelope.messageId,
      actionId,
      label,
      status: 'SENT',
      sentAt: envelope.sentAt,
    };
    this.patch({ commands: [command, ...this.state.commands], status: '等待设备 ACK' });
    await this.port.publishUser(targetUserId, JSON.stringify(envelope));
    this.addEvent('sent', `${label}：指令已发送给 ${targetUserId}`);
    this.ackTimers.set(
      envelope.messageId,
      setTimeout(() => this.timeoutCommand(envelope.messageId), this.ackTimeoutMs),
    );
  }

  private async handleMessage(serialized: string): Promise<void> {
    let envelope: RtmEnvelope;
    try {
      envelope = parseEnvelope(serialized);
    } catch (error) {
      this.addEvent('error', error instanceof Error ? error.message : '无法解析 RTM 消息');
      return;
    }
    if (envelope.sceneId !== this.scenario.id) return;
    if (!this.deduper.accept(envelope.messageId)) {
      this.addEvent('received', `重复消息已忽略：${envelope.messageId.slice(0, 8)}`);
      return;
    }

    if (this.scenario.id === 'device-control' && envelope.type === 'device.command' && this.roleId === 'device') {
      await this.handleDeviceCommand(envelope);
    } else if (this.scenario.id === 'device-control' && envelope.type === 'device.ack' && this.roleId === 'controller') {
      this.handleDeviceAck(envelope);
    } else if (this.scenario.id === 'voice-room-seats') {
      this.addEvent('received', `收到房间事件：${envelope.type}`);
      if (envelope.type === 'mic.request') this.patch({ status: '收到上麦申请' });
    }
  }

  private async handleDeviceCommand(envelope: RtmEnvelope): Promise<void> {
    await this.sendDeviceAck(envelope, 'RECEIVED');
    const nextStatus = typeof envelope.payload.nextStatus === 'string' ? envelope.payload.nextStatus : '指令已执行';
    this.patch({ status: nextStatus, revision: this.state.revision + 1 });
    this.addEvent('received', `收到设备指令：${String(envelope.payload.actionId ?? '')}`);
    await this.sendDeviceAck(envelope, 'EXECUTED', nextStatus);
  }

  private async sendDeviceAck(command: RtmEnvelope, status: 'RECEIVED' | 'EXECUTED', resultingState?: string) {
    const ack = createEnvelope({
      sceneId: this.scenario.id,
      type: 'device.ack',
      senderId: this.settings.userId,
      targetId: command.senderId,
      channelId: this.settings.channelId,
      requiresAck: false,
      payload: { commandId: command.messageId, status, resultingState },
    });
    await this.port.publishUser(command.senderId, JSON.stringify(ack));
    this.addEvent('ack', `${status} ACK 已返回控制端`);
  }

  private handleDeviceAck(envelope: RtmEnvelope): void {
    const commandId = typeof envelope.payload.commandId === 'string' ? envelope.payload.commandId : '';
    const status = envelope.payload.status;
    if (status !== 'RECEIVED' && status !== 'EXECUTED') return;
    const ackStatus: DeviceCommandStatus = status;
    const commands: DeviceCommand[] = this.state.commands.map((command) =>
      command.messageId === commandId ? { ...command, status: ackStatus } : command,
    );
    const patch: Partial<RealScenarioState> = { commands };
    if (ackStatus === 'EXECUTED') {
      const resultingState = envelope.payload.resultingState;
      if (typeof resultingState === 'string') patch.status = resultingState;
      const timer = this.ackTimers.get(commandId);
      if (timer) clearTimeout(timer);
      this.ackTimers.delete(commandId);
    }
    this.patch(patch);
    this.addEvent('ack', `收到设备 ${ackStatus} ACK`);
  }

  private timeoutCommand(messageId: string): void {
    const commands = this.state.commands.map((command) =>
      command.messageId === messageId && command.status !== 'EXECUTED'
        ? { ...command, status: 'TIMED_OUT' as const }
        : command,
    );
    this.ackTimers.delete(messageId);
    this.patch({ commands, status: '设备 ACK 超时' });
    this.addEvent('error', '设备未在时限内返回 EXECUTED ACK，可重新发送');
  }

  private firstRemoteUser(): string {
    return this.state.onlineUsers.find((userId) => userId !== this.settings.userId) ?? 'audience-1';
  }

  private addEvent(kind: TimelineEvent['kind'], text: string): void {
    this.patch({
      events: [
        ...this.state.events,
        { id: crypto.randomUUID(), kind, text, timestamp: Date.now() },
      ],
    });
  }

  private patch(next: Partial<RealScenarioState>): void {
    this.state = { ...this.state, ...next };
    this.listeners.forEach((listener) => listener(this.state));
  }

  private clearTimers(): void {
    this.ackTimers.forEach((timer) => clearTimeout(timer));
    this.ackTimers.clear();
  }
}

export function createRealScenarioRuntime(options: RealScenarioRuntimeOptions): RealScenarioRuntime {
  return new RealScenarioRuntime(options);
}
