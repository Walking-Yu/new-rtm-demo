import { Check, Clock3, MapPin, Navigation, PackageCheck, Radio, UserRound } from 'lucide-react';
import type { CanvasProps } from './types';

const steps = ['订单创建', '调度派单', '司机接单', '服务完成'];

export function OrderCanvas({ session }: CanvasProps) {
  const progress = session.status === '待派单' ? 0 : session.status === '待接单' ? 1 : session.status === '服务中' ? 2 : 3;
  return (
    <div className="canvas-view order-view" aria-label="订单状态">
      <section className="order-map">
        <div className="map-grid" aria-hidden="true" />
        <div className="map-route" aria-hidden="true"><i /><i /><i /></div>
        <span className="map-origin"><MapPin size={17} />静安寺站</span>
        <span className="map-destination"><Navigation size={17} />徐家汇中心</span>
        <div className="vehicle-marker"><Radio size={18} /></div>
        <div className="order-summary">
          <span>ORDER #RTM-2048</span>
          <strong>{session.status}</strong>
          <small><Clock3 size={13} />预计 18 分钟</small>
        </div>
      </section>
      <section className="order-progress">
        <div className="assignee-row"><span><UserRound size={18} /></span><div><small>当前执行人</small><strong>{progress >= 2 ? '司机 · 陈师傅' : '等待司机接单'}</strong></div></div>
        <ol>
          {steps.map((step, index) => (
            <li className={index <= progress ? 'is-complete' : ''} key={step}>
              <span>{index < progress ? <Check size={14} /> : index === 3 ? <PackageCheck size={14} /> : index + 1}</span>
              <div><strong>{step}</strong><small>{index <= progress ? '状态已同步' : '等待上一步完成'}</small></div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
