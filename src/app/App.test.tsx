import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { LabRoutes, sceneComponents } from './App';
import { experienceScenarios } from './experienceScenarios';
import { capabilitiesOf } from '../scenes/capabilities';
import { allScenes } from '../scenes/registry';
import { createVoiceRoomFakes } from '../scenes/voice-room/testing';

/** 已配置的 env，供大多数用例复用。 */
const CONFIGURED = { configured: true, appId: 'test-app-id', source: 'window.__ENV__' } as const;

/**
 * 测起始路径用 `MemoryRouter` 包 `LabRoutes`。
 * `App` 自带 `BrowserRouter`，路由表单独导出正是为了让测试能换 router。
 *
 * **必须注入语聊房替身。** 语聊房场景一挂载就自动连接（零表单进房），不注入的话
 * 这里每个用例都会去连真实 RTM。外壳测试关心的是路由与四层布局，不是连接结果。
 */
function renderApp(
  options: { env?: typeof CONFIGURED | { configured: false }; path?: string } = {},
) {
  const { env = CONFIGURED, path = '/' } = options;
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LabRoutes env={env} voiceRoomOverrides={createVoiceRoomFakes().overrides} />
    </MemoryRouter>,
  );
}

describe('实验室外壳', () => {
  it('顶栏不展示 App ID 或其 env 来源', () => {
    renderApp();

    expect(screen.queryByTestId('env-hint')).not.toBeInTheDocument();
    expect(screen.queryByText(/App ID 来自/)).not.toBeInTheDocument();
  });

  it('顶部只有指定的七个一级场景，直接指向对应内容', () => {
    renderApp();
    const nav = screen.getByRole('navigation', { name: '一级场景分类' });
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual([
      '语聊房', '1V1呼叫邀请', '电商直播', '在线课堂', '虚拟世界', '游戏互动', '文档协同',
    ]);
    for (const scenario of experienceScenarios) {
      expect(within(nav).getByRole('link', { name: scenario.label })).toHaveAttribute('href', scenario.path);
    }
    expect(screen.queryByRole('navigation', { name: '二级场景' })).not.toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: '语聊房' })).toHaveAttribute('aria-current', 'page');
  });

  it('所有未建场景可切换，标题和体验路径随场景变化', async () => {
    const user = userEvent.setup();
    renderApp();
    for (const scenario of experienceScenarios.filter((item) => item.status === 'planned')) {
      const link = within(screen.getByRole('navigation')).getByRole('link', { name: scenario.label });
      await user.click(link);
      expect(link).toHaveAttribute('aria-current', 'page');
      expect(within(screen.getByTestId('scene-placeholder')).getByRole('heading', { name: scenario.label })).toBeInTheDocument();
      const path = screen.getByRole('complementary', { name: '体验路径' });
      expect(within(path).getByText(`${scenario.label}的体验任务正在准备中。`)).toBeInTheDocument();
      expect(within(path).queryByRole('progressbar')).not.toBeInTheDocument();
    }
  });

  it('体验路径有五步任务、Console 和三项文档入口，悬浮说明不会手动完成任务', async () => {
    const user = userEvent.setup();
    renderApp();
    const path = screen.getByRole('complementary', { name: '体验路径' });
    expect(within(path).getByRole('heading', { name: /场景任务/ })).toBeInTheDocument();
    expect(within(path).getByRole('heading', { name: /开始构建/ })).toBeInTheDocument();
    expect(within(path).getByRole('heading', { name: /开发文档/ })).toBeInTheDocument();
    expect(within(path).getByRole('progressbar')).toHaveAttribute('aria-valuemax', '5');
    for (const step of experienceScenarios[0].steps) {
      const button = within(path).getByRole('button', { name: new RegExp(step.title) });
      await user.hover(button);
      expect(screen.getByRole('tooltip')).toHaveTextContent(step.instruction);
      expect(within(path).queryByText(step.milestones[0].label)).not.toBeInTheDocument();
      await user.unhover(button);
      await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
    }
    expect(within(path).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    for (const label of ['前往 Console 创建项目', '产品简介', '最佳实践', 'API参考']) {
      const link = within(path).getByRole('link', { name: label });
      expect(link).toHaveAttribute('target', '_blank');
      expect(link.getAttribute('href')).toMatch(/^https:\/\//);
    }
  });

  it('时间线面板占位存在于主体内', () => {
    renderApp();

    expect(screen.getByRole('complementary', { name: '时间线' })).toBeInTheDocument();
  });

  it('房间与数据流之间提供可拖拽分隔器，并支持键盘调整宽度', async () => {
    const user = userEvent.setup();
    const { container } = renderApp({ path: '/social/voice-room' });
    const body = container.querySelector<HTMLElement>('.lab-body')!;
    const timeline = screen.getByRole('complementary', { name: '时间线' });
    const separator = screen.getByRole('separator', { name: '调整房间与数据流宽度' });
    body.getBoundingClientRect = () => ({ width: 1200 } as DOMRect);
    timeline.getBoundingClientRect = () => ({
      width: Number.parseFloat(body.style.getPropertyValue('--lab-timeline-width')) || 500,
    } as DOMRect);

    await user.click(separator);
    await user.keyboard('{ArrowLeft}');
    expect(body.style.getPropertyValue('--lab-timeline-width')).toBe('524px');

    await user.keyboard('{ArrowRight}');
    expect(body.style.getPropertyValue('--lab-timeline-width')).toBe('500px');
  });

  it('向左或向右拖动分隔器时同步调整两侧宽度，并受最小宽度约束', () => {
    const { container } = renderApp({ path: '/social/voice-room' });
    const body = container.querySelector<HTMLElement>('.lab-body')!;
    const timeline = screen.getByRole('complementary', { name: '时间线' });
    const separator = screen.getByRole('separator', { name: '调整房间与数据流宽度' });
    body.getBoundingClientRect = () => ({ width: 1200 } as DOMRect);
    timeline.getBoundingClientRect = () => ({
      width: Number.parseFloat(body.style.getPropertyValue('--lab-timeline-width')) || 500,
    } as DOMRect);

    fireEvent.pointerDown(separator, { button: 0, pointerId: 1, clientX: 600 });
    fireEvent.pointerMove(separator, { pointerId: 1, clientX: 550 });
    fireEvent.pointerUp(separator, { pointerId: 1, clientX: 550 });
    expect(body.style.getPropertyValue('--lab-timeline-width')).toBe('550px');

    fireEvent.pointerDown(separator, { button: 0, pointerId: 2, clientX: 600 });
    fireEvent.pointerMove(separator, { pointerId: 2, clientX: 2000 });
    fireEvent.pointerUp(separator, { pointerId: 2, clientX: 2000 });
    expect(body.style.getPropertyValue('--lab-timeline-width')).toBe('400px');
  });

  it('数据流折叠后隐藏分隔器', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/social/voice-room' });

    await user.click(screen.getByRole('button', { name: '折叠' }));
    expect(screen.queryByRole('separator', { name: '调整房间与数据流宽度' })).not.toBeInTheDocument();
  });

  it('切换场景只替换主区内容，导航、体验路径与时间线面板不动', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/social/voice-room' });

    const primaryNav = screen.getByRole('navigation', { name: '一级场景分类' });
    const path = screen.getByRole('complementary', { name: '体验路径' });
    const timeline = screen.getByRole('complementary', { name: '时间线' });

    await user.click(screen.getByRole('link', { name: '1V1呼叫邀请' }));

    // 同一批 DOM 节点仍在原位（未被卸载重建）
    expect(screen.getByRole('navigation', { name: '一级场景分类' })).toBe(primaryNav);
    expect(screen.getByRole('complementary', { name: '体验路径' })).toBe(path);
    expect(screen.getByRole('complementary', { name: '时间线' })).toBe(timeline);
  });
});

