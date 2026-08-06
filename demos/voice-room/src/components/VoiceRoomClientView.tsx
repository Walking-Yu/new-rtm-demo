import {
  Ban,
  Circle,
  LogOut,
  Mic,
  MicOff,
  RadioTower,
  ShieldAlert,
  UserRoundX,
  Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { EndpointRole } from '../domain/types';
import type { ConnectionState } from '../runtime/ports/RtmPort';
import type { VoiceRoomClientState, VoiceRoomCommand } from '../runtime/VoiceRoomClient';
import { EventTimeline } from './EventTimeline';
import { InteractionPanel } from './InteractionPanel';
import { RequestQueue } from './RequestQueue';
import { SeatGrid } from './SeatGrid';

interface VoiceRoomClientViewProps {
  role: EndpointRole;
  displayName: string;
  userId: string;
  peerDisplayName: string;
  peerUserId: string;
  state: VoiceRoomClientState;
  shellDisabled?: boolean;
  onCommand: (command: VoiceRoomCommand) => void;
}

const stateLabels: Record<ConnectionState, string> = {
  disconnected: '未连接',
  connecting: '连接中',
  connected: '已连接',
  reconnecting: '重连中',
  failed: '失败',
};

function ConnectionBadge({ label, state }: { label: string; state: ConnectionState }) {
  return (
    <span className={`connection-badge connection-badge--${state}`}>
      <Circle aria-hidden="true" size={8} fill="currentColor" />
      <b>{label}</b>{stateLabels[state]}
    </span>
  );
}

export function VoiceRoomClientView({
  role,
  displayName,
  userId,
  peerDisplayName,
  peerUserId,
  state,
  shellDisabled = false,
  onCommand,
}: VoiceRoomClientViewProps) {
  const firstEmptySeat = useMemo(
    () => Object.values(state.snapshot.seats).find((seat) => seat.seatId !== 'seat-0' && seat.status === 'empty')?.seatId ?? 'seat-1',
    [state.snapshot.seats],
  );
  const [selectedSeatId, setSelectedSeatId] = useState(firstEmptySeat);
  const controlsDisabled = shellDisabled
    || state.hydrating
    || state.rtmState !== 'connected'
    || state.rtcState !== 'connected';
  const ownSeat = Object.values(state.snapshot.seats).find((seat) => seat.userId === userId);
  const audienceOnSeat = role === 'host'
    ? Object.values(state.snapshot.seats).find((seat) => seat.userId && seat.userId !== userId)
    : undefined;

  return (
    <section className={`endpoint-panel endpoint-panel--${role}`} role="region" aria-label={role === 'host' ? '房主端' : '听众端'}>
      <header className="endpoint-header">
        <div className={`endpoint-role-icon endpoint-role-icon--${role}`}>
          {role === 'host' ? <RadioTower aria-hidden="true" size={19} /> : <Users aria-hidden="true" size={19} />}
        </div>
        <div className="endpoint-identity">
          <span>{role === 'host' ? 'HOST CLIENT' : 'AUDIENCE CLIENT'}</span>
          <h2>{role === 'host' ? '房主端' : '听众端'} · {displayName}</h2>
          <code>{userId}</code>
        </div>
        <div className="connection-badges">
          <ConnectionBadge label="RTM" state={state.rtmState} />
          <ConnectionBadge label="RTC" state={state.rtcState} />
        </div>
      </header>

      <div className="room-summary">
        <p><strong>{state.snapshot.announcement}</strong><span>房间公告</span></p>
        <p><strong>{state.onlineUsers.length}</strong><span>在线成员</span></p>
        <p><strong>{state.snapshot.revision}</strong><span>状态版本</span></p>
      </div>

      {state.exitReason && (
        <div className="exit-banner" role="alert">
          <ShieldAlert aria-hidden="true" size={16} />
          {state.exitReason === 'banned' ? '该客户端已被封禁并断开连接' : '该客户端已被房主踢出'}
        </div>
      )}

      <section className="room-stage" aria-labelledby={`${role}-seat-heading`}>
        <div className="section-heading"><span>RTC AUDIO + RTM STORAGE</span><h3 id={`${role}-seat-heading`}>麦位状态</h3></div>
        <SeatGrid
          role={role}
          ownUserId={userId}
          seats={state.snapshot.seats}
          selectedSeatId={selectedSeatId}
          volumeLevels={state.volumeLevels}
          disabled={controlsDisabled}
          onSelect={setSelectedSeatId}
          onCommand={onCommand}
        />
        {role === 'audience' && ownSeat && ownSeat.seatId !== 'seat-0' && ['active', 'muted'].includes(ownSeat.status) && (
          <div className="self-seat-controls">
            <button
              className="secondary-button"
              type="button"
              disabled={controlsDisabled}
              onClick={() => onCommand({ type: 'seat.mute', muted: !ownSeat.muted })}
            >
              {ownSeat.muted ? <Mic aria-hidden="true" size={15} /> : <MicOff aria-hidden="true" size={15} />}
              {ownSeat.muted ? '解除静音' : '静音'}
            </button>
            <button
              className="danger-button"
              type="button"
              disabled={controlsDisabled}
              onClick={() => onCommand({ type: 'seat.leave' })}
            ><LogOut aria-hidden="true" size={15} />下麦</button>
          </div>
        )}
      </section>

      <div className="endpoint-control-grid">
        <RequestQueue
          role={role}
          ownUserId={userId}
          peerUserId={peerUserId}
          peerDisplayName={peerDisplayName}
          seats={state.snapshot.seats}
          selectedSeatId={selectedSeatId}
          queue={state.snapshot.queue}
          invitation={state.snapshot.invitation}
          disabled={controlsDisabled}
          onCommand={onCommand}
        />
        {role === 'host' && (
          <section className="control-section governance-section" aria-labelledby="governance-heading">
            <div className="section-heading"><span>COOPERATIVE DEMO</span><h3 id="governance-heading">房间治理</h3></div>
            <div className="governance-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={controlsDisabled || !audienceOnSeat}
                onClick={() => onCommand({ type: 'seat.leave', userId: peerUserId })}
              ><UserRoundX aria-hidden="true" size={15} />强制下麦</button>
              <button
                type="button"
                className="danger-button"
                disabled={controlsDisabled}
                onClick={() => onCommand({ type: 'member.kick', userId: peerUserId })}
              ><UserRoundX aria-hidden="true" size={15} />踢出</button>
              <button
                type="button"
                className="danger-button"
                disabled={controlsDisabled}
                onClick={() => onCommand({ type: 'member.ban', userId: peerUserId })}
              ><Ban aria-hidden="true" size={15} />封禁</button>
            </div>
          </section>
        )}
      </div>

      <InteractionPanel
        role={role}
        announcement={state.snapshot.announcement}
        interactions={state.interactions}
        disabled={controlsDisabled}
        onCommand={onCommand}
      />
      <EventTimeline events={state.events} />
    </section>
  );
}
