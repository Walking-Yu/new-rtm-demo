import { Check, CircleDot, RadioTower, Send, TriangleAlert } from 'lucide-react';
import type { EventKind, TimelineEvent } from '../domain/scenario';

const eventIcons: Record<EventKind, typeof Check> = {
  local: CircleDot,
  sent: Send,
  received: RadioTower,
  ack: Check,
  state: Check,
  connection: RadioTower,
  error: TriangleAlert,
};

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(timestamp);
}

export function EventTimeline({ events }: { events: TimelineEvent[] }) {
  return (
    <section className="timeline-panel" aria-label="事件时间线">
      <div className="panel-heading">
        <div>
          <span>EVENT STREAM</span>
          <h2>实时事件</h2>
        </div>
        <b>{events.length}</b>
      </div>
      {events.length === 0 ? (
        <div className="timeline-empty">
          <RadioTower size={21} />
          <p>等待场景操作</p>
          <span>事件将在这里按时间出现</span>
        </div>
      ) : (
        <ol className="timeline-list">
          {[...events].reverse().map((event) => {
            const Icon = eventIcons[event.kind];
            return (
              <li key={event.id} data-kind={event.kind}>
                <span className="timeline-icon"><Icon size={14} /></span>
                <div>
                  <p>{event.text}</p>
                  <time dateTime={new Date(event.timestamp).toISOString()}>{formatTime(event.timestamp)}</time>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
