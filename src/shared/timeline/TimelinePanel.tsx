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

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Activity, ChevronsRight, Eraser, RadioTower, Unplug } from 'lucide-react';

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

/** Keeps high-resolution durations readable without changing the stored value. */
function formatDurationMs(durationMs: number): string {
  const rounded = Math.round(durationMs * 1_000) / 1_000;
  return `${rounded}ms`;
}

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

/** 单条时间线条目。行布局是三列网格：色点轨道 16px、时间 82px、正文自适应。 */
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
          <span className="lab-trace__tag" data-kind={entry.kind}>{entry.kind === 'api' ? 'API' : '事件'}</span>
          {entry.eventTag && <span className="lab-trace__tag" data-kind="event-type">{entry.eventTag}</span>}
          {/* 保留角色配色来源供现有 trace 数据兼容；UI 通过 CSS 隐藏技术 UID。 */}
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
            <span className="lab-trace__duration">{formatDurationMs(entry.durationMs)}</span>
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
  const [showLinkState, setShowLinkState] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);

  // 类型选项从全量条目算，不从筛选结果算，保证取消某个类型后能立即恢复。
  const kinds = useMemo(() => collectValues(entries, 'kind'), [entries]);
  const visible = useMemo(
    () => filterTraces(entries, filter).filter((entry) => showLinkState || entry.name !== 'linkState'),
    [entries, filter, showLinkState],
  );

  const filtering = (filter.kinds?.length ?? 0) > 0;

  // 新的 RTM 调用或事件进入时，始终把时间线定位到最新一项。
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [visible]);

  /** 多选：已选则移除，未选则加入。 */
  function toggleKind(value: string) {
    setFilter((current) => {
      const kinds = current.kinds ?? [];
      const next = kinds.includes(value)
        ? kinds.filter((item) => item !== value)
        : [...kinds, value];
      return { kinds: next };
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
          <span className="lab-timeline__collapse-text">数据流时间线</span>
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
        <div className="lab-timeline__heading">
          <span className="lab-timeline__heading-icon" aria-hidden="true">
            <Activity size={17} />
          </span>
          <div>
            <span className="lab-timeline__title">RTM 数据流</span>
            <small>按发生顺序观察 API 调用与服务端事件</small>
          </div>
          <span className="lab-timeline__entry-count" aria-label={`${entries.length} 条记录`}>
            {entries.length}
          </span>
        </div>

        <div className="lab-timeline__actions">
          <button
            type="button"
            className="lab-timeline__action"
            onClick={() => sources.forEach((source) => source.clear?.())}
            data-testid="timeline-clear"
          >
            <Eraser size={13} aria-hidden="true" />
            清空
          </button>
          <button
            type="button"
            className="lab-timeline__action"
            onClick={() => setShowLinkState((current) => !current)}
            aria-pressed={showLinkState}
          >
            {showLinkState ? <Unplug size={13} aria-hidden="true" /> : <RadioTower size={13} aria-hidden="true" />}
            {showLinkState ? '隐藏连接' : '显示连接'}
          </button>
          <button
            type="button"
            className="lab-timeline__action"
            onClick={onToggleCollapsed}
            aria-expanded
            data-testid="timeline-toggle"
          >
            <ChevronsRight size={13} aria-hidden="true" />
            折叠
          </button>
        </div>

        {/* 图例：一眼分辨哪些是主动调用、哪些是被动接收。 */}
        <div className="lab-timeline__legend" data-testid="timeline-legend">
          {(['api', 'event'] as const).map((kind) => (
            <span key={kind} className="lab-timeline__legend-item">
              <span className="lab-trace__dot" data-kind={kind} aria-hidden="true" />
              {KIND_LABELS[kind]}
            </span>
          ))}
        </div>
      </div>

      {/* 单端房间只需按 API/事件类型筛选。 */}
      <div className="lab-timeline__filters">
        <FilterRow
          label="类型筛选"
          options={kinds}
          picked={filter.kinds}
          onToggle={toggleKind}
          testId="filter-kind"
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

      <div className="lab-timeline__body" ref={bodyRef} data-testid="timeline-body">
        {visible.length === 0 ? (
          <p className="lab-timeline__empty">
            {entries.length === 0
              ? 'RTM 调用与事件将在这里按时间交错呈现。'
              : '当前筛选下没有条目。取消筛选即可恢复。'}
          </p>
        ) : (
          <ol className="lab-timeline__list">
            {visible.map((entry) => (
              // key 用 role + uid + seq：页面级 login 与角色 trace 可共享同一 uid/seq。
              <TraceRow key={`${entry.role}:${entry.uid}:${entry.seq}`} entry={entry} />
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
}
