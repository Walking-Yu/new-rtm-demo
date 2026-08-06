// 一次性布局原型：场景目录（静态数据，仅用于验证两级 tab 的信息密度）
export interface SecondaryScene {
  id: string;
  name: string;
  /** 已有 demo 实现的场景，用于区分「可点」与「占位」 */
  ready?: boolean;
}

export interface PrimaryCategory {
  id: string;
  name: string;
  scenes: SecondaryScene[];
}

export const CATALOG: PrimaryCategory[] = [
  {
    id: 'social',
    name: '社交/娱乐',
    scenes: [
      { id: 'relationship', name: '社交关系' },
      { id: 'chat', name: '社交聊天' },
      { id: 'voice-room', name: '语聊房', ready: true },
      { id: 'live', name: '直播' },
      { id: 'video-1v1', name: '1v1 视频' },
      { id: 'governance', name: '房间治理' },
    ],
  },
  {
    id: 'education',
    name: '在线教育',
    scenes: [
      { id: 'teacher-student', name: '师生沟通' },
      { id: 'live-class', name: '直播课堂' },
      { id: 'interactive-class', name: '互动课堂' },
      { id: 'edu-hardware', name: '教育硬件' },
    ],
  },
  {
    id: 'enterprise',
    name: '企业服务与垂直行业',
    scenes: [
      { id: 'collaboration', name: '企业协同' },
      { id: 'field-ops', name: '现场运维' },
      { id: 'meeting', name: '视频会议' },
    ],
  },
  {
    id: 'iot',
    name: 'IOT/智能硬件',
    scenes: [
      { id: 'device-manage', name: '设备管理' },
      { id: 'device-control', name: '设备控制' },
      { id: 'security-sensor', name: '安防与传感' },
    ],
  },
  {
    id: 'content',
    name: '内容/直播',
    scenes: [
      { id: 'live-room', name: '直播间' },
      { id: 'live-ops', name: '直播运营' },
    ],
  },
  {
    id: 'health',
    name: '医疗健康',
    scenes: [{ id: 'consultation', name: '在线问诊' }],
  },
  {
    id: 'mobility',
    name: '出行/本地生活',
    scenes: [
      { id: 'delivery', name: '出行配送' },
      { id: 'driver', name: '司机' },
      { id: 'rider', name: '骑手' },
    ],
  },
  {
    id: 'game',
    name: '游戏',
    scenes: [{ id: 'game-voice', name: '语音房' }],
  },
];
