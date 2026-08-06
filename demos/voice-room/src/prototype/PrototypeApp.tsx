// 一次性布局原型。所有数据写死，无 RTM / RTC 连接，无业务逻辑。
// 目的：确认两级 tab、双端手机视角、时间线的布局与信息密度。
import { useState } from 'react';
import { CATALOG } from './catalog';
import {
  CHAT,
  IDENTITY,
  MEMBERS,
  REQUESTS,
  ROOM,
  SEATS,
  TRACE,
  type Role,
} from './fixtures';

function initial(name: string) {
  return name.slice(0, 1).toUpperCase();
}

export function PrototypeApp() {
  const [primaryId, setPrimaryId] = useState('social');
  const [sceneId, setSceneId] = useState('voice-room');
  const [traceCollapsed, setTraceCollapsed] = useState(false);

  const primary = CATALOG.find((c) => c.id === primaryId) ?? CATALOG[0];
  const scene = primary.scenes.find((s) => s.id === sceneId);
  const showVoiceRoom = sceneId === 'voice-room';

  return (
    <>
      <div className="pt-banner">
        一次性布局原型 · 数据全为假、不连接 RTM/RTC · 仅用于确认布局，确认后即删除
      </div>

      <header className="pt-topbar">
        <div className="pt-logo">
          <span className="pt-logo-mark" aria-hidden="true" />
          RTM 场景实验室
        </div>
        <nav className="pt-primary-tabs" aria-label="一级场景分类">
          {CATALOG.map((category) => (
            <button
              key={category.id}
              type="button"
              className="pt-primary-tab"
              data-active={category.id === primaryId}
              onClick={() => {
                setPrimaryId(category.id);
                setSceneId(category.scenes[0].id);
              }}
            >
              {category.name}
            </button>
          ))}
        </nav>
        <div className="pt-topbar-right">
          <span>App ID 来自 env</span>
        </div>
      </header>

      <nav className="pt-subbar" aria-label="二级场景">
        {primary.scenes.map((item) => (
          <button
            key={item.id}
            type="button"
            className="pt-sub-tab"
            data-active={item.id === sceneId}
            data-ready={Boolean(item.ready)}
            onClick={() => setSceneId(item.id)}
          >
            {item.name}
          </button>
        ))}
      </nav>

      <div className="pt-body" data-trace={traceCollapsed ? 'collapsed' : 'expanded'}>
        <main className="pt-main">
          {showVoiceRoom ? <TwoPhones /> : <Placeholder name={scene?.name ?? ''} />}
        </main>
        {traceCollapsed ? (
          <button
            type="button"
            className="pt-rail"
            onClick={() => setTraceCollapsed(false)}
            aria-label="展开数据流时间线"
          >
            <span aria-hidden="true">‹</span>
            <span className="pt-rail-text">数据流时间线</span>
            <span className="pt-rail-count">{TRACE.length}</span>
          </button>
        ) : (
          <TracePanel onCollapse={() => setTraceCollapsed(true)} />
        )}
      </div>
    </>
  );
}

function Placeholder({ name }: { name: string }) {
  return (
    <section className="pt-placeholder">
      <p className="pt-placeholder-name">{name}</p>
      <p className="pt-placeholder-hint">
        该场景尚未实现。每个场景占据同一个主容器位置，右侧时间线面板保持不变。
      </p>
    </section>
  );
}

/** 两台手机并排：同一个房间，两个用户各自的界面 */
function TwoPhones() {
  return (
    <div className="pt-phones">
      <Phone role="host" />
      <Phone role="audience" />
    </div>
  );
}