describe('路由', () => {
  it('根路径重定向到语聊房 —— 唯一已实现的场景', () => {
    renderApp({ path: '/' });

    expect(screen.getByTestId('scene-voice-room')).toBeInTheDocument();
  });

  it('URL 形如「一级分类 / 二级场景」', () => {
    renderApp({ path: '/social/voice-room' });

    expect(screen.getByTestId('scene-voice-room')).toBeInTheDocument();
  });

  it('未知场景 id 渲染未找到提示，不白屏', () => {
    renderApp({ path: '/social/no-such-scene' });

    expect(screen.getByText(/未找到/)).toBeInTheDocument();
  });

  it('一级分类必须真的包含该二级场景 —— 错配的 URL 不渲染场景', () => {
    // voice-room 归社交，不归游戏。放行会让二级 tab 没有 active 项，
    // 「一级 / 二级」的从属关系形同虚设。
    renderApp({ path: '/gaming/voice-room' });

    expect(screen.queryByTestId('scene-voice-room')).not.toBeInTheDocument();
    expect(screen.getByText(/未找到/)).toBeInTheDocument();
  });
});

describe('已实现场景的主区容器', () => {
  it('由注册表按 id 映射到组件，未登记映射的 ready 场景不静默渲染成语聊房', () => {
    // 护栏：将来加第二个 ready 场景时，忘了登记映射必须能被发现，
    // 而不是静默渲染出语聊房。
    renderApp({ path: '/social/voice-room' });

    expect(screen.getByTestId('scene-voice-room')).toBeInTheDocument();
    expect(sceneComponents.has('voice-room')).toBe(true);
    // 每个登记了映射的 id 都必须真的是 ready 状态
    for (const sceneId of sceneComponents.keys()) {
      expect(allScenes.find((scene) => scene.id === sceneId)?.status).toBe('ready');
    }
    // 反过来：每个 ready 场景都必须登记映射
    for (const scene of allScenes.filter((entry) => entry.status === 'ready')) {
      expect(sceneComponents.has(scene.id)).toBe(true);
    }
  });
});

