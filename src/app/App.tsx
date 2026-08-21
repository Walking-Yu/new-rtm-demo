/**
 * 实验室外壳与路由。
 *
 * 外壳自上而下四层（见 spec「实验室外壳布局」）：
 * 一级 tab 条 → 二级 tab 条 → 主体（主区 + 时间线面板）→ 底部预留区。
 *
 * 布局数值由 CSS 承载，均为用户两轮确认过的具体值，**不要回退**：
 * 主区与时间线 `1fr / 400px`、折叠态 `1fr / 40px`、1240px 及以下退化为单列。
 *
 * 切换场景只替换主区内容 —— 靠 layout route + `<Outlet />` 保证两级 tab 与
 * 时间线面板的 DOM 节点不被卸载重建。
 */

import { useCallback, useMemo, useRef, useState, type CSSProperties } from 'react';
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes, useParams } from 'react-router-dom';

import { EnvGuide } from './EnvGuide';
import { ScenePlaceholder } from './ScenePlaceholder';
import type { ResolvedEnv } from './env';
import { SceneContextProvider, useSceneContext, type VoiceRoomOverrides } from './sceneContext';
import { findCategory, findScene, sceneCategories } from '../scenes/registry';
import { TimelinePanel } from '../shared/timeline/TimelinePanel';
import type { TraceSource } from '../shared/timeline/useMergedTraces';
import { VoiceRoomScene } from '../scenes/voice-room/VoiceRoomScene';

/** 唯一已实现的场景，兼作根路径的落点。 */
const DEFAULT_PATH = '/social/voice-room';

/**
 * 一级 tab 条：logo + 8 个分类。
 */
function PrimaryTabs({ activeCategoryId }: { activeCategoryId: string }) {
  return (
    <header className="lab-topbar">
      <div className="lab-logo">
        <span className="lab-logo__mark" aria-hidden="true" />
        RTM 场景实验室
      </div>
      <nav className="lab-tabs lab-tabs--primary" aria-label="一级场景分类">
        {sceneCategories.map((category) => (
          <Link
            key={category.id}
            to={`/${category.id}/${category.scenes[0].id}`}
            className="lab-tab lab-tab--primary"
            data-active={category.id === activeCategoryId}
            aria-label={category.label}
          >
            {/* 完整 label 与窄屏短名各渲染一份，由 CSS 断点决定显示哪个。 */}
            <span className="lab-tab__full">{category.label}</span>
            <span className="lab-tab__short">{category.shortLabel}</span>
          </Link>
        ))}
      </nav>
    </header>
  );
}

/**
 * 二级 tab 条：药丸形，当前一级分类下的场景。
 *
 * 已规划场景的 tab **可见且可点**，只加一个「待建」文字标记 —— 不 disabled
 * （灰置会让客户以为坏了）、不隐藏（违背展示目的）。
 */
function SecondaryTabs({ categoryId, activeSceneId }: { categoryId: string; activeSceneId: string }) {
  const category = findCategory(categoryId);

  return (
    <nav className="lab-tabs lab-tabs--secondary" aria-label="二级场景">
      {category?.scenes.map((scene) => (
        <Link
          key={scene.id}
          to={`/${categoryId}/${scene.id}`}
          className="lab-tab lab-tab--secondary"
          data-active={scene.id === activeSceneId}
          data-status={scene.status}
        >
          {scene.title}
          {scene.status === 'planned' && <span className="lab-tab__flag">待建</span>}
        </Link>
      ))}
    </nav>
  );
}

/**
 * 场景还没交上来 trace 来源时的空数组。
 *
 * **必须是模块常量** —— 每次渲染新建数组会让 `useSyncExternalStore` 的 subscribe
 * 依赖变化而反复重订阅。
 */
const NO_TRACE_SOURCES: readonly TraceSource[] = [];
const MIN_ROOM_WIDTH = 480;
const MIN_TIMELINE_WIDTH = 400;
const SPLITTER_WIDTH = 18;
const KEYBOARD_RESIZE_STEP = 24;

/**
 * 语聊房主区：真实的双客户端编排。
 *
 * env 与 trace 回调从上下文取 —— 场景由注册表按 id 查出来渲染，中间隔着路由，
 * 没法用 props 传（见 `sceneContext.ts`）。
 *
 * 未配置 appId 时不渲染场景：`VoiceRoomScene` 一挂载就自动连接，没有 appId
 * 连不上，只会在时间线里刷一串失败。外层路由本就会在未配置时渲染引导页，这里
 * 只是把不变式挑明。
 */