function Phone({ role }: { role: Role }) {
  const me = IDENTITY[role];
  const isHost = role === 'host';

  return (
    <section className="pt-phone-wrap">
      <div className="pt-phone-tag">
        <span className="pt-uid" data-uid={role}>
          {me.uid}
        </span>
        <span className="pt-phone-tag-label">
          {me.label} · {me.name}
        </span>
      </div>

      <div className="pt-phone">
        <div className="pt-status-bar">
          <span>23:41</span>
          <span className="pt-status-icons">▮▮▮ ▾ 84%</span>
        </div>

        <div className="pt-screen">
          {/* 房间头部 */}
          <div className="pt-room-head">
            <div className="pt-room-head-row">
              <button type="button" className="pt-icon-btn" aria-label="返回">
                ‹
              </button>
              <div className="pt-room-head-main">
                <p className="pt-room-title">{ROOM.title}</p>
                <p className="pt-room-topic">{ROOM.topic}</p>
              </div>
              <button type="button" className="pt-icon-btn" aria-label="更多">
                ⋯
              </button>
            </div>
            <div className="pt-chips">
              <span className="pt-chip" data-tone="indigo">
                {ROOM.mode}
              </span>
              <span className="pt-chip">在线 {ROOM.online}</span>
              <span className="pt-chip">rev {ROOM.revision}</span>
            </div>
          </div>

          {/* 麦位区 */}
          <div className="pt-seat-grid">
            {SEATS.map((seat) => {
              const mine = seat.owner === role;
              return (
                <div
                  key={seat.index}
                  className="pt-seat"
                  data-state={seat.state}
                  data-speaking={Boolean(seat.speaking)}
                  data-mine={mine}
                >
                  <span className="pt-seat-no">{seat.index}</span>
                  {seat.state === 'empty' ? (
                    <>
                      <span className="pt-avatar">+</span>
                      <span className="pt-seat-empty">空闲</span>
                    </>
                  ) : seat.state === 'locked' ? (
                    <>
                      <span className="pt-avatar">🔒</span>
                      <span className="pt-seat-empty">锁定</span>
                    </>
                  ) : (
                    <>
                      <span className="pt-avatar">{initial(seat.name ?? '')}</span>
                      <span className="pt-seat-name">
                        {seat.name}
                        {mine && <em className="pt-me">我</em>}
                      </span>
                      <span className="pt-seat-badges">
                        {seat.role === '房主' && (
                          <span className="pt-badge" data-tone="role">
                            房主
                          </span>
                        )}
                        {seat.speaking && <span className="pt-badge">说话中</span>}
                        {seat.selfMuted && <span className="pt-badge">闭麦</span>}
                        {seat.adminMuted && (
                          <span className="pt-badge" data-tone="admin-mute">
                            禁麦
                          </span>
                        )}
                        {seat.state === 'reserved' && <span className="pt-badge">上麦中</span>}
                      </span>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* 房主专属：上麦申请审批 */}
          {isHost && (
            <div className="pt-panel" data-tone="request">
              <p className="pt-panel-label">上麦申请（{REQUESTS.length}）· 仅房主可见</p>
              {REQUESTS.map((request) => (
                <div key={request.name} className="pt-request">
                  <span className="pt-member-dot">{initial(request.name)}</span>
                  <span className="pt-request-name">{request.name}</span>
                  <span className="pt-request-wait">{request.waited}</span>
                  <button type="button" className="pt-btn-mini" data-variant="approve">
                    同意
                  </button>
                  <button type="button" className="pt-btn-mini" data-variant="reject">
                    拒绝
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 听众专属：自己的申请状态 */}
          {!isHost && (
            <div className="pt-panel" data-tone="pending">
              <p className="pt-panel-label">我的状态</p>
              <div className="pt-my-status">
                <span className="pt-spinner" aria-hidden="true" />
                已申请 4 号麦位，等待房主同意…
                <button type="button" className="pt-btn-mini">
                  取消
                </button>
              </div>
            </div>
          )}

          {/* 成员条 */}
          <div className="pt-member-strip">
            {MEMBERS.slice(0, 7).map((member) => (
              <span key={member.name} className="pt-member-chip" data-mine={member.owner === role}>
                <span className="pt-member-dot">{initial(member.name)}</span>
                {member.name}
              </span>
            ))}
            <span className="pt-member-chip" data-more="true">
              +{MEMBERS.length - 7}
            </span>
          </div>

          {/* 公屏 */}
          <div className="pt-chat">
            {CHAT.map((line, index) => (
              <div key={index} className="pt-chat-line" data-kind={line.kind}>
                {line.who && <span className="pt-chat-who">{line.who}：</span>}
                <span>{line.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 底部操作条：两端不同 */}
        <div className="pt-dock">
          <input className="pt-dock-input" placeholder="说点什么…" readOnly />
          {isHost ? (
            <>
              <button type="button" className="pt-dock-btn" title="麦克风">
                🎤
              </button>
              <button type="button" className="pt-dock-btn" title="房间管理">
                ⚙
              </button>
            </>
          ) : (
            <>
              <button type="button" className="pt-dock-btn" data-variant="primary" title="申请上麦">
                上麦
              </button>
              <button type="button" className="pt-dock-btn" title="送礼物">
                🎁
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

const LEGEND = [
  { kind: 'api', text: 'RTM API 调用' },
  { kind: 'event', text: 'RTM 事件' },
];

function TracePanel({ onCollapse }: { onCollapse: () => void }) {
  return (
    <aside className="pt-side">
      <div className="pt-side-head">
        <span className="pt-side-title">数据流时间线</span>
        <span className="pt-side-actions">
          <button type="button" className="pt-btn-mini">
            清空
          </button>
          <button
            type="button"
            className="pt-btn-mini"
            onClick={onCollapse}
            aria-label="折叠数据流时间线"
            title="折叠"
          >
            ›
          </button>
        </span>
      </div>
      <div className="pt-legend">
        {LEGEND.map((item) => (
          <span key={item.kind} className="pt-legend-item" data-kind={item.kind}>
            <span className="pt-legend-swatch" />
            {item.text}
          </span>
        ))}
      </div>
      <div className="pt-trace">
        {TRACE.map((entry, index) => (
          <div key={index} className="pt-trace-row" data-kind={entry.kind}>
            <span className="pt-trace-rail">
              <span className="pt-trace-node" />
            </span>
            <span className="pt-trace-time">{entry.time.slice(3)}</span>
            <span className="pt-trace-body">
              <span className="pt-trace-label">
                <span className="pt-uid" data-uid={entry.uid}>
                  {entry.uid}
                </span>
                <span className="pt-trace-name">{entry.label}</span>
              </span>
              {entry.detail && <span className="pt-trace-detail">{entry.detail}</span>}
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}
