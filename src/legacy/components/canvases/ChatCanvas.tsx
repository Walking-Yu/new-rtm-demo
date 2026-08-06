import { CheckCheck, Circle, MessageSquare, MoreHorizontal, Search, Send, Users } from 'lucide-react';
import type { CanvasProps } from './types';

export function ChatCanvas({ scenario, session }: CanvasProps) {
  return (
    <div className="canvas-view chat-view" aria-label="消息与联系人">
      <aside className="contact-list">
        <div className="contact-search"><Search size={15} />搜索联系人</div>
        {scenario.roles.map((role, index) => (
          <div className={`contact-row ${index === 1 ? 'contact-row--active' : ''}`} key={role.id}>
            <span>{role.label.slice(0, 1)}<i /></span>
            <div><strong>{role.label}</strong><small>{index === 0 ? '当前账号' : '实时在线'}</small></div>
            <time>{index === 1 ? '刚刚' : '09:24'}</time>
          </div>
        ))}
      </aside>
      <section className="conversation">
        <header><span><Circle size={10} fill="currentColor" />在线</span><strong>{scenario.title}</strong><MoreHorizontal size={18} /></header>
        <div className="message-stream">
          <div className="message-bubble message-bubble--received"><p>当前状态已经同步了吗？</p><span>10:31</span></div>
          <div className="message-bubble message-bubble--sent"><p>已同步，可以继续下一步。</p><span>10:31 <CheckCheck size={13} /></span></div>
          <div className="message-state"><MessageSquare size={14} />{session.status}</div>
        </div>
        <div className="message-composer"><span>输入消息...</span><button aria-label="发送示例消息"><Send size={16} /></button></div>
        <div className="conversation-meta"><Users size={14} />Presence 在线 · 消息回执已启用</div>
      </section>
    </div>
  );
}