function VoiceRoomContainer() {
  const { env, publishTraceSources, voiceRoomOverrides } = useSceneContext();
  if (!env.configured) return <EnvGuide />;
  return (
    <div data-testid="scene-voice-room">
      <VoiceRoomScene
        env={env}
        search={window.location.search}
        overrides={voiceRoomOverrides}
        onTraceSources={publishTraceSources}
      />
    </div>
  );
}

/**
 * 已实现场景的主区容器映射：场景 id → 组件。
 *
 * 刻意**不用**「非 planned 就渲染语聊房」的隐式分支 —— 那样将来加第二个已实现
 * 场景时，忘了登记映射会静默渲染出语聊房，而不是暴露问题。测试两个方向都断言：
 * 登记的必须是 ready，ready 的必须登记。
 */
export const sceneComponents = new Map<string, () => React.ReactElement>([
  ['voice-room', VoiceRoomContainer],
]);

function SceneNotFound() {
  return (
    <div className="lab-scene-stub">
      <h1 className="lab-scene-stub__title">未找到这个场景</h1>
      <p>
        链接可能已失效。<Link to={DEFAULT_PATH}>前往语聊房</Link>
      </p>
    </div>
  );
}

/** 主区：已实现场景渲染自己的容器，已规划场景渲染统一占位页。 */
function SceneRoute() {
  const { categoryId = '', sceneId = '' } = useParams();
  const scene = findScene(sceneId);

  if (!scene) return <SceneNotFound />;

  // 一级分类必须真的包含这个二级场景。放行错配的 URL（如 /gaming/voice-room）
  // 会让二级 tab 没有 active 项，「一级 / 二级」的从属关系形同虚设。
  const belongsToCategory = findCategory(categoryId)?.scenes.some((item) => item.id === sceneId);
  if (!belongsToCategory) return <SceneNotFound />;

  if (scene.status === 'planned') return <ScenePlaceholder scene={scene} />;

  const SceneContainer = sceneComponents.get(scene.id);
  if (!SceneContainer) return <SceneNotFound />;
  return <SceneContainer />;
}

interface LabShellProps {
  env: ResolvedEnv;
  voiceRoomOverrides?: VoiceRoomOverrides;
}

/**
 * 四层外壳。作为 layout route，`<Outlet />` 之外的部分在场景切换时保持挂载。
 */
