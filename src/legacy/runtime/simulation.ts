import type { ScenarioDefinition, TimelineEvent } from '../domain/scenario';

export interface SimulationSession {
  sceneId: string;
  roleId: string;
  status: string;
  revision: number;
  events: TimelineEvent[];
  lastActionId?: string;
}

export type SimulationCommand =
  | { type: 'execute'; actionId: string }
  | { type: 'role'; roleId: string }
  | { type: 'reset' };

export function createSimulationSession(scenario: ScenarioDefinition): SimulationSession {
  return {
    sceneId: scenario.id,
    roleId: scenario.roles[0].id,
    status: scenario.initialStatus,
    revision: 0,
    events: [],
  };
}

export function reduceSimulation(
  session: SimulationSession,
  command: SimulationCommand,
  scenario: ScenarioDefinition,
): SimulationSession {
  if (command.type === 'reset') {
    return {
      ...createSimulationSession(scenario),
      roleId: session.roleId,
    };
  }

  if (command.type === 'role') {
    if (!scenario.roles.some((role) => role.id === command.roleId)) return session;
    return { ...session, roleId: command.roleId };
  }

  const selectedAction = scenario.actions.find((action) => action.id === command.actionId);
  if (!selectedAction) return session;

  const event: TimelineEvent = {
    id: crypto.randomUUID(),
    kind: 'state',
    text: `${selectedAction.label}：${selectedAction.eventText}`,
    timestamp: Date.now(),
  };

  return {
    ...session,
    status: selectedAction.nextStatus,
    revision: session.revision + 1,
    lastActionId: selectedAction.id,
    events: [...session.events, event],
  };
}
