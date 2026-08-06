import { BatteryMedium, Cpu, MapPin, Power, Signal, Thermometer, Wifi } from 'lucide-react';
import type { CanvasProps } from './types';

export function DeviceCanvas({ scenario, session, realState }: CanvasProps) {
  const powered = !session.status.includes('离线') && !session.status.includes('待机') && !session.status.includes('停止');
  return (
    <div className="canvas-view device-view" aria-label="设备状态">
      <section className="device-visual">
        <div className="device-network"><span>CONTROL</span><i /><i /><i /><span>DEVICE</span></div>
        <div className={`device-product ${powered ? 'device-product--active' : ''}`}>
          <div className="device-camera"><i /><span /></div>
          <div className="device-display"><Signal size={17} /><strong>{powered ? 'RUN' : 'IDLE'}</strong></div>
          <div className="device-base"><i /><i /></div>
        </div>
        <div className="device-identity">
          <span>DEVICE-0284</span>
          <strong>{scenario.id === 'device-control' ? '巡检终端' : '智能学习终端'}</strong>
          <small><MapPin size={13} />上海 · A3 区域</small>
        </div>
      </section>
      <section className="telemetry-panel">
        <div className="telemetry-heading"><Cpu size={17} /><div><span>TELEMETRY</span><strong>实时设备数据</strong></div></div>
        <div className="telemetry-grid">
          <div><Power size={17} /><span>电源</span><strong>{powered ? '运行' : '待机'}</strong></div>
          <div><Wifi size={17} /><span>网络</span><strong>42 ms</strong></div>
          <div><BatteryMedium size={17} /><span>电量</span><strong>82%</strong></div>
          <div><Thermometer size={17} /><span>温度</span><strong>36.4°C</strong></div>
        </div>
        <div className="command-receipt">
          <span>最近状态</span>
          <strong>{session.status}</strong>
          <small>{realState?.commands[0] ? `ACK ${realState.commands[0].status}` : `revision #${String(session.revision).padStart(3, '0')}`}</small>
        </div>
      </section>
    </div>
  );
}
