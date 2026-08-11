/**
 * 语聊房的场景配置。
 *
 * **端数不进注册表** —— 注册表只有 id/title/summary/status 四个字段，
 * 端数是场景自己的事，写在场景目录（见票 08 与 spec「场景注册表」）。
 */

/** 麦位数。`createInitialSnapshot` 按这个数生成空麦位。 */
export const SEAT_COUNT = 4;

/**
 * 同一标签页内的客户端数上限。
 *
 * 无技术上限、只有体验上限：全部端都是真实链路（没有模拟端）。
 * 语聊房默认 2 端 —— 房主 + 听众，正好演示「一个标签页两个真实客户端」。
 */
export const MAX_CLIENTS = 2;

/** 本场景的角色，顺序即主角色优先（`?uid=` 简写的目标是第一项）。 */
export const ROLES = ['host', 'audience'] as const;

export type VoiceRoomRole = (typeof ROLES)[number];
