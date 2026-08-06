import type { ScenarioDefinition } from '../../domain/scenario';
import type { SimulationSession } from '../../runtime/simulation';
import type { RealScenarioState } from '../../runtime/rtm/realScenarioRuntime';

export interface CanvasProps {
  scenario: ScenarioDefinition;
  session: SimulationSession;
  realState?: RealScenarioState | null;
}
