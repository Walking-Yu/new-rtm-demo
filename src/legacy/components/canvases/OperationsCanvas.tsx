import { AlertTriangle, CheckCircle2, Factory, MapPin, Radio, ShieldCheck, UserCheck } from 'lucide-react';
import type { CanvasProps } from './types';

export function OperationsCanvas({ session }: CanvasProps) {
  const alerting = session.status.includes('告警');
  const resolved = session.status.includes('恢复');
  return (
    <div className="canvas-view operations-view" aria-label="现场状态">
      <section className="site-overview">
        <header><div><Factory size={18} /><strong>园区 A · 设备总览</strong></div><span><Radio size={14} />12 个节点在线</span></header>
        <div className="site-grid">
          {['A1 仓储', 'A2 产线', 'A3 装配', 'A4 出入口', 'B1 配电', 'B2 消防'].map((zone, index) => (
            <div className={alerting && index === 2 ? 'site-node site-node--alert' : 'site-node'} key={zone}>
              {alerting && index === 2 ? <AlertTriangle size={18} /> : <ShieldCheck size={18} />}
              <strong>{zone}</strong>
              <small>{alerting && index === 2 ? '温度异常' : '运行正常'}</small>
            </div>
          ))}
        </div>
      </section>
      <aside className="incident-panel">
        <div className="incident-state">
          <span className={alerting ? 'severity-dot severity-dot--high' : 'severity-dot'} />
          <div><small>CURRENT STATUS</small><strong>{session.status}</strong></div>
        </div>
        <div className="incident-facts">
          <span><MapPin size={15} />A3 装配区域</span>
          <span><UserCheck size={15} />{session.status.includes('处理') ? '王工处理中' : '等待分派'}</span>
          <span><CheckCircle2 size={15} />{resolved ? '处置闭环完成' : '事件流持续同步'}</span>
        </div>
        <div className="incident-log"><i /><div><strong>实时事件已接入</strong><span>告警、任务和结果共用 traceId</span></div></div>
      </aside>
    </div>
  );
}
