import { LockKeyhole, Mic, Phone, PhoneCall, ShieldCheck, Signal } from 'lucide-react';
import type { CanvasProps } from './types';

export function CallCanvas({ scenario, session }: CanvasProps) {
  const connected = session.status.includes('通话') || session.status.includes('问诊');
  return (
    <div className="canvas-view call-view" aria-label="通话状态">
      <div className="call-security"><ShieldCheck size={15} />信令链路已保护</div>
      <div className="call-participants">
        <div className="caller-card"><span>{scenario.roles[0].label.slice(0, 1)}</span><strong>{scenario.roles[0].label}</strong><small>user-a</small></div>
        <div className="call-link"><i /><div><Signal size={20} /><strong>{session.status}</strong><small>{connected ? '00:42' : '等待会话建立'}</small></div><i /></div>
        <div className="caller-card"><span>{scenario.roles[1].label.slice(0, 1)}</span><strong>{scenario.roles[1].label}</strong><small>user-b</small></div>
      </div>
      <div className="call-controls">
        <span><Mic size={17} />麦克风</span>
        <b><PhoneCall size={20} /></b>
        <span><Phone size={17} />通话事件</span>
      </div>
      <div className="privacy-note"><LockKeyhole size={15} />业务身份映射由应用服务管理，RTM 只承载会话事件。</div>
    </div>
  );
}
