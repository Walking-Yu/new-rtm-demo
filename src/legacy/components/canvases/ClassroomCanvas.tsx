import { BarChart3, BookOpenCheck, Hand, MessageSquareText, Radio, Users } from 'lucide-react';
import type { CanvasProps } from './types';

export function ClassroomCanvas({ scenario, session }: CanvasProps) {
  const speaking = session.status.includes('发言') || session.status.includes('答题');
  return (
    <div className="canvas-view classroom-view" aria-label="课堂状态">
      <div className="teacher-stage">
        <div className="teacher-video">
          <span><Radio size={16} />LIVE CLASS</span>
          <div className="teacher-person"><strong>林老师</strong><small>主讲教师</small></div>
          <div className="lesson-board">
            <BookOpenCheck size={28} />
            <div><b>{scenario.title}</b><small>第 3 节 · 课堂互动</small></div>
          </div>
        </div>
        <div className="class-metrics">
          <div><Users size={17} /><span>在线学生</span><strong>32 / 34</strong></div>
          <div><Hand size={17} /><span>举手队列</span><strong>{session.status.includes('举手') ? 1 : 0}</strong></div>
          <div><BarChart3 size={17} /><span>参与率</span><strong>94%</strong></div>
        </div>
      </div>
      <aside className="student-panel">
        <div className="student-panel-title"><MessageSquareText size={16} /><strong>课堂成员</strong></div>
        {['陈可', '周予安', '王思远', '李一诺'].map((name, index) => (
          <div className={`student-row ${speaking && index === 0 ? 'student-row--active' : ''}`} key={name}>
            <span>{name.slice(0, 1)}</span>
            <div><strong>{name}</strong><small>{speaking && index === 0 ? '正在发言' : '听课中'}</small></div>
            {speaking && index === 0 && <i>LIVE</i>}
          </div>
        ))}
        <div className="class-prompt"><span>当前课堂状态</span><strong>{session.status}</strong></div>
      </aside>
    </div>
  );
}
