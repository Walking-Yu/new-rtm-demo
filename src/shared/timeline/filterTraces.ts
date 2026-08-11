/**
 * 时间线的三维筛选。
 *
 * 三个维度（类型、角色、uid）**都是条目上已有的字段** —— 刻意不为筛选新增任何
 * 数据字段（见票 20 与 spec「归并与筛选」）。
 *
 * 筛选是**纯 UI 层过滤**：不影响 trace 采集，不影响环形缓冲的丢弃逻辑。被筛掉的
 * 条目仍然在 store 里，取消筛选即恢复。所以这里是个纯函数，拿到的是只读快照。
 */

import type { TraceEntry } from './traceStore';

/**
 * 筛选条件。三个字段都用「集合为空表示不筛」的语义。
 *
 * 用 `undefined`/空集合表示「全选」而不是「把所有值都列进去」：后者在有新角色或
 * 新 uid 出现时会把它们排除在外，而正确行为是新来的也应该显示。
 */
export interface TraceFilter {
  kinds?: readonly string[];
  roles?: readonly string[];
  uids?: readonly string[];
}

function passes(value: string, allowed: readonly string[] | undefined): boolean {
  // 空集合 = 不筛这一维。
  return !allowed || allowed.length === 0 || allowed.includes(value);
}

/** 纯函数：不改入参，返回新数组。 */
export function filterTraces(
  entries: readonly TraceEntry[],
  filter: TraceFilter,
): TraceEntry[] {
  return entries.filter(
    (entry) =>
      passes(entry.kind, filter.kinds) &&
      passes(entry.role, filter.roles) &&
      passes(entry.uid, filter.uids),
  );
}

/** 从条目里收集某一维出现过的全部取值，用于渲染筛选器选项。保持首次出现的顺序。 */
export function collectValues(
  entries: readonly TraceEntry[],
  field: 'kind' | 'role' | 'uid',
): string[] {
  const seen: string[] = [];
  for (const entry of entries) {
    const value = entry[field];
    if (!seen.includes(value)) seen.push(value);
  }
  return seen;
}
