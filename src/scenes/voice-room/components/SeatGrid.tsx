/**
 * 麦位网格。
 *
 * 布局数值由 spec 定（4 列、方框最小高度 76px、头像 26px），写在 `styles.css` 里，
 * **不要在组件里用内联样式覆盖** —— 用户已两轮确认过这些数值。
 *
 * 「上麦中」这个状态必须显示出来：它是「麦位激活由媒体结果驱动」的可见证据 ——
 * 房主同意后麦位先进 joining，听众端发布麦克风成功才转 active。
 */

import { Crown, Mic, MicOff, UserRound, Volume2 } from 'lucide-react';
import type { SeatState } from '../state';
import { seatNumber } from './actions';

interface SeatGridProps {
  role: 'host' | 'audience';
  ownUserId: string;
  seats: Record<string, SeatState>;
  selectedSeatId: string;
  volumes: Readonly<Record<string, number>>;
  disabled: boolean;
  onSelect: (seatId: string) => void;
  onForceMute: (userId: string, muted: boolean) => void;
  onForceLeave: (userId: string) => void;
}

/** 说话高亮阈值。与编排层的 `isSpeaking` 同一个数，改要一起改。 */
const SPEAKING_THRESHOLD = 30;

const STATUS_LABELS: Record<SeatState['status'], string> = {
  empty: '可选择',
  joining: '上麦中',
  active: '在麦',
  muted: '已静音',
};

export function SeatGrid({
  role,
  ownUserId,
  seats,
  selectedSeatId,
  volumes,
  disabled,
  onSelect,
  onForceMute,
  onForceLeave,
}: SeatGridProps) {
  const orderedSeats = Object.values(seats).sort((left, right) =>
    left.seatId.localeCompare(right.seatId),
  );

  return (
    <div className="vr-seats" aria-label={`${orderedSeats.length} 个麦位`}>
      {orderedSeats.map((seat) => {
        const occupied = Boolean(seat.userId);
        const speaking = seat.userId ? (volumes[seat.userId] ?? 0) > SPEAKING_THRESHOLD : false;
        const isHostSeat = seat.seatId === 'seat-0';
        // 房主只能治理别人，不能治理自己 —— 自己下麦走「我的麦位」那条路。
        const canGovern = role === 'host' && occupied && seat.userId !== ownUserId;

        return (
          <article
            className="vr-seat"
            data-testid={seat.seatId}
            data-status={seat.status}
            data-selected={selectedSeatId === seat.seatId ? 'true' : 'false'}
            data-speaking={speaking ? 'true' : 'false'}
            key={seat.seatId}
          >
            <button
              className="vr-seat__select"
              type="button"
              disabled={disabled || occupied || isHostSeat}
              onClick={() => onSelect(seat.seatId)}
              aria-label={
                occupied
                  ? `${seat.displayName ?? seat.userId} 在 ${seatNumber(seat.seatId)} 号麦位`
                  : `选择 ${seatNumber(seat.seatId)} 号麦位`
              }
            >
              <span className="vr-seat__avatar">
                {isHostSeat ? (
                  <Crown aria-hidden="true" size={14} />
                ) : occupied ? (
                  <UserRound aria-hidden="true" size={14} />
                ) : (
                  <span>{seatNumber(seat.seatId)}</span>
                )}
              </span>
              <strong>{seat.displayName ?? (isHostSeat ? '主持位' : '空麦位')}</strong>
              <span className="vr-seat__status">
                {seat.status === 'muted' ? (
                  <MicOff aria-hidden="true" size={10} />
                ) : occupied && seat.status === 'active' ? (
                  <Volume2 aria-hidden="true" size={10} />
                ) : null}
                {STATUS_LABELS[seat.status]}
              </span>
            </button>

            {canGovern && seat.userId && (
              <div className="vr-seat__governance">
                <button
                  type="button"
                  disabled={disabled}
                  title={seat.muted ? '解除成员静音' : '将成员静音'}
                  aria-label={
                    seat.muted
                      ? `解除 ${seat.displayName ?? seat.userId} 静音`
                      : `将 ${seat.displayName ?? seat.userId} 静音`
                  }
                  onClick={() => onForceMute(seat.userId as string, !seat.muted)}
                >
                  {seat.muted ? (
                    <Mic aria-hidden="true" size={12} />
                  ) : (
                    <MicOff aria-hidden="true" size={12} />
                  )}
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  title="强制下麦"
                  aria-label={`强制 ${seat.displayName ?? seat.userId} 下麦`}
                  onClick={() => onForceLeave(seat.userId as string)}
                >
                  <UserRound aria-hidden="true" size={12} />
                </button>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
