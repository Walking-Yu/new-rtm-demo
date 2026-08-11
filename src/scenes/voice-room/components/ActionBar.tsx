/**
 * 手机内第七个区块：底部操作条。
 *
 * **常驻手机框内，不随公屏滚动**（见 spec「语聊房主区布局」，用户两轮确认过）。
 * 它是 `.vr-vr-body` 的最后一个 flex 子项且不收缩，公屏在它上方独立滚动。
 *
 * 两端按钮不同：房主放公告与治理入口，听众放上麦与自己的麦控。
 */

import { Gift, Megaphone, Mic, MicOff, LogOut, Send, UserRoundX, Ban } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { SeatState } from '../state';
import type { PhoneActions } from './actions';

interface ActionBarProps {
  role: 'host' | 'audience';
  disabled: boolean;
  actions: PhoneActions;
  /** 本端自己占的麦位，听众端用来决定显示静音还是下麦。 */
  ownSeat?: SeatState;
  /** 房主端治理动作的目标（对端听众）。 */
  peerUserId: string;
  /** 房主端公告输入框的初值。 */
  announcement: string;
  /** 房主治理动作是否可用 —— 对端在麦上才允许强制下麦。 */
  peerOnSeat: boolean;
}

export function ActionBar({
  role,
  disabled,
  actions,
  ownSeat,
  peerUserId,
  announcement,
  peerOnSeat,
}: ActionBarProps) {
  const [chat, setChat] = useState('');
  const [announcementDraft, setAnnouncementDraft] = useState(announcement);
  const [governanceOpen, setGovernanceOpen] = useState(false);

  const submitChat = (event: FormEvent) => {
    event.preventDefault();
    if (!chat.trim()) return;
    actions.sendChat(chat);
    setChat('');
  };

  return (
    <div className="vr-action-bar">
      {role === 'host' && governanceOpen && (
        <div className="vr-governance-tray" data-testid="governance-tray">
          <form
            className="vr-announcement-form"
            onSubmit={(event) => {
              event.preventDefault();
              actions.updateAnnouncement(announcementDraft);
            }}
          >
            <Megaphone aria-hidden="true" size={13} />
            <input
              aria-label="房间公告"
              value={announcementDraft}
              onChange={(event) => setAnnouncementDraft(event.target.value)}
              disabled={disabled}
            />
            <button type="submit" disabled={disabled || !announcementDraft.trim()}>
              更新
            </button>
          </form>
          <div className="vr-governance-buttons">
            <button
              type="button"
              disabled={disabled || !peerOnSeat}
              onClick={() => actions.forceLeaveSeat(peerUserId)}
            >
              <UserRoundX aria-hidden="true" size={13} />
              强制下麦
            </button>
            <button
              type="button"
              className="vr-danger"
              disabled={disabled}
              onClick={() => actions.kickMember(peerUserId)}
            >
              <UserRoundX aria-hidden="true" size={13} />
              踢出
            </button>
            <button
              type="button"
              className="vr-danger"
              disabled={disabled}
              onClick={() => actions.banMember(peerUserId)}
            >
              <Ban aria-hidden="true" size={13} />
              封禁
            </button>
          </div>
        </div>
      )}

      <div className="vr-action-row">
        <form className="vr-chat-composer" onSubmit={submitChat}>
          <input
            aria-label="公屏消息"
            value={chat}
            onChange={(event) => setChat(event.target.value)}
            placeholder="说点什么"
            disabled={disabled}
          />
          <button type="submit" aria-label="发送公屏消息" disabled={disabled || !chat.trim()}>
            <Send aria-hidden="true" size={14} />
          </button>
        </form>

        <div className="vr-quick-actions">
          {['👏', '❤️'].map((emoji) => (
            <button
              type="button"
              key={emoji}
              aria-label={`发送 ${emoji}`}
              onClick={() => actions.sendEmoji(emoji)}
              disabled={disabled}
            >
              {emoji}
            </button>
          ))}
          <button
            type="button"
            aria-label="送出玫瑰"
            onClick={() => actions.sendGift('rose')}
            disabled={disabled}
          >
            <Gift aria-hidden="true" size={14} />
          </button>

          {role === 'host' ? (
            <button
              type="button"
              aria-label="房间治理"
              aria-expanded={governanceOpen}
              data-testid="governance-toggle"
              onClick={() => setGovernanceOpen((open) => !open)}
            >
              <UserRoundX aria-hidden="true" size={14} />
            </button>
          ) : (
            ownSeat &&
            (ownSeat.status === 'active' || ownSeat.status === 'muted') && (
              <>
                <button
                  type="button"
                  aria-label={ownSeat.muted ? '解除静音' : '静音'}
                  disabled={disabled}
                  onClick={() => actions.setOwnMuted(!ownSeat.muted)}
                >
                  {ownSeat.muted ? (
                    <Mic aria-hidden="true" size={14} />
                  ) : (
                    <MicOff aria-hidden="true" size={14} />
                  )}
                </button>
                <button
                  type="button"
                  className="vr-danger"
                  aria-label="下麦"
                  disabled={disabled}
                  onClick={() => actions.leaveOwnSeat()}
                >
                  <LogOut aria-hidden="true" size={14} />
                </button>
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
}
