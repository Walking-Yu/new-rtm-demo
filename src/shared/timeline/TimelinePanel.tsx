/**
 * 时间线面板 —— 本 demo 的**核心展示物**。
 *
 * 把每一次 RTM API 调用与每一个 RTM 事件按时间串成一条流水，让读者点一次
 * 「申请上麦」就能看到两端各发生了什么、顺序如何、耗时多少。
 *
 * ## 三条不要「优化」掉的设计
 *
 * **单列交错，不按端分栏。** 两端的条目混在同一列里按时间排。分栏会把
 * 「一个动作在两端引发的因果链」拆散，而那正是本 demo 要展示的东西。
 *
 * **只呈现 RTM，不含 RTC。** 混入 RTC 节点会稀释「RTM 数据流」这条主线。
 * RTC 的成败体现为后续那次 RTM 调用的出现或缺席（麦位激活由媒体结果驱动），
 * 因果仍然看得懂。
 *
 * **筛选是纯 UI 过滤。** 被筛掉的条目仍在 store 里，取消筛选即恢复 ——
 * 筛选不动采集、不动环形缓冲的丢弃逻辑。筛选状态是本组件的局部状态。
 *
 * ## 没有「已截断」提示
 *
 * 环形缓冲超限**静默**丢弃最旧的，面板不显示任何截断提示（见票 16 与 spec）。
 */

import { useMemo, useState } from 'react';

import { collectValues, filterTraces, type TraceFilter } from './filterTraces';
import { formatTraceTime } from './formatTraceTime';
import { roleColor } from './roleColors';
import type { TraceEntry } from './traceStore';
import { useMergedTraces, type TraceSource } from './useMergedTraces';

/** 两类节点的图例文案。类型只有这两个值。 */
const KIND_LABELS: Record<string, string> = {
  api: '调用 RTM API',
  event: '收到 RTM 事件',
};

const NO_FILTER: TraceFilter = {};

