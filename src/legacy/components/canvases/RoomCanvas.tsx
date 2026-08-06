import { Crown, Gift, MessageCircle, Mic, MicOff, Radio, Users } from 'lucide-react';
import type { CanvasProps } from './types';

const seats = ['主持位', '1 号麦', '2 号麦', '3 号麦', '4 号麦', '5 号麦', '6 号麦', '7 号麦'];

export function RoomCanvas({ scenario, session, realState }: CanvasProps) {
  const realSeat = realState?.voiceSeats['seat-1'];
  const seatOneActive = Boolean(realSeat) || session.status.includes('1 号麦位');
  const isMuted = realSeat?.muted ?? session.status.includes('禁麦');
  const isLive = scenario.id.includes('live') || scenario.id.includes('voice') || scenario.id.includes('gaming');

  return (
    <div className="canvas-view room-view" aria-label="房间状态">
      <div className="room-stage">
        <div className="stage-signal"><Radio size={15} />{isLive ? '房间实时同步' : '会话进行中'}</div>
        <div className="host-avatar"><Crown size={20} /><span>HOST</span></div>
        <div>
          <strong>{scenario.roles[0].label}</strong>
          <span>房间控制端</span>
        </div>
        <div className="audio-meter" aria-hidden="true">
          <i /><i /><i /><i /><i />
        </div>
      </div>

      <div className="seat-grid">
        {seats.map((seat, index) => {
          const active = index === 0 || (index === 1 && seatOneActive);
          return (
            <div className={`seat ${active ? 'seat--active' : ''}`} key={seat} data-testid={`seat-${index}`}>
              <span className="seat-avatar">{active ? (isMuted && index === 1 ? <MicOff size={18} /> : <Mic size={18} />) : index}</span>
              <strong>{seat}</strong>
              <small>{active ? (isMuted && index === 1 ? '已禁麦' : '发言中') : '空闲'}</small>
            </div>
          );
        })}
      </div>

      <div className="room-footer">
        <span><Users size={15} />{realState ? `${realState.onlineUsers.length} 人在线` : '128 人在线'}</span>
        <span><MessageCircle size={15} />36 条互动</span>
        <span><Gift size={15} />礼物榜已同步</span>
        {scenario.id === 'voice-room-seats' && <b>RTC 媒体未接入</b>}
      </div>
    </div>
  );
}
