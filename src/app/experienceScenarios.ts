import type { ExperienceScenario, ExperienceStep } from '../shared/experience/types';

export const voiceRoomSteps: readonly ExperienceStep[] = [
  {
    id: 'connection', title: '建立房间连接', capability: 'Login · Message Channel',
    instruction: '填写名称创建房间，或输入房主分享的名称以听众身份加入。右侧可查看登录、名称查询与房间订阅过程。',
    milestones: [{ id: 'login', label: '登录 RTM 成功' }, { id: 'subscribe', label: '订阅房间成功' }],
  },
  {
    id: 'presence', title: '看见成员在线', capability: 'Presence',
    instruction: '房主分享房间名称；在另一台设备或浏览器窗口输入相同名称加入，观察在线人数和成员列表的变化。',
    milestones: [{ id: 'remote-member', label: '收到另一位成员的在线状态' }],
  },
  {
    id: 'seat', title: '申请与审批上麦', capability: 'User Channel · Storage',
    instruction: '听众点击空麦位申请上麦，房主在排麦列表中批准。观察双方麦位更新；也可以由房主邀请上麦。',
    milestones: [{ id: 'seat-signal', label: '发送或收到上麦信令' }, { id: 'seat-occupied', label: '看到听众占用麦位' }],
  },
  {
    id: 'interaction', title: '发送房内消息', capability: 'Message Channel',
    instruction: '在公屏发送文字、礼物或爱心，再让另一端回复。观察本端发送与接收消息的过程。',
    milestones: [{ id: 'interaction-sent', label: '成功发送一次房内互动' }, { id: 'interaction-received', label: '收到另一位成员的互动' }],
  },
  {
    id: 'state', title: '同步房间状态', capability: 'Storage · Presence',
    instruction: '房主修改并发布房间公告，再让任意在麦成员闭麦。对照两个窗口，查看公告与麦克风状态变化。',
    milestones: [{ id: 'announcement', label: '发布或收到新公告' }, { id: 'muted', label: '发布或收到闭麦状态' }],
  },
];

/** The seven public entries retain existing URLs, including shared room invitations. */
export const experienceScenarios: readonly ExperienceScenario[] = [
  { id: 'voice-room', label: '语聊房', path: '/social/voice-room', status: 'ready',
    description: '体验麦位管理、公屏互动与房间状态同步。', steps: voiceRoomSteps },
  { id: 'one-to-one-call', label: '1V1呼叫邀请', path: '/social/one-to-one-call', status: 'planned',
    description: '通过呼叫邀请、接听、拒绝与挂断，体验双方通话状态的协同。', steps: [] },
  { id: 'ecommerce-live', label: '电商直播', path: '/content/live-chat-gifts', status: 'planned',
    description: '通过商品讲解、观众互动与直播间通知，体验消息与共享状态的同步。', steps: [] },
  { id: 'online-classroom', label: '在线课堂', path: '/education/classroom-stage', status: 'planned',
    description: '通过举手发言、教师邀请与课堂互动，体验师生之间的实时协同。', steps: [] },
  { id: 'virtual-world', label: '虚拟世界', path: '/social/presence', status: 'planned',
    description: '通过成员出入、虚拟形象与空间状态，体验虚拟世界的实时变化。', steps: [] },
  { id: 'game-interaction', label: '游戏互动', path: '/gaming/game-voice-chat', status: 'planned',
    description: '通过组队、准备状态与局内互动，体验玩家之间的消息协同。', steps: [] },
  { id: 'document-collaboration', label: '文档协同', path: '/enterprise/team-collaboration', status: 'planned',
    description: '通过协作者在线状态、编辑提示与共享内容，体验多人协作。', steps: [] },
];

export function experienceForPath(path: string): ExperienceScenario | undefined {
  return experienceScenarios.find((scenario) => scenario.path === path);
}
