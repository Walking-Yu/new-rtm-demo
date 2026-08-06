import { AlertCircle, CheckCircle2, Clock3 } from 'lucide-react';
import type { TimelineEvent } from '../runtime/VoiceRoomClient';

export function EventTimeline({ events }: { events: TimelineEvent[] }) {
  return (
    <section className="control-section timeline-section" aria-labelledby="timeline-heading">
      <div className="section-heading"><span>OBSERVABILITY</span><h3 id="timeline-heading">操作时间线</h3></div>
      <ol className="timeline">
        {events.length === 0 && <li className="empty-copy">等待连接</li>}
        {events.slice(-10).reverse().map((event) => (
          <li key={event.id} className={`timeline-event timeline-event--${event.kind}`}>
            {event.kind === 'error'
              ? <AlertCircle aria-hidden="true" size={14} />
              : event.kind === 'ack'
                ? <CheckCircle2 aria-hidden="true" size={14} />
                : <Clock3 aria-hidden="true" size={14} />}
            <span>{event.text}</span>
            <time>{new Date(event.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}</time>
          </li>
        ))}
      </ol>
    </section>
  );
}
