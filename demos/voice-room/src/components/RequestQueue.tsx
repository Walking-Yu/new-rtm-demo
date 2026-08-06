import { Check, Send, UserMinus, X } from 'lucide-react';
import type { EndpointRole, SeatInvitation, SeatRequest, SeatState } from '../domain/types';
import type { VoiceRoomCommand } from '../runtime/VoiceRoomClient';

interface RequestQueueProps {
  role: EndpointRole;
  ownUserId: string;
  peerUserId: string;
  peerDisplayName: string;
  seats: Record<string, SeatState>;
  selectedSeatId: string;
  queue: SeatRequest[];
  invitation: SeatInvitation | null;
  disabled: boolean;
  onCommand: (command: VoiceRoomCommand) => void;
}

export function RequestQueue({
  role,
  ownUserId,
  peerUserId,
  peerDisplayName,
  seats,
  selectedSeatId,
  queue,
  invitation,
  disabled,
  onCommand,
}: RequestQueueProps) {
  const ownRequest = queue.find((request) => request.userId === ownUserId);
  const ownInvitation = invitation?.userId === ownUserId ? invitation : null;
  const selectedAvailable = seats[selectedSeatId]?.status === 'empty';

  if (role === 'host') {
    return (
      <section className="control-section" aria-labelledby="queue-heading">
        <div className="section-heading"><span>SEAT FLOW</span><h3 id="queue-heading">排麦与邀请</h3></div>
        <button
          className="secondary-button full-button"
          type="button"
          disabled={disabled || !selectedAvailable || Boolean(invitation)}
          onClick={() => onCommand({
            type: 'seat.invite', userId: peerUserId, displayName: peerDisplayName, seatId: selectedSeatId,
          })}
        >
          <Send aria-hidden="true" size={15} />邀请{peerDisplayName}上麦
        </button>
        <div className="request-list">
          {queue.length === 0 && <p className="empty-copy">暂无排麦申请</p>}
          {queue.map((request) => (
            <article className="request-row" key={request.id}>
              <div><strong>{request.displayName}</strong><span>{Number(request.seatId.replace('seat-', '')) + 1} 号麦位</span></div>
              <div>
                <button
                  type="button"
                  className="approve-button"
                  aria-label={`同意${request.displayName}上麦`}
                  onClick={() => onCommand({ type: 'seat.request.approve', requestId: request.id })}
                  disabled={disabled}
                ><Check aria-hidden="true" size={14} /></button>
                <button
                  type="button"
                  className="reject-button"
                  aria-label={`拒绝${request.displayName}上麦`}
                  onClick={() => onCommand({ type: 'seat.request.reject', requestId: request.id })}
                  disabled={disabled}
                ><X aria-hidden="true" size={14} /></button>
              </div>
            </article>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="control-section" aria-labelledby="request-heading">
      <div className="section-heading"><span>SEAT FLOW</span><h3 id="request-heading">我的上麦</h3></div>
      {ownInvitation && (
        <div className="invitation-banner">
          <p>房主邀请你进入 {Number(ownInvitation.seatId.replace('seat-', '')) + 1} 号麦位</p>
          <div>
            <button
              className="approve-button text-button"
              type="button"
              aria-label="接受上麦邀请"
              onClick={() => onCommand({ type: 'seat.invite.accept' })}
              disabled={disabled}
            ><Check aria-hidden="true" size={14} />接受</button>
            <button
              className="reject-button text-button"
              type="button"
              aria-label="拒绝上麦邀请"
              onClick={() => onCommand({ type: 'seat.invite.reject' })}
              disabled={disabled}
            ><X aria-hidden="true" size={14} />拒绝</button>
          </div>
        </div>
      )}
      <button
        className="secondary-button full-button"
        type="button"
        disabled={disabled || (!ownRequest && !selectedAvailable)}
        onClick={() => onCommand(ownRequest
          ? { type: 'seat.request.cancel' }
          : { type: 'seat.request', seatId: selectedSeatId })}
      >
        {ownRequest ? <UserMinus aria-hidden="true" size={15} /> : <Send aria-hidden="true" size={15} />}
        {ownRequest ? '取消排麦' : '申请上麦'}
      </button>
    </section>
  );
}
