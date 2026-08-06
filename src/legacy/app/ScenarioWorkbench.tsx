import { RotateCcw } from 'lucide-react';
import { useEffect, useReducer, useRef, useState } from 'react';
import type { ScenarioDefinition } from '../domain/scenario';
import { scenarioGroups } from '../domain/scenarioCatalog';
import { createSimulationSession, reduceSimulation } from '../runtime/simulation';
import { ActionPanel } from '../components/ActionPanel';
import { AppShell } from '../components/AppShell';
import { CapabilityDrawer } from '../components/CapabilityDrawer';
import { EventTimeline } from '../components/EventTimeline';
import { RoleSwitcher } from '../components/RoleSwitcher';
import { ScenarioCanvas } from '../components/ScenarioCanvas';
import { TopBar } from '../components/TopBar';
import {
  ConnectionDialog,
  loadConnectionSettings,
  type ConnectionSettings,
} from '../components/ConnectionDialog';
import { createRealScenarioRuntime, type RealScenarioRuntime, type RealScenarioState } from '../runtime/rtm/realScenarioRuntime';

export function ScenarioWorkbench({ scenario }: { scenario: ScenarioDefinition }) {
  const [session, dispatch] = useReducer(
    (state: ReturnType<typeof createSimulationSession>, command: Parameters<typeof reduceSimulation>[1]) =>
      reduceSimulation(state, command, scenario),
    scenario,
    createSimulationSession,
  );
  const [mode, setMode] = useState<'simulation' | 'real'>('simulation');
  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false);
  const [connectionSettings, setConnectionSettings] = useState<ConnectionSettings | null>(() =>
    loadConnectionSettings(),
  );
  const [realState, setRealState] = useState<RealScenarioState | null>(null);
  const runtimeRef = useRef<RealScenarioRuntime | null>(null);
  const groupLabel = scenarioGroups.find((group) => group.id === scenario.groupId)?.label ?? '';

  useEffect(() => {
    if (mode !== 'real' || !connectionSettings || !scenario.supportsRealRtm) return;
    let cancelled = false;
    let runtime: RealScenarioRuntime | null = null;
    let unsubscribe: () => void = () => undefined;

    void import('../runtime/rtm/AgoraRtmAdapter').then(async ({ AgoraRtmAdapter }) => {
      if (cancelled) return;
      runtime = createRealScenarioRuntime({
        port: new AgoraRtmAdapter(),
        scenario,
        roleId: session.roleId,
        settings: connectionSettings,
      });
      runtimeRef.current = runtime;
      unsubscribe = runtime.subscribe(setRealState);
      try {
        await runtime.connect();
      } catch {
        // The runtime already exposes a normalized error in its event stream.
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
      if (runtime) {
        void runtime.disconnect().catch(() => undefined);
        runtime.destroy();
      }
      if (runtimeRef.current === runtime) runtimeRef.current = null;
    };
  }, [connectionSettings, mode, scenario, session.roleId]);

  const changeMode = (nextMode: 'simulation' | 'real') => {
    setMode(nextMode);
    if (nextMode === 'real' && !connectionSettings) setConnectionDialogOpen(true);
  };

  const visibleSession =
    mode === 'real' && realState
      ? {
          sceneId: scenario.id,
          roleId: session.roleId,
          status: realState.status,
          revision: realState.revision,
          events: realState.events,
        }
      : session;

  const executeAction = (actionId: string) => {
    if (mode === 'real') {
      void runtimeRef.current?.execute(actionId);
    } else {
      dispatch({ type: 'execute', actionId });
    }
  };

  return (
    <AppShell>
      {(openNavigation) => (
        <>
          <TopBar
            scenario={scenario}
            groupLabel={groupLabel}
            onOpenNavigation={openNavigation}
            onOpenConnection={() => setConnectionDialogOpen(true)}
            mode={mode}
            connectionState={realState?.connection ?? 'disconnected'}
            onModeChange={changeMode}
          />
          <div className="context-bar">
            <div>
              <span className="eyebrow">SCENARIO / {scenario.groupId.toUpperCase()}</span>
              <p>{scenario.summary}</p>
            </div>
            <RoleSwitcher
              roles={scenario.roles}
              value={visibleSession.roleId}
              onChange={(roleId) => dispatch({ type: 'role', roleId })}
            />
          </div>
          <div className="workbench">
            <div className="canvas-column">
              <section className="scene-canvas" aria-label="场景画布">
                <div className="canvas-toolbar">
                  <div>
                    <span>LIVE STATE</span>
                    <strong aria-label="当前状态">{visibleSession.status}</strong>
                  </div>
                  <button
                    className="icon-button"
                    aria-label="重置场景"
                    title="重置场景"
                    onClick={() => dispatch({ type: 'reset' })}
                    disabled={mode === 'real'}
                  >
                    <RotateCcw size={17} />
                  </button>
                </div>
                <ScenarioCanvas scenario={scenario} session={visibleSession} realState={mode === 'real' ? realState : null} />
              </section>
              <CapabilityDrawer scenario={scenario} />
            </div>
            <aside className="control-column" aria-label="场景控制台">
              <ActionPanel
                actions={scenario.actions}
                onAction={executeAction}
                disabled={mode === 'real' && (realState?.connection !== 'connected' || realState.hydrating)}
              />
              <EventTimeline events={visibleSession.events} />
            </aside>
          </div>
          <ConnectionDialog
            open={connectionDialogOpen}
            initial={connectionSettings}
            onClose={() => setConnectionDialogOpen(false)}
            onSave={(settings) => {
              setConnectionSettings(settings);
              setConnectionDialogOpen(false);
              setMode('real');
            }}
          />
        </>
      )}
    </AppShell>
  );
}
