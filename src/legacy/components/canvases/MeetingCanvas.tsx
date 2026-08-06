import { Hand, Mic, MonitorUp, Radio, Users } from 'lucide-react';
import type { CanvasProps } from './types';

export function MeetingCanvas({ session }: CanvasProps) {
  const sharing = session.status.includes('共享');
  return (
    <div className="canvas-view meeting-view" aria-label="会议状态">
      <div className="meeting-toolbar">
        <span><Radio size={14} />周会 · meeting-1</span>
        <strong>{session.status}</strong>
        <span><Users size={14} />6 人参会</span>
      </div>
      <div className={`meeting-grid ${sharing ? 'meeting-grid--sharing' : ''}`}>
        {sharing && <div className="share-surface"><MonitorUp size={32} /><strong>产品路线图.pdf</strong><span>主持人正在共享屏幕</span></div>}
        {['主持人', '周予安', '陈可', '李一诺'].map((name, index) => (
          <div className={`participant-tile ${index === 0 ? 'participant-tile--active' : ''}`} key={name}>
            <span className="participant-avatar">{name.slice(0, 1)}</span>
            <div><strong>{name}</strong><small>{index === 0 ? '正在发言' : '已入会'}</small></div>
            <Mic size={14} />
            {session.status.includes('举手') && index === 1 && <i><Hand size={13} />举手</i>}
          </div>
        ))}
      </div>
    </div>
  );
}
