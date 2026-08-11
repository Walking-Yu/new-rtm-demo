/**
 * 手机内第二个区块：房间头部。
 *
 * 标题与主题，加三个 chip：模式、在线数、状态版本号（见 spec「语聊房主区布局」）。
 * chip 的三项是固定的，不要按状态增删 —— 位置固定读者才能扫一眼就找到。
 */

import type { VoiceRoomSnapshot } from '../state';

interface RoomHeaderProps {
  roomId: string;
  snapshot: VoiceRoomSnapshot;
  onlineCount: number;
}

export function RoomHeader({ roomId, snapshot, onlineCount }: RoomHeaderProps) {
  return (
    <header className="vr-room-header">
      <div className="vr-room-title">
        <h3>{roomId}</h3>
        {/* 公告即房间主题。空公告也占位，避免头部高度跳动。 */}
        <p>{snapshot.announcement || '暂无公告'}</p>
      </div>
      <div className="vr-chips">
        <span className="vr-chip">语聊房</span>
        <span className="vr-chip" data-testid="chip-online">
          在线 {onlineCount}
        </span>
        <span className="vr-chip" data-testid="chip-revision">
          v{snapshot.revision}
        </span>
      </div>
    </header>
  );
}
