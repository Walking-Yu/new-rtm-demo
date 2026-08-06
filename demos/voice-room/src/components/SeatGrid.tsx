import { Crown, Mic, MicOff, UserRound, UserRoundX, Volume2 } from 'lucide-react';
import type { EndpointRole, SeatState } from '../domain/types';
import type { VoiceRoomCommand } from '../runtime/VoiceRoomClient';

interface SeatGridProps {
  role: EndpointRole;
  ownUserId: string;
  seats: Record<string, SeatState>;
  selectedSeatId: string;
  volumeLevels: Record<string, number>;
  disabled: boolean;
  onSelect: (seatId: string) => void;
  onCommand: (command: VoiceRoomCommand) => void;
}

function seatNumber(seatId: string): number {
  return Number(seatId.replace('seat-', '')) + 1;
}

export function SeatGrid({
  role,
  ownUserId,
  seats,
  selectedSeatId,
  volumeLevels,
  disabled,
  onSelect,
  onCommand,
}: SeatGridProps) {
  const orderedSeats = Object.values(seats).sort((left, right) => left.seatId.localeCompare(right.seatId));
  return (
    <div className="seat-grid" aria-label={`${orderedSeats.length} 个麦位`}>
      {orderedSeats.map((seat) => {
        const occupied = Boolean(seat.userId);
        const speaking = seat.userId ? (volumeLevels[seat.userId] ?? 0) > 30 : false;
        const selected = selectedSeatId === seat.seatId;
        const isHostSeat = seat.seatId === 'seat-0';
        const canGovern = role === 'host' && occupied && seat.userId !== ownUserId;
        return (
          <article
            className={`seat ${selected ? 'seat--selected' : ''} ${speaking ? 'seat--speaking' : ''}`}
            data-testid={seat.seatId}
            key={seat.seatId}
          >
            <button
              className="seat-select"
              type="button"
              disabled={disabled || occupied || isHostSeat}
              onClick={() => onSelect(seat.seatId)}
              aria-label={occupied ? `${seat.displayName ?? seat.userId} 在 ${seatNumber(seat.seatId)} 号麦位` : `选择 ${seatNumber(seat.seatId)} 号麦位`}
            >
              <span className="seat-avatar">
                {isHostSeat ? <Crown aria-hidden="true" size={19} /> : occupied ? <UserRound aria-hidden="true" size={19} /> : <span>{seatNumber(seat.seatId)}</span>}
              </span>
              <strong>{seat.displayName ?? (isHostSeat ? '主持位' : '空麦位')}</strong>
              <span className={`seat-status seat-status--${seat.status}`}>
                {seat.status === 'muted' ? <MicOff aria-hidden="true" size={12} /> : occupied ? <Volume2 aria-hidden="true" size={12} /> : null}
                {seat.status === 'joining' ? '上麦中' : seat.status === 'muted' ? '已静音' : seat.status === 'active' ? '在麦' : '可选择'}
              </span>
            </button>
            {canGovern && (
              <div className="seat-governance">
                <button
                  type="button"
                  title={seat.muted ? '解除成员静音' : '将成员静音'}
                  aria-label={seat.muted ? `解除 ${seat.displayName ?? seat.userId} 静音` : `将 ${seat.displayName ?? seat.userId} 静音`}
                  onClick={() => onCommand({ type: 'seat.mute', userId: seat.userId, muted: !seat.muted })}
                >
                  {seat.muted ? <Mic aria-hidden="true" size={14} /> : <MicOff aria-hidden="true" size={14} />}
                </button>
                <button
                  type="button"
                  title="强制下麦"
                  aria-label={`强制 ${seat.displayName ?? seat.userId} 下麦`}
                  onClick={() => onCommand({ type: 'seat.leave', userId: seat.userId })}
                >
                  <UserRoundX aria-hidden="true" size={14} />
                </button>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
