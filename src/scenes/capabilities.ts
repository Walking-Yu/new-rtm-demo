/**
 * 场景能力标签：每个场景计划演示哪些 RTM 能力。
 *
 * 这份数据**刻意不进注册表** —— 注册表只有 `id`/`title`/`summary`/`status` 四个字段，
 * 那道护栏防的正是「服务于一套通用 UI 数据驱动渲染的字段被顺手加回来」。
 * 但票 15 要求占位页写明「该场景计划演示哪些 RTM 能力」，所以数据不能丢，
 * 只能换个模块住（见 spec「场景注册表」的丢弃字段表：能力标签「不进注册表但不丢弃」）。
 *
 * 数据来源是遗留的 `src/legacy/domain/scenarioCatalog.ts`，逐条搬运。
 * 人类可读的完整归档（含角色清单）见 `docs/scratch/rtm-demo-lab/场景实现资料.md`。
 */

/** 取值与遗留 `Capability` 类型一致，只有这五个。 */
export type RtmCapability = '用户消息' | '消息频道' | 'Presence' | 'Storage' | 'Lock';

/**
 * 场景 id → 能力标签。
 *
 * `voice-room` 是遗留两个语聊房场景的**并集**：
 * `voice-room-interaction`（消息频道、Storage）+ `voice-room-seats`（消息频道、Storage、Lock）。
 */
export const sceneCapabilities: Record<string, readonly RtmCapability[]> = {
  // 社交
  presence: ['用户消息', 'Presence', 'Storage'],
  'im-chat': ['用户消息', '消息频道'],
  'voice-room': ['消息频道', 'Storage', 'Lock'],
  'live-pk': ['用户消息', '消息频道', 'Storage'],
  'one-to-one-call': ['用户消息'],
  'room-moderation': ['用户消息', '消息频道', 'Storage'],

  // 教育
  'classroom-messaging': ['用户消息', '消息频道'],
  'classroom-stage': ['消息频道', 'Storage'],
  'classroom-quiz': ['用户消息', '消息频道', 'Storage', 'Lock'],
  'learning-device': ['用户消息', 'Presence', 'Storage'],

  // 企业
  'team-collaboration': ['用户消息', '消息频道', 'Storage'],
  'field-operations': ['用户消息', '消息频道', 'Storage'],
  'video-meeting': ['用户消息', '消息频道', 'Presence', 'Storage'],

  // 物联网
  'device-telemetry': ['消息频道', 'Presence', 'Storage'],
  'device-control': ['用户消息', 'Presence', 'Storage'],
  'security-alerts': ['用户消息', '消息频道', 'Storage'],

  // 内容
  'live-chat-gifts': ['消息频道', 'Storage'],
  'live-operations': ['消息频道', 'Presence', 'Storage'],
  'live-guests': ['用户消息', '消息频道', 'Storage', 'Lock'],

  // 医疗
  'telemedicine-call': ['用户消息'],

  // 出行
  'dispatch-order': ['用户消息', '消息频道', 'Storage'],
  'driver-rider-messaging': ['用户消息', '消息频道'],

  // 游戏
  'game-voice-chat': ['用户消息', '消息频道', 'Presence', 'Storage', 'Lock'],
};

/** 未知 id 返回空数组，不抛异常。返回副本，调用方改写不影响登记表。 */
export function capabilitiesOf(sceneId: string): readonly RtmCapability[] {
  const capabilities = sceneCapabilities[sceneId];
  return capabilities ? [...capabilities] : [];
}
