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

import { BrowserRouter, Link, Navigate, Outlet, Route, Routes, useParams } from 'react-router-dom';

import { EnvGuide } from './EnvGuide';
import { ScenePlaceholder } from './ScenePlaceholder';
import type { ResolvedEnv } from './env';
import { findCategory, findScene, sceneCategories } from '../scenes/registry';

/** 唯一已实现的场景，兼作根路径的落点。 */
const DEFAULT_PATH = '/social/voice-room';

/**
 * 一级 tab 条：logo + 8 个分类 + 右侧配置提示。
 *
 * 右侧提示读真实的 env 来源，不写死文案 —— 否则「App ID 来自环境注入」这句话
 * 与实际配置无关，看不出当前用的是注入值还是本地兜底。
 */
function PrimaryTabs({ activeCategoryId, env }: { activeCategoryId: string; env: ResolvedEnv }) {
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
      <div className="lab-topbar__aside" data-testid="env-hint">
        App ID 来自 {env.source ?? '未配置'}
      </div>
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
 * 时间线面板占位。
 *
 * 本票只保证它在主体内占住右栏；条目渲染、三维筛选与折叠交互属票 16 与票 20。
 */
function TimelinePanelPlaceholder() {
  return (
    <aside className="lab-timeline" aria-label="时间线">
      <div className="lab-timeline__header">时间线</div>
      {/* __body 是窄屏横排的作用对象：宽屏纵向堆叠，≤1240px 时改为横向滚动。 */}
      <div className="lab-timeline__body">
        <p className="lab-timeline__empty">RTM 调用与事件将在这里按时间交错呈现。</p>
      </div>
    </aside>
  );
}

/** 语聊房主区占位：本票只落路由与外壳，真实双客户端编排属票 22。 */
function VoiceRoomStub() {
  return (
    <div className="lab-scene-stub" data-testid="scene-voice-room">
      <p className="lab-scene-stub__badge">已实现</p>
      <h1 className="lab-scene-stub__title">{findScene('voice-room')?.title}</h1>
      <p>两个真实客户端将跑在同一个标签页里。主区内容由后续票接入。</p>
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
  ['voice-room', VoiceRoomStub],
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

/**
 * 四层外壳。作为 layout route，`<Outlet />` 之外的部分在场景切换时保持挂载。
 */
function LabShell({ env }: { env: ResolvedEnv }) {
  const { categoryId = '', sceneId = '' } = useParams();

  return (
    <div className="lab-shell">
      <PrimaryTabs activeCategoryId={categoryId} env={env} />
      <SecondaryTabs categoryId={categoryId} activeSceneId={sceneId} />
      <div className="lab-body">
        <main className="lab-main">
          <Outlet />
        </main>
        <TimelinePanelPlaceholder />
      </div>
      {/* 场景说明与能力标签的落点，本票不实现内容（见 spec 布局第四层）。 */}
      <div className="lab-bottom" data-testid="bottom-reserved" />
    </div>
  );
}

export interface LabRoutesProps {
  env: ResolvedEnv;
}

/**
 * 路由表。不自带 router —— 由调用方提供 router 上下文，测试因此可以用
 * `MemoryRouter` 指定起始路径，生产代码用 `BrowserRouter`。
 */
export function LabRoutes({ env }: LabRoutesProps) {
  // 渲染任何场景之前先过配置判定：未配置则只有引导页，不进场景。
  if (!env.configured) return <EnvGuide />;

  return (
    <Routes>
      <Route path="/" element={<Navigate to={DEFAULT_PATH} replace />} />
      <Route path="/:categoryId/:sceneId" element={<LabShell env={env} />}>
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
