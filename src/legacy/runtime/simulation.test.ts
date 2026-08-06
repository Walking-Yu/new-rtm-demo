import { describe, expect, it } from 'vitest';
import { getScenario } from '../domain/scenarioCatalog';
import { createSimulationSession, reduceSimulation } from './simulation';

describe('simulation runtime', () => {
  const orderScene = getScenario('dispatch-order')!;

  it('starts from the scenario definition and executes a declared action', () => {
    const session = createSimulationSession(orderScene);
    const offered = reduceSimulation(session, { type: 'execute', actionId: 'dispatch' }, orderScene);

    expect(session).toMatchObject({
      sceneId: 'dispatch-order',
      roleId: 'dispatcher',
      status: '待派单',
      revision: 0,
      events: [],
    });
    expect(offered.status).toBe('待接单');
    expect(offered.revision).toBe(1);
    expect(offered.events.at(-1)?.text).toContain('派单');
    expect(offered.events.at(-1)?.kind).toBe('state');
  });

  it('preserves shared state when switching role', () => {
    const offered = reduceSimulation(
      createSimulationSession(orderScene),
      { type: 'execute', actionId: 'dispatch' },
      orderScene,
    );
    const switched = reduceSimulation(offered, { type: 'role', roleId: 'driver' }, orderScene);

    expect(switched.roleId).toBe('driver');
    expect(switched.status).toBe('待接单');
    expect(switched.events).toEqual(offered.events);
  });

  it('resets state and ignores unknown actions', () => {
    const session = createSimulationSession(orderScene);
    expect(reduceSimulation(session, { type: 'execute', actionId: 'missing' }, orderScene)).toBe(session);

    const changed = reduceSimulation(session, { type: 'execute', actionId: 'dispatch' }, orderScene);
    const reset = reduceSimulation(changed, { type: 'reset' }, orderScene);
    expect(reset.status).toBe('待派单');
    expect(reset.revision).toBe(0);
    expect(reset.events).toEqual([]);
  });
});
