/**
 * 手机内第六个区块：公屏。
 *
 * **手机里只有这一块滚动。** 其余区块全部钉住不收缩（见 spec「语聊房主区布局」，
 * 用户两轮确认过）。滚动条归属由 `styles.css` 的 `.vr-chat` 承担 —— 这里只保证
 * DOM 结构上它是唯一的滚动容器，不要给其它区块加 `overflow`。
 *
 * 新消息到达时自动滚到底：不这么做的话公屏看着像卡住了。
 */

import { Gift } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { InteractionEvent } from '../rtm-host';

interface ChatFeedProps {
  interactions: readonly InteractionEvent[];
  hostUserId: string;
}

export function ChatFeed({ interactions, hostUserId }: ChatFeedProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // `scrollIntoView` 在 jsdom 里不存在，测试环境下跳过 —— 可选调用而不是 try/catch，
    // 免得把真实环境里的错误也一起吞掉。
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [interactions.length]);

  return (
    <div className="vr-chat" aria-live="polite" aria-label="公屏消息" data-testid="chat-feed">
      {interactions.length === 0 && <p className="vr-empty-copy">暂无互动消息</p>}
      {interactions.map((event) => (
        <p className="vr-chat-line" key={event.id} data-type={event.type}>
          <strong data-host={event.senderId === hostUserId ? 'true' : undefined}>
            {event.displayName}
          </strong>
          <span>
            {event.type === 'gift' ? (
              <>
                <Gift aria-hidden="true" size={12} />
                送出 {event.value}
              </>
            ) : (
              event.value
            )}
          </span>
        </p>
      ))}
      <div ref={endRef} />
    </div>
  );
}
