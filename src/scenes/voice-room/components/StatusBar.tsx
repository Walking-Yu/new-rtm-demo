/**
 * 手机内第一个区块：状态栏。
 *
 * 仿手机顶栏，同时兼作链路状态显示 —— 真机顶栏放运营商与信号，这里放 RTM 链路态，
 * 位置对应，读者一眼就知道这台「手机」连没连上。
 */

import { Circle } from 'lucide-react';
import type { VoiceRoomLinkState } from '../rtm-host';

const LINK_LABELS: Record<VoiceRoomLinkState, string> = {
  disconnected: '未连接',
  connecting: '连接中',
  connected: '已连接',
  reconnecting: '重连中',
  failed: '失败',
};

export function StatusBar({ linkState }: { linkState: VoiceRoomLinkState }) {
  return (
    <div className="vr-status-bar">
      <span className="vr-status-time">9:41</span>
      <span className="vr-link-state" data-state={linkState} data-testid="link-state">
        <Circle aria-hidden="true" size={7} fill="currentColor" />
        RTM {LINK_LABELS[linkState]}
      </span>
    </div>
  );
}