describe('占位页', () => {
  it('计划中场景点进去是统一占位页', () => {
    renderApp({ path: '/social/live-pk' });

    expect(screen.getByTestId('scene-placeholder')).toBeInTheDocument();
  });

  it('占位页复用同一个组件，不给每个未实现场景单独写文案', () => {
    renderApp({ path: '/social/live-pk' });
    const first = screen.getByTestId('scene-placeholder').textContent ?? '';

    renderApp({ path: '/gaming/game-voice-chat' });
    const placeholders = screen.getAllByTestId('scene-placeholder');
    const second = placeholders[placeholders.length - 1].textContent ?? '';

    // 每个场景独有的部分只有标题、摘要与能力标签，全部来自注册表与能力登记表；
    // 抹掉它们之后剩下的引导文案必须完全相同 —— 那部分是共用的，不逐场景撰写。
    const strip = (text: string, sceneId: string) => {
      const scene = allScenes.find((entry) => entry.id === sceneId)!;
      const experience = experienceScenarios.find((item) => item.path.endsWith(`/${sceneId}`));
      let stripped = text.replace(experience?.label ?? scene.title, '').replace(experience?.description ?? scene.summary, '');
      for (const capability of capabilitiesOf(sceneId)) {
        stripped = stripped.replaceAll(capability, '');
      }
      return stripped;
    };
    expect(strip(first, 'live-pk')).toBe(strip(second, 'game-voice-chat'));
  });

  it('占位页指向语聊房', () => {
    renderApp({ path: '/social/live-pk' });

    const placeholder = screen.getByTestId('scene-placeholder');
    expect(within(placeholder).getByRole('link', { name: /语聊房/ })).toBeInTheDocument();
  });

  it('占位页写明该场景计划演示哪些 RTM 能力', () => {
    renderApp({ path: '/social/live-pk' });

    const placeholder = screen.getByTestId('scene-placeholder');
    for (const capability of capabilitiesOf('live-pk')) {
      expect(within(placeholder).getByText(capability)).toBeInTheDocument();
    }
  });
});

describe('env 未配置', () => {
  it('渲染引导页，不进场景', () => {
    renderApp({ env: { configured: false }, path: '/social/voice-room' });

    expect(screen.getByTestId('env-guide')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '前往 Console 创建项目' })).toBeInTheDocument();
    expect(screen.queryByTestId('scene-voice-room')).not.toBeInTheDocument();
  });

  it('引导页给出本地与线上两种配置方式，措辞不用报错口吻', () => {
    renderApp({ env: { configured: false } });

    const guide = screen.getByTestId('env-guide');
    expect(guide.textContent).toContain('VITE_APP_ID');
    expect(guide.textContent).toContain('__ENV__');
    // 未配置不是异常，不该出现报错字样
    expect(guide.textContent).not.toMatch(/错误|失败|异常/);
  });
});
