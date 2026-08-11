/**
 * 手机内第五个区块：成员条。
 *
 * 横向滚动，超出显示计数（见 spec「语聊房主区布局」）。**不要改成换行多行** ——
 * 手机内只有公屏能滚动，成员条换行会把公屏挤掉。
 */

import { UserRound } from 'lucide-react';

/** 条内最多平铺这么多人，其余折成一个计数标记。 */
const VISIBLE_LIMIT = 6;

interface MemberBarProps {
  onlineUsers: readonly string[];
  hostUserId: string;
  ownUserId: string;
}

export function MemberBar({ onlineUsers, hostUserId, ownUserId }: MemberBarProps) {
  const visible = onlineUsers.slice(0, VISIBLE_LIMIT);
  const overflow = onlineUsers.length - visible.length;

  return (
    <div className="vr-member-bar" aria-label={`在线成员 ${onlineUsers.length} 人`}>
      {onlineUsers.length === 0 && <span className="vr-empty-copy">暂无在线成员</span>}
      {visible.map((userId) => (
        <span
          className="vr-member"
          key={userId}
          data-self={userId === ownUserId ? 'true' : undefined}
          title={userId}
        >
          <UserRound aria-hidden="true" size={13} />
          {userId === hostUserId ? '房主' : userId === ownUserId ? '我' : userId}
        </span>
      ))}
      {overflow > 0 && (
        <span className="vr-member vr-member--overflow" data-testid="member-overflow">
          +{overflow}
        </span>
      )}
    </div>
  );
}
