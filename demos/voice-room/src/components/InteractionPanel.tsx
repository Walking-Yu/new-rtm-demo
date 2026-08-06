import { Gift, Megaphone, Send } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { EndpointRole } from '../domain/types';
import type { InteractionEvent, VoiceRoomCommand } from '../runtime/VoiceRoomClient';

interface InteractionPanelProps {
  role: EndpointRole;
  announcement: string;
  interactions: InteractionEvent[];
  disabled: boolean;
  onCommand: (command: VoiceRoomCommand) => void;
}

export function InteractionPanel({ role, announcement, interactions, disabled, onCommand }: InteractionPanelProps) {
  const [chat, setChat] = useState('');
  const [announcementDraft, setAnnouncementDraft] = useState(announcement);

  const sendChat = (event: FormEvent) => {
    event.preventDefault();
    if (!chat.trim()) return;
    onCommand({ type: 'chat.send', text: chat });
    setChat('');
  };

  return (
    <section className="control-section interaction-section" aria-labelledby="interaction-heading">
      <div className="section-heading"><span>MESSAGE CHANNEL</span><h3 id="interaction-heading">房间互动</h3></div>
      <div className="interaction-feed" aria-live="polite">
        {interactions.length === 0 && <p className="empty-copy">暂无互动消息</p>}
        {interactions.slice(-8).map((interaction) => (
          <p key={interaction.id}>
            <strong>{interaction.displayName}</strong>
            <span>{interaction.type === 'gift' ? `送出 ${interaction.value}` : interaction.value}</span>
          </p>
        ))}
      </div>
      <form className="chat-composer" onSubmit={sendChat}>
        <input
          aria-label="公屏消息"
          value={chat}
          onChange={(event) => setChat(event.target.value)}
          placeholder="发送公屏消息"
          disabled={disabled}
        />
        <button type="submit" aria-label="发送公屏消息" disabled={disabled || !chat.trim()}>
          <Send aria-hidden="true" size={15} />
        </button>
      </form>
      <div className="quick-interactions">
        {['👏', '❤️', '🎉'].map((emoji) => (
          <button
            type="button"
            key={emoji}
            aria-label={`发送 ${emoji}`}
            onClick={() => onCommand({ type: 'emoji.send', emoji })}
            disabled={disabled}
          >{emoji}</button>
        ))}
        <button type="button" onClick={() => onCommand({ type: 'gift.send', giftId: 'rose' })} disabled={disabled}>
          <Gift aria-hidden="true" size={14} />玫瑰
        </button>
        <button type="button" onClick={() => onCommand({ type: 'gift.send', giftId: 'applause' })} disabled={disabled}>
          <Gift aria-hidden="true" size={14} />喝彩
        </button>
      </div>
      {role === 'host' && (
        <form
          className="announcement-composer"
          onSubmit={(event) => {
            event.preventDefault();
            onCommand({ type: 'announcement.update', text: announcementDraft });
          }}
        >
          <Megaphone aria-hidden="true" size={15} />
          <input
            aria-label="房间公告"
            value={announcementDraft}
            onChange={(event) => setAnnouncementDraft(event.target.value)}
            disabled={disabled}
          />
          <button type="submit" disabled={disabled || !announcementDraft.trim()}>更新</button>
        </form>
      )}
    </section>
  );
}
