import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { LabRoutes, sceneComponents } from './App';
import { capabilitiesOf } from '../scenes/capabilities';
import { allScenes, sceneCategories } from '../scenes/registry';
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
  it('一级 tab 条列出全部 8 个分类', () => {
    renderApp();

    const primaryNav = screen.getByRole('navigation', { name: '一级场景分类' });
    for (const category of sceneCategories) {
      expect(within(primaryNav).getByRole('link', { name: category.label })).toBeInTheDocument();
    }
    expect(within(primaryNav).getAllByRole('link')).toHaveLength(8);
  });

  it('二级 tab 条只列出当前一级分类下的场景', () => {
    renderApp();

    const secondaryNav = screen.getByRole('navigation', { name: '二级场景' });
    // 默认落在社交分类，它有 6 个场景
    expect(within(secondaryNav).getAllByRole('link')).toHaveLength(6);
    expect(within(secondaryNav).getByRole('link', { name: /语聊房/ })).toBeInTheDocument();
  });

  it('切一级分类后二级 tab 条随之更新', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('link', { name: '游戏' }));

    const secondaryNav = screen.getByRole('navigation', { name: '二级场景' });
    expect(within(secondaryNav).getAllByRole('link')).toHaveLength(1);
    expect(within(secondaryNav).getByRole('link', { name: /游戏语音房/ })).toBeInTheDocument();
  });

  it('计划中场景的 tab 可点，不是 disabled —— 灰置会让客户以为坏了', () => {
    renderApp();

    const secondaryNav = screen.getByRole('navigation', { name: '二级场景' });
    for (const link of within(secondaryNav).getAllByRole('link')) {
      expect(link).not.toHaveAttribute('aria-disabled', 'true');
    }
  });

  it('外壳是自上而下四层，底部预留区存在但本票不实现内容', () => {
    renderApp();

    expect(screen.getByRole('navigation', { name: '一级场景分类' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '二级场景' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByTestId('bottom-reserved')).toBeInTheDocument();
  });

  it('时间线面板占位存在于主体内', () => {
    renderApp();

    expect(screen.getByRole('complementary', { name: '时间线' })).toBeInTheDocument();
  });

  it('切换场景只替换主区内容，两级 tab 与时间线面板不动', async () => {
    const user = userEvent.setup();
    renderApp({ path: '/social/voice-room' });

    const primaryNav = screen.getByRole('navigation', { name: '一级场景分类' });
    const secondaryNav = screen.getByRole('navigation', { name: '二级场景' });
    const timeline = screen.getByRole('complementary', { name: '时间线' });

    await user.click(screen.getByRole('link', { name: /连麦、PK/ }));

    // 同一批 DOM 节点仍在原位（未被卸载重建）
    expect(screen.getByRole('navigation', { name: '一级场景分类' })).toBe(primaryNav);
    expect(screen.getByRole('navigation', { name: '二级场景' })).toBe(secondaryNav);
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
      let stripped = text.replace(scene.title, '').replace(scene.summary, '');
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
