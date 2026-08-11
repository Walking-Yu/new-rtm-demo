/**
 * 角色专属面板：房主看审批列表，听众看自己的申请状态。
 *
 * 这是手机内区块顺序里的第四块（麦位网格之后、成员条之前）。
 */

import { Check, Send, UserMinus, X } from 'lucide-react';
import type { SeatInvitation, SeatRequest, SeatState } from '../state';
import { seatNumber } from './actions';

interface RolePanelProps {
  role: 'host' | 'audience';
  ownUserId: string;
  peerUserId: string;
  peerDisplayName: string;
  seats: Record<string, SeatState>;
  selectedSeatId: string;
  queue: readonly SeatRequest[];
  invitation: SeatInvitation | null;
  disabled: boolean;
  onApprove: (requestId: string) => void;
  onReject: (requestId: string) => void;
  onInvite: (seatId: string) => void;
  onRequestSeat: (seatId: string) => void;
  onCancelRequest: () => void;
  onAcceptInvitation: () => void;
  onRejectInvitation: () => void;
}

export function RolePanel({
  role,
  ownUserId,
  peerDisplayName,
  seats,
  selectedSeatId,
  queue,
  invitation,
  disabled,
  onApprove,
  onReject,
  onInvite,
  onRequestSeat,
  onCancelRequest,
  onAcceptInvitation,
  onRejectInvitation,
}: RolePanelProps) {
  const selectedAvailable = seats[selectedSeatId]?.status === 'empty';

  if (role === 'host') {
    return (
      <section className="vr-block vr-role-panel" aria-label="排麦与邀请">
        <header className="vr-block__title">
          <h4>排麦与邀请</h4>
          <span>{queue.length} 条申请</span>
        </header>

        <button
          className="vr-button vr-button--wide"
          type="button"
          disabled={disabled || !selectedAvailable || Boolean(invitation)}
          onClick={() => onInvite(selectedSeatId)}
        >
          <Send aria-hidden="true" size={13} />
          邀请{peerDisplayName}上麦
        </button>

        <div className="vr-request-list">
          {queue.length === 0 && <p className="vr-empty-copy">暂无排麦申请</p>}
          {queue.map((request) => (
            <article className="vr-request" key={request.id}>
              <div>
                <strong>{request.displayName}</strong>
                <span>{seatNumber(request.seatId)} 号麦位</span>
              </div>
              <div className="vr-request__actions">
                <button
                  type="button"
                  className="vr-icon-button vr-icon-button--approve"
                  aria-label={`同意${request.displayName}上麦`}
                  disabled={disabled}
                  onClick={() => onApprove(request.id)}
                >
                  <Check aria-hidden="true" size={13} />
                </button>
                <button
                  type="button"
                  className="vr-icon-button vr-icon-button--reject"
                  aria-label={`拒绝${request.displayName}上麦`}
                  disabled={disabled}
                  onClick={() => onReject(request.id)}
                >
                  <X aria-hidden="true" size={13} />
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    );
  }

  const ownRequest = queue.find((request) => request.userId === ownUserId);
  const ownInvitation = invitation?.userId === ownUserId ? invitation : null;

  return (
    <section className="vr-block vr-role-panel" aria-label="我的上麦">
      <header className="vr-block__title">
        <h4>我的上麦</h4>
        <span>{ownRequest ? '排队中' : ownInvitation ? '收到邀请' : '未申请'}</span>
      </header>

      {ownInvitation && (
        <div className="vr-invitation">
          <p>房主邀请你进入 {seatNumber(ownInvitation.seatId)} 号麦位</p>
          <div>
            <button
              type="button"
              className="vr-icon-button vr-icon-button--approve"
              aria-label="接受上麦邀请"
              disabled={disabled}
              onClick={onAcceptInvitation}
            >
              <Check aria-hidden="true" size={13} />
              接受
            </button>
            <button
              type="button"
              className="vr-icon-button vr-icon-button--reject"
              aria-label="拒绝上麦邀请"
              disabled={disabled}
              onClick={onRejectInvitation}
            >
              <X aria-hidden="true" size={13} />
              拒绝
            </button>
          </div>
        </div>
      )}

      <button
        className="vr-button vr-button--wide"
        type="button"
        disabled={disabled || (!ownRequest && !selectedAvailable)}
        onClick={() => (ownRequest ? onCancelRequest() : onRequestSeat(selectedSeatId))}
      >
        {ownRequest ? (
          <UserMinus aria-hidden="true" size={13} />
        ) : (
          <Send aria-hidden="true" size={13} />
        )}
        {ownRequest ? '取消排麦' : '申请上麦'}
      </button>
    </section>
  );
}
