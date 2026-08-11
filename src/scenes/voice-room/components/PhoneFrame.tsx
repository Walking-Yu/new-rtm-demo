/**
 * 一台手机 = 一个端的完整视角。
 *
 * ## 区块顺序是 spec 定死的
 *
 * 状态栏 → 房间头部 → 麦位网格 → 角色专属面板 → 成员条 → 公屏 → 底部操作条。
 * **不要重排。** 这个顺序对应真实语聊房 App 的信息层级，读者拿它跟自己的产品对照。
 *
 * ## 只有公屏滚动
 *
 * 其余区块全部 `flex-shrink: 0` 钉住，底部操作条常驻框内不随公屏滚动
 * （用户已两轮确认，见 spec「语聊房主区布局」）。这里只负责把区块按顺序放好，
 * 滚动约束由 `styles.css` 的 `.vr-phone` 栅格实现 —— 组件不写内联高度。
 *
 * ## 身份条在框外
 *
 * 身份条（彩色 uid badge + 视角说明）在手机**外框上方**，不在手机内 ——
 * 它是「这台手机是哪个端」的元信息，不属于房间 UI。badge 颜色取自
 * `roleColor()`，与时间线条目 badge 同源，读者靠颜色对应两边。
 */

import { roleColor } from '../../../shared/timeline/roleColors';
import type { EndpointView } from '../orchestrator';
import type { PhoneActions } from './actions';
import { ActionBar } from './ActionBar';
import { ChatFeed } from './ChatFeed';
import { MemberBar } from './MemberBar';
import { RolePanel } from './RolePanel';
import { RoomHeader } from './RoomHeader';
import { SeatGrid } from './SeatGrid';
import { StatusBar } from './StatusBar';

interface PhoneFrameProps {
  view: EndpointView;
  peer: EndpointView;
  roomId: string;
  selectedSeatId: string;
  onSelectSeat: (seatId: string) => void;
  actions: PhoneActions;
}

const ROLE_CAPTIONS: Record<string, string> = {
  host: '房主视角',
  audience: '听众视角',
};

export function PhoneFrame({
  view,
  peer,
  roomId,
  selectedSeatId,
  onSelectSeat,
  actions,
}: PhoneFrameProps) {
  const { accent, soft } = roleColor(view.role);
  const seats = view.snapshot.seats;

  // 控件在链路未连上时禁用 —— 否则点击只会静默失败，读者以为 demo 坏了。
  const disabled = view.linkState !== 'connected' || Boolean(view.exitReason);

  const ownSeat = Object.values(seats).find((seat) => seat.userId === view.userId);
  const peerOnSeat = Object.values(seats).some((seat) => seat.userId === peer.userId);

  return (
    <section
      className="vr-column"
      aria-label={ROLE_CAPTIONS[view.role] ?? view.role}
      data-role={view.role}
    >
      {/* 身份条：彩色 uid badge + 视角说明。badge 与时间线同色同源。 */}
      <header className="vr-identity">
        <span
          className="lab-uid-badge"
          style={{ color: accent, background: soft }}
          data-testid={`identity-badge-${view.role}`}
        >
          {view.userId}
        </span>
        <span className="vr-identity-caption">{ROLE_CAPTIONS[view.role] ?? view.role}</span>
      </header>

      <div className="vr-phone" data-testid={`vr-${view.role}`}>
        <StatusBar linkState={view.linkState} />

        <RoomHeader roomId={roomId} snapshot={view.snapshot} onlineCount={view.onlineUsers.length} />

        <SeatGrid
          role={view.role}
          ownUserId={view.userId}
          seats={seats}
          selectedSeatId={selectedSeatId}
          volumes={view.volumes}
          disabled={disabled}
          onSelect={onSelectSeat}
          onForceMute={actions.forceMuteSeat}
          onForceLeave={actions.forceLeaveSeat}
        />

        <RolePanel
          role={view.role}
          ownUserId={view.userId}
          peerUserId={peer.userId}
          peerDisplayName={peer.displayName}
          seats={seats}
          selectedSeatId={selectedSeatId}
          queue={view.snapshot.queue}
          invitation={view.snapshot.invitation}
          disabled={disabled}
          onApprove={actions.approveSeatRequest}
          onReject={actions.rejectSeatRequest}
          onInvite={actions.inviteToSeat}
          onRequestSeat={actions.requestSeat}
          onCancelRequest={actions.cancelSeatRequest}
          onAcceptInvitation={actions.acceptInvitation}
          onRejectInvitation={actions.rejectInvitation}
        />

        <MemberBar
          onlineUsers={view.onlineUsers}
          hostUserId={view.snapshot.hostUserId}
          ownUserId={view.userId}
        />

        {/* 唯一滚动的区块。 */}
        <ChatFeed interactions={view.interactions} hostUserId={view.snapshot.hostUserId} />

        {/* 失败路径的可见反馈：上麦失败等错误直接摆在操作条上方，不用弹窗。 */}
        {view.lastError && (
          <p className="vr-error" role="alert" data-testid={`error-${view.role}`}>
            {view.lastError}
          </p>
        )}
        {view.exitReason && (
          <p className="vr-exit" role="alert" data-testid={`exit-${view.role}`}>
            {view.exitReason === 'banned' ? '该客户端已被封禁并断开连接' : '该客户端已被房主踢出'}
          </p>
        )}

        <ActionBar
          role={view.role}
          disabled={disabled}
          actions={actions}
          ownSeat={ownSeat}
          peerUserId={peer.userId}
          announcement={view.snapshot.announcement}
          peerOnSeat={peerOnSeat}
        />
      </div>
    </section>
  );
}
