import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CanvasKind } from '../domain/scenario';
import { getScenario } from '../domain/scenarioCatalog';
import { createSimulationSession } from '../runtime/simulation';
import { ScenarioCanvas } from './ScenarioCanvas';

const representatives: [string, CanvasKind, string][] = [
  ['voice-room-seats', 'room', '房间状态'],
  ['classroom-stage', 'classroom', '课堂状态'],
  ['device-control', 'device', '设备状态'],
  ['video-meeting', 'meeting', '会议状态'],
  ['dispatch-order', 'order', '订单状态'],
  ['one-to-one-call', 'call', '通话状态'],
  ['social-chat', 'chat', '消息与联系人'],
  ['field-operations', 'operations', '现场状态'],
];

describe('ScenarioCanvas', () => {
  it.each(representatives)('renders %s with the %s canvas', (sceneId, _canvas, label) => {
    const scenario = getScenario(sceneId)!;
    render(<ScenarioCanvas scenario={scenario} session={createSimulationSession(scenario)} />);

    expect(screen.getByLabelText(label)).toBeInTheDocument();
  });

  it('keeps eight stable voice-room seat positions', () => {
    const scenario = getScenario('voice-room-seats')!;
    render(<ScenarioCanvas scenario={scenario} session={createSimulationSession(scenario)} />);

    expect(screen.getAllByTestId(/^seat-/)).toHaveLength(8);
  });

  it('shows essential device telemetry', () => {
    const scenario = getScenario('device-control')!;
    render(<ScenarioCanvas scenario={scenario} session={createSimulationSession(scenario)} />);

    expect(screen.getByText('电源')).toBeInTheDocument();
    expect(screen.getByText('网络')).toBeInTheDocument();
    expect(screen.getByText('电量')).toBeInTheDocument();
    expect(screen.getByText('温度')).toBeInTheDocument();
  });
});