export interface TimelinePanelProps {
  /** 各端的 trace 来源。多端顺序不影响结果 —— 归并按时间戳排。 */
  sources: readonly TraceSource[];
  /** 折叠态由外层持有：折叠会改变外壳的栅格（1fr/400px → 1fr/40px）。 */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

/** 某一维筛选是否放行某个值。空集合表示不筛。 */
function isPicked(allowed: readonly string[] | undefined, value: string): boolean {
  return Boolean(allowed?.includes(value));
}

/**
 * 一条筛选维度的按钮组。
 *
 * 选中项再点一次即取消（回到「全部」），所以不需要单独的「全部」按钮。
 */
function FilterRow({
  label,
  options,
  picked,
  onToggle,
  testId,
}: {
  label: string;
  options: readonly string[];
  picked: readonly string[] | undefined;
  onToggle: (value: string) => void;
  testId: string;
}) {
  if (options.length === 0) return null;

  return (
    <div className="lab-timeline__filter-row" data-testid={testId}>
      <span className="lab-timeline__filter-label">{label}</span>
      {options.map((option) => {
        const selected = isPicked(picked, option);
        return (
          <button
            key={option}
            type="button"
            className="lab-timeline__filter"
            data-active={selected}
            aria-pressed={selected}
            // 再点一次取消 —— 于是「取消筛选后条目全部回来」不需要额外入口。
            onClick={() => onToggle(option)}
          >
            {KIND_LABELS[option] ?? option}
          </button>
        );
      })}
    </div>
  );
}

/** 单条时间线条目。行布局是三列网格：色点轨道 16px、时间 62px、正文自适应。 */
function TraceRow({ entry }: { entry: TraceEntry }) {
  const failed = entry.errorCode !== undefined || entry.errorMessage !== undefined;

  return (
    <li
      className="lab-trace"
      data-kind={entry.kind}
      data-role={entry.role}
      data-failed={failed}
      data-testid="trace-row"
    >
      {/* 色点轨道：api 与 event **靠左侧色点区分**。 */}
      <span className="lab-trace__dot" data-kind={entry.kind} aria-hidden="true" />

      {/* 时间砍掉小时，只到分秒毫秒 —— 便于分辨紧邻的调用。 */}
      <time className="lab-trace__time">{formatTraceTime(entry.at)}</time>

      <div className="lab-trace__body">
        <div className="lab-trace__head">
          {/* uid badge 颜色按角色固定，与主区身份条同色（同一处配色来源）。 */}
          <span
            className="lab-uid-badge"
            data-role={entry.role}
            data-testid="uid-badge"
            style={{
              color: roleColor(entry.role).accent,
              background: roleColor(entry.role).soft,
            }}
          >
            {entry.uid}
          </span>
          <span className="lab-trace__name">{entry.name}</span>
          {/* 耗时仅 api 条目有。 */}
          {entry.durationMs !== undefined && (
            <span className="lab-trace__duration">{entry.durationMs}ms</span>
          )}
        </div>
        {entry.summary && <div className="lab-trace__summary">{entry.summary}</div>}
        {/* 失败带错误码与错误信息 —— 出错时才知道该查什么。 */}
        {failed && (
          <div className="lab-trace__error" data-testid="trace-error">
            {entry.errorCode !== undefined && <code>{entry.errorCode}</code>}
            {entry.errorMessage}
          </div>
        )}
      </div>
    </li>
  );
}

export function TimelinePanel({
  sources,
  collapsed = false,
  onToggleCollapsed,
}: TimelinePanelProps) {
  // 外部 store 订阅：**API 被调用的瞬间节点就出现**，不轮询、不做整数组 diff。
  const entries = useMergedTraces(sources);
  const [filter, setFilter] = useState<TraceFilter>(NO_FILTER);

  // 选项从**全量**条目算，不从筛选结果算 —— 否则选了一个维度后其他维度的
  // 选项会跟着消失，用户就回不去了。
  const kinds = useMemo(() => collectValues(entries, 'kind'), [entries]);
  const roles = useMemo(() => collectValues(entries, 'role'), [entries]);
  const uids = useMemo(() => collectValues(entries, 'uid'), [entries]);
  const visible = useMemo(() => filterTraces(entries, filter), [entries, filter]);

  const filtering =
    (filter.kinds?.length ?? 0) > 0 ||
    (filter.roles?.length ?? 0) > 0 ||
    (filter.uids?.length ?? 0) > 0;

  /** 多选：已选则移除，未选则加入。 */
  function toggle(key: keyof TraceFilter) {
    return (value: string) =>
      setFilter((current) => {
        const list = current[key] ?? [];
        const next = list.includes(value)
          ? list.filter((item) => item !== value)
          : [...list, value];
        return { ...current, [key]: next };
      });
  }

  if (collapsed) {
    return (
      <aside className="lab-timeline lab-timeline--collapsed" aria-label="时间线">
        <button
          type="button"
          className="lab-timeline__collapse"
          onClick={onToggleCollapsed}
          aria-expanded={false}
          data-testid="timeline-toggle"
        >
          <span className="lab-timeline__collapse-text">时间线</span>
          {/* 折叠态显示条目计数，让人知道里面还在攒东西。 */}
          <span className="lab-timeline__count" data-testid="timeline-count">
            {entries.length}
          </span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="lab-timeline" aria-label="时间线">
      <div className="lab-timeline__header">
        <span className="lab-timeline__title">时间线</span>

        {/* 图例：一眼分辨哪些是主动调用、哪些是被动接收。 */}
        <div className="lab-timeline__legend" data-testid="timeline-legend">
          {(['api', 'event'] as const).map((kind) => (
            <span key={kind} className="lab-timeline__legend-item">
              <span className="lab-trace__dot" data-kind={kind} aria-hidden="true" />
              {KIND_LABELS[kind]}
            </span>
          ))}
        </div>

        <div className="lab-timeline__actions">
          <button
            type="button"
            className="lab-timeline__action"
            onClick={() => sources.forEach((source) => source.clear?.())}
            data-testid="timeline-clear"
          >
            清空
          </button>
          <button
            type="button"
            className="lab-timeline__action"
            onClick={onToggleCollapsed}
            aria-expanded
            data-testid="timeline-toggle"
          >
            折叠
          </button>
        </div>
      </div>

      {/* 三维筛选。三者都是条目上已有字段，**不为筛选新增数据字段**。 */}
      <div className="lab-timeline__filters">
        <FilterRow
          label="类型"
          options={kinds}
          picked={filter.kinds}
          onToggle={toggle('kinds')}
          testId="filter-kind"
        />
        <FilterRow
          label="角色"
          options={roles}
          picked={filter.roles}
          onToggle={toggle('roles')}
          testId="filter-role"
        />
        <FilterRow
          label="uid"
          options={uids}
          picked={filter.uids}
          onToggle={toggle('uids')}
          testId="filter-uid"
        />
        {filtering && (
          <button
            type="button"
            className="lab-timeline__action"
            onClick={() => setFilter(NO_FILTER)}
            data-testid="filter-reset"
          >
            取消筛选
          </button>
        )}
      </div>

      <div className="lab-timeline__body">
        {visible.length === 0 ? (
          <p className="lab-timeline__empty">
            {entries.length === 0
              ? 'RTM 调用与事件将在这里按时间交错呈现。'
              : '当前筛选下没有条目。取消筛选即可恢复。'}
          </p>
        ) : (
          <ol className="lab-timeline__list">
            {visible.map((entry) => (
              // key 用 uid + seq：seq 只在实例内单调，跨实例会撞。
              <TraceRow key={`${entry.uid}:${entry.seq}`} entry={entry} />
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
}
