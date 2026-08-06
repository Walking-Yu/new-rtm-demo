export type CanvasKind =
  | 'room'
  | 'classroom'
  | 'device'
  | 'meeting'
  | 'order'
  | 'call'
  | 'chat'
  | 'operations';

export type Capability = '用户消息' | '消息频道' | 'Presence' | 'Storage' | 'Lock';
export type EventKind = 'local' | 'sent' | 'received' | 'ack' | 'state' | 'connection' | 'error';

export interface ScenarioAction {
  id: string;
  label: string;
  nextStatus: string;
  eventText: string;
  capabilities: Capability[];
  tone?: 'default' | 'danger';
}

export interface ScenarioRole {
  id: string;
  label: string;
}

export interface ScenarioDefinition {
  id: string;
  groupId: string;
  title: string;
  summary: string;
  canvas: CanvasKind;
  roles: ScenarioRole[];
  initialStatus: string;
  actions: ScenarioAction[];
  supportsRealRtm?: boolean;
}

export interface ScenarioGroup {
  id: string;
  label: string;
  shortLabel: string;
  scenarios: ScenarioDefinition[];
}

export interface TimelineEvent {
  id: string;
  kind: EventKind;
  text: string;
  timestamp: number;
}
