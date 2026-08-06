import { ArrowRight, Braces, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ScenarioDefinition } from '../domain/scenario';

export function CapabilityDrawer({ scenario }: { scenario: ScenarioDefinition }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  return (
    <>
      <button className="implementation-button" onClick={() => setOpen(true)}>
        <Braces size={17} />
        <span>RTM 如何实现</span>
        <ArrowRight size={16} />
      </button>
      {open && (
        <div className="drawer-layer">
          <button className="drawer-scrim" aria-label="关闭 RTM 实现" onClick={() => setOpen(false)} />
          <aside className="capability-drawer" role="dialog" aria-modal="true" aria-label="RTM 实现映射">
            <header>
              <div>
                <span>CAPABILITY MAP</span>
                <h2>RTM 实现映射</h2>
              </div>
              <button className="icon-button" aria-label="关闭" onClick={() => setOpen(false)}><X size={18} /></button>
            </header>
            <p>{scenario.summary}</p>
            <div className="capability-list">
              {scenario.actions.map((action) => (
                <div key={action.id}>
                  <strong>{action.label}</strong>
                  <span>{action.eventText}</span>
                  <ul>
                    {action.capabilities.map((capability) => <li key={capability}>{capability}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
