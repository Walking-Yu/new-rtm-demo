import { Menu, Radio, Settings2 } from 'lucide-react';
import type { ScenarioDefinition } from '../domain/scenario';
import type { RtmConnectionState } from '../runtime/rtm/RtmPort';

interface TopBarProps {
  scenario: ScenarioDefinition;
  groupLabel: string;
  onOpenNavigation: () => void;
  onOpenConnection?: () => void;
  mode: 'simulation' | 'real';
  connectionState: RtmConnectionState;
  onModeChange: (mode: 'simulation' | 'real') => void;
}

const connectionLabels: Record<RtmConnectionState, string> = {
  disconnected: '等待连接',
  connecting: '正在连接',
  connected: 'RTM 已连接',
  reconnecting: '正在重连',
  failed: '连接失败',
};

export function TopBar({
  scenario,
  groupLabel,
  onOpenNavigation,
  onOpenConnection,
  mode,
  connectionState,
  onModeChange,
}: TopBarProps) {
  return (
    <header className="topbar">
      <button className="icon-button mobile-menu" aria-label="打开场景导航" onClick={onOpenNavigation}>
        <Menu size={19} />
      </button>
      <div className="topbar-title">
        <span>{groupLabel}</span>
        <h1>{scenario.title}</h1>
      </div>
      <div className="topbar-tools">
        {scenario.supportsRealRtm && (
          <div className="runtime-switch" aria-label="运行模式">
            <button className={mode === 'simulation' ? 'is-active' : ''} onClick={() => onModeChange('simulation')}>模拟原型</button>
            <button className={mode === 'real' ? 'is-active' : ''} onClick={() => onModeChange('real')}>真实 RTM</button>
          </div>
        )}
        <div
          className={`connection-pill ${mode === 'real' ? `connection-pill--${connectionState}` : ''}`}
          aria-label={`连接状态：${mode === 'simulation' ? '模拟运行中' : connectionLabels[connectionState]}`}
        >
          <Radio size={14} />
          <span>{mode === 'simulation' ? '模拟运行中' : connectionLabels[connectionState]}</span>
        </div>
        <button
          className="icon-button"
          aria-label="连接设置"
          title="连接设置"
          onClick={onOpenConnection}
          disabled={!scenario.supportsRealRtm}
        >
          <Settings2 size={18} />
        </button>
      </div>
    </header>
  );
}
