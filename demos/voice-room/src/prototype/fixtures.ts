// 一次性布局原型：全部为写死的假数据，不连接 RTM / RTC
export type Role = 'host' | 'audience';

export interface SeatFixture {
  index: number;
  state: 'empty' | 'locked' | 'reserved' | 'active';
  name?: string;
  role?: '房主' | '管理员' | '麦上';
  /** 用户自己闭麦 */
  selfMuted?: boolean;
  /** 被管理员禁麦 */
  adminMuted?: boolean;
  speaking?: boolean;
  /** 该麦位属于哪一端，用于在对应手机上标「我」 */
  owner?: Role;
}

/** 麦位是房间共享状态（RTM Storage 权威），两台手机看到的是同一份 */
export const SEATS: SeatFixture[] = [
  { index: 1, state: 'active', name: 'Ava', role: '房主', speaking: true, owner: 'host' },
  { index: 2, state: 'active', name: 'Ben', role: '麦上', selfMuted: true },
  { index: 3, state: 'active', name: 'Cara', role: '麦上', adminMuted: true },
  { index: 4, state: 'reserved', name: 'Dan', owner: 'audience' },
  { index: 5, state: 'empty' },
  { index: 6, state: 'empty' },
  { index: 7, state: 'locked' },
  { index: 8, state: 'empty' },
];

export interface MemberFixture {
  name: string;
  tag?: string;
  owner?: Role;
}

export const MEMBERS: MemberFixture[] = [
  { name: 'Ava', tag: '房主', owner: 'host' },
  { name: 'Mod-Kim', tag: '管理员' },
  { name: 'Ben', tag: '麦上' },
  { name: 'Cara', tag: '麦上' },
  { name: 'Dan', tag: '申请中', owner: 'audience' },
  { name: 'Elly' },
  { name: 'Finn' },
  { name: 'Gina' },
  { name: 'Hugo' },
];

export type ChatKind = 'user' | 'business' | 'system';

export interface ChatFixture {
  kind: ChatKind;
  who?: string;
  text: string;
}

export const CHAT: ChatFixture[] = [
  { kind: 'system', text: '欢迎来到「周五夜谈」，请遵守社区规范。' },
  { kind: 'user', who: 'Elly', text: '这首歌好听' },
  { kind: 'business', text: 'Ben 上麦到 2 号麦位' },
  { kind: 'user', who: 'Finn', text: '房主能放上次那首吗' },
  { kind: 'business', text: 'Cara 被管理员禁麦' },
  { kind: 'user', who: 'Gina', text: '👏👏' },
  { kind: 'business', text: 'Hugo 赠送 小心心 ×10' },
  { kind: 'system', text: '管理员公告：本房禁止刷屏。' },
  { kind: 'user', who: 'Elly', text: '我也想上麦～' },
  { kind: 'business', text: 'Dan 申请上麦，等待房主审批' },
];

export interface RequestFixture {
  name: string;
  waited: string;
}

/** 只有房主那台手机会渲染这份申请列表 */
export const REQUESTS: RequestFixture[] = [
  { name: 'Dan', waited: '等待 12s' },
  { name: 'Elly', waited: '等待 34s' },
];

export type TraceKind = 'api' | 'event';

export interface TraceFixture {
  time: string;
  uid: Role;
  kind: TraceKind;
  label: string;
  detail?: string;
}

/** 对应文档 5.3「申请上麦」时序：api 节点与 event 节点交替 */
export const TRACE: TraceFixture[] = [
  { time: '12:04:01.220', uid: 'audience', kind: 'api', label: 'publish(user:host)', detail: 'seat.request  messageId=8f21' },
  { time: '12:04:01.318', uid: 'host', kind: 'event', label: 'message', detail: 'seat.request  from=audience-001' },
  { time: '12:04:03.902', uid: 'host', kind: 'api', label: 'lock.acquire', detail: 'room-state  ttl=10s' },
  { time: '12:04:03.964', uid: 'host', kind: 'api', label: 'storage.getChannelMetadata', detail: 'voice-room-state  rev=41' },
  { time: '12:04:04.031', uid: 'host', kind: 'api', label: 'storage.setChannelMetadata', detail: 'seat[4]=reserved  rev=41→42' },
  { time: '12:04:04.088', uid: 'host', kind: 'api', label: 'lock.release', detail: 'room-state' },
  { time: '12:04:04.140', uid: 'audience', kind: 'event', label: 'storage', detail: 'snapshot rev=42  seat[4] reserved' },
  { time: '12:04:04.142', uid: 'host', kind: 'event', label: 'storage', detail: 'snapshot rev=42' },
  { time: '12:04:04.615', uid: 'audience', kind: 'api', label: 'storage.setChannelMetadata', detail: 'seat[4]=active  rev=42→43' },
  { time: '12:04:04.681', uid: 'host', kind: 'event', label: 'storage', detail: 'snapshot rev=43  seat[4] active' },
  { time: '12:04:04.690', uid: 'host', kind: 'event', label: 'presence', detail: 'audience-001 state.mic=on' },
  { time: '12:04:06.104', uid: 'audience', kind: 'api', label: 'publish(channel)', detail: 'chat.text  “谢谢房主”' },
  { time: '12:04:06.201', uid: 'host', kind: 'event', label: 'message', detail: 'chat.text  from=audience-001' },
  { time: '12:04:11.870', uid: 'host', kind: 'api', label: 'publish(user:audience-001)', detail: 'seat.mute.command  requiresAck' },
  { time: '12:04:11.958', uid: 'audience', kind: 'event', label: 'message', detail: 'seat.mute.command  from=host-001' },
  { time: '12:04:12.043', uid: 'audience', kind: 'api', label: 'publish(user:host-001)', detail: 'command.ack  ok' },
  { time: '12:04:12.131', uid: 'host', kind: 'event', label: 'message', detail: 'command.ack  messageId=8f27' },
];

export const ROOM = {
  title: '周五夜谈',
  topic: '聊聊今年最后悔的一次决定',
  mode: '申请上麦',
  activity: 'KTV 排队 · 下一首《晴天》',
  online: 128,
  revision: 43,
};

export const IDENTITY: Record<Role, { uid: string; name: string; label: string }> = {
  host: { uid: 'host-001', name: 'Ava', label: '房主视角' },
  audience: { uid: 'audience-001', name: 'Dan', label: '听众视角' },
};