function LabShell({ env, voiceRoomOverrides }: LabShellProps) {
  const { categoryId = '', sceneId = '' } = useParams();
  // 折叠态由外壳持有，不由面板自己 —— 它要改 `.lab-body` 的栅格（1fr/400px → 1fr/40px），
  // 那是外壳的样式，面板拿不到。
  const [collapsed, setCollapsed] = useState(false);
  const [timelineWidth, setTimelineWidth] = useState<number>();
  const [resizing, setResizing] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startWidth: number } | undefined>(undefined);
  // trace 来源由场景在挂载后交上来。外壳持有它，因为时间线面板在 `<Outlet />` 之外，
  // 场景切换时保持挂载。
  const [traceSources, setTraceSources] = useState<readonly TraceSource[]>(NO_TRACE_SOURCES);

  // **必须是稳定引用**：场景把它放进 effect 依赖（见 `sceneContext.ts`），
  // 每次渲染换新函数会让「交出 trace 来源」的 effect 反复重跑。
  const publishTraceSources = useCallback((sources: readonly TraceSource[]) => {
    // 空数组统一收敛到模块常量，避免场景卸载时交上来的新空数组触发下游重订阅。
    setTraceSources(sources.length > 0 ? sources : NO_TRACE_SOURCES);
  }, []);

  const sceneContext = useMemo(
    () => ({ env, publishTraceSources, voiceRoomOverrides }),
    [env, publishTraceSources, voiceRoomOverrides],
  );

  const clampTimelineWidth = useCallback((nextWidth: number) => {
    const body = bodyRef.current;
    const bodyWidth = body?.getBoundingClientRect().width ?? 0;
    const bodyStyle = body ? window.getComputedStyle(body) : undefined;
    const horizontalPadding = bodyStyle
      ? (Number.parseFloat(bodyStyle.paddingLeft) || 0) + (Number.parseFloat(bodyStyle.paddingRight) || 0)
      : 0;
    const contentWidth = bodyWidth - horizontalPadding;
    const maximum = Math.max(
      MIN_TIMELINE_WIDTH,
      contentWidth - MIN_ROOM_WIDTH - SPLITTER_WIDTH,
    );
    return Math.min(maximum, Math.max(MIN_TIMELINE_WIDTH, nextWidth));
  }, []);

  const currentTimelineWidth = (separator: HTMLElement) =>
    separator.nextElementSibling?.getBoundingClientRect().width ?? timelineWidth ?? MIN_TIMELINE_WIDTH;

  return (
    <div className="lab-shell">
      <PrimaryTabs activeCategoryId={categoryId} />
      <SecondaryTabs categoryId={categoryId} activeSceneId={sceneId} />
      <div
        ref={bodyRef}
        className="lab-body"
        data-timeline={collapsed ? 'collapsed' : 'expanded'}
        data-resizing={resizing}
        style={timelineWidth === undefined ? undefined : {
          '--lab-timeline-width': `${timelineWidth}px`,
        } as CSSProperties}
      >
        <main className="lab-main">
          <SceneContextProvider value={sceneContext}>
            <Outlet />
          </SceneContextProvider>
        </main>
        {!collapsed && (
          <div
            className="lab-splitter"
            role="separator"
            aria-label="调整房间与数据流宽度"
            aria-orientation="vertical"
            aria-valuemin={MIN_TIMELINE_WIDTH}
            aria-valuenow={timelineWidth === undefined ? undefined : Math.round(timelineWidth)}
            tabIndex={0}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              dragRef.current = {
                startX: event.clientX,
                startWidth: currentTimelineWidth(event.currentTarget),
              };
              try {
                event.currentTarget.setPointerCapture?.(event.pointerId);
              } catch {
                // 合成 PointerEvent 没有浏览器级 active pointer，拖拽状态仍可继续处理。
              }
              setResizing(true);
            }}
            onPointerMove={(event) => {
              const drag = dragRef.current;
              if (!drag) return;
              setTimelineWidth(clampTimelineWidth(drag.startWidth + drag.startX - event.clientX));
            }}
            onPointerUp={(event) => {
              dragRef.current = undefined;
              if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
              setResizing(false);
            }}
            onPointerCancel={() => {
              dragRef.current = undefined;
              setResizing(false);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              event.preventDefault();
              const direction = event.key === 'ArrowLeft' ? 1 : -1;
              setTimelineWidth(clampTimelineWidth(
                currentTimelineWidth(event.currentTarget) + direction * KEYBOARD_RESIZE_STEP,
              ));
            }}
          >
            <span aria-hidden="true" />
          </div>
        )}
        <TimelinePanel
          sources={traceSources}
          collapsed={collapsed}
          onToggleCollapsed={() => setCollapsed((current) => !current)}
        />
      </div>
      {/* 场景说明与能力标签的落点，本票不实现内容（见 spec 布局第四层）。 */}
      <div className="lab-bottom" data-testid="bottom-reserved" />
    </div>
  );
}

export interface LabRoutesProps {
  env: ResolvedEnv;
  /**
   * 外壳的依赖注入点，只有测试会传。
   *
   * 语聊房场景一挂载就自动连接，测试如果不注入假工厂就会去连真实 RTM。
   * 生产入口（`main.tsx`）不传这个 prop，所以它不改变线上行为。
   */
  voiceRoomOverrides?: VoiceRoomOverrides;
}

/**
 * 路由表。不自带 router —— 由调用方提供 router 上下文，测试因此可以用
 * `MemoryRouter` 指定起始路径，生产代码用 `BrowserRouter`。
 */
export function LabRoutes({ env, voiceRoomOverrides }: LabRoutesProps) {
  // 渲染任何场景之前先过配置判定：未配置则只有引导页，不进场景。
  if (!env.configured) return <EnvGuide />;

  return (
    <Routes>
      <Route path="/" element={<Navigate to={DEFAULT_PATH} replace />} />
      <Route
        path="/:categoryId/:sceneId"
        element={<LabShell env={env} voiceRoomOverrides={voiceRoomOverrides} />}
      >
        <Route index element={<SceneRoute />} />
      </Route>
      <Route path="*" element={<Navigate to={DEFAULT_PATH} replace />} />
    </Routes>
  );
}

export function App({ env }: LabRoutesProps) {
  return (
    <BrowserRouter>
      <LabRoutes env={env} />
    </BrowserRouter>
  );
}
