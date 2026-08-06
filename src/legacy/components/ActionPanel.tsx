import { AlertTriangle, ArrowUpRight, Play, Send, ShieldCheck, Square } from 'lucide-react';
import type { ScenarioAction } from '../domain/scenario';

interface ActionPanelProps {
  actions: ScenarioAction[];
  onAction: (actionId: string) => void;
  disabled?: boolean;
}

function ActionIcon({ id }: { id: string }) {
  if (id.includes('send') || id.includes('invite') || id === 'dispatch') return <Send size={17} />;
  if (id.includes('alert') || id.includes('report')) return <AlertTriangle size={17} />;
  if (id.includes('end') || id.includes('stop') || id.includes('remove')) return <Square size={17} />;
  if (id.includes('accept') || id.includes('approve') || id.includes('resolve')) return <ShieldCheck size={17} />;
  if (id.includes('join') || id.includes('online') || id.includes('raise')) return <ArrowUpRight size={17} />;
  return <Play size={17} />;
}

export function ActionPanel({ actions, onAction, disabled = false }: ActionPanelProps) {
  return (
    <section className="action-panel" aria-labelledby="action-heading">
      <div className="panel-heading">
        <div>
          <span>CONTROL</span>
          <h2 id="action-heading">场景操作</h2>
        </div>
      </div>
      <div className="action-list">
        {actions.map((action) => (
          <button
            key={action.id}
            className={action.tone === 'danger' ? 'action-button action-button--danger' : 'action-button'}
            onClick={() => onAction(action.id)}
            disabled={disabled}
          >
            <ActionIcon id={action.id} />
            <span>{action.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
