import { describe, expect, it } from 'vitest';
import { allScenarios, getScenario, scenarioGroups } from './scenarioCatalog';

describe('scenario catalog', () => {
  it('contains the approved 8 groups and 24 unique routes', () => {
    expect(scenarioGroups).toHaveLength(8);
    expect(allScenarios).toHaveLength(24);
    expect(new Set(allScenarios.map((scenario) => scenario.id)).size).toBe(24);
  });

  it('covers all eight canvas families with complete interaction data', () => {
    expect(new Set(allScenarios.map((scenario) => scenario.canvas))).toEqual(
      new Set(['room', 'classroom', 'device', 'meeting', 'order', 'call', 'chat', 'operations']),
    );
    expect(allScenarios.every((scenario) => scenario.roles.length >= 2)).toBe(true);
    expect(
      allScenarios.every((scenario) => scenario.actions.length >= 3 && scenario.actions.length <= 6),
    ).toBe(true);
    expect(allScenarios.every((scenario) => scenario.summary.length > 0)).toBe(true);
    expect(allScenarios.every((scenario) => scenario.actions.every((action) => action.capabilities.length > 0))).toBe(
      true,
    );
  });

  it('enables real RTM only for voice seats and device control', () => {
    expect(allScenarios.filter((scenario) => scenario.supportsRealRtm).map((scenario) => scenario.id)).toEqual([
      'voice-room-seats',
      'device-control',
    ]);
  });

  it('looks up a scenario by its route id', () => {
    expect(getScenario('dispatch-order')?.title).toBe('派单与订单状态');
    expect(getScenario('missing')).toBeUndefined();
  });
});
