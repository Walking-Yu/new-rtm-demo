/**
 * 语聊房场景测试。
 *
 * 这里锁的是**票 22 里那些看得见的约束**：两条常驻告警的存在与措辞、手机内区块顺序、
 * 身份条 badge 与时间线同色、卸载时两端都断开、StrictMode 重复挂载不泄漏连接。
 *
 * 顺序敏感的编排（先连房主再连听众、麦位激活由媒体结果驱动）在 `orchestrator.test.ts`
 * 里锁 —— 那部分不该被 `useEffect` 的调度细节缠住，所以刻意不在这里重复断言。
 */

import { render, screen, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { VoiceRoomScene } from './VoiceRoomScene';
import { createVoiceRoomFakes } from './testing';
import { SEAT_COUNT } from './config';
import { roleColor } from '../../shared/timeline/roleColors';

const ENV = { configured: true, appId: 'test-app-id', source: 'window.__ENV__' } as const;

/** 固定房间与 uid，断言身份条内容时不受随机推导影响。 */
const SEARCH = '?room=room-fixed&uid.host=host-1&uid.audience=audience-1';

function renderScene(options: { strict?: boolean; search?: string } = {}) {
  const fakes = createVoiceRoomFakes();
  const element = (
    <VoiceRoomScene env={ENV} search={options.search ?? SEARCH} overrides={fakes.overrides} />
  );
  const result = render(options.strict ? <StrictMode>{element}</StrictMode> : element);
  return { ...result, fakes };
}

describe('常驻告警', () => {
  it('渲染耳机告警 —— 两端都会真实播放音频', () => {
    renderScene();

    expect(screen.getByText('请佩戴耳机')).toBeInTheDocument();
  });

  it('渲染生产边界告警，说明治理动作不构成信任边界', () => {
    renderScene();

    const warning = screen.getByTestId('boundary-warning');
    expect(warning.textContent).toContain('不构成信任边界');
  });

  it('生产边界告警不含「已强制执行」这类表述', () => {
    renderScene();

    // 踢出、封禁、强制麦控都是客户端协作行为：被治理端自己收到命令、自己执行。
    // 把它们说成已强制执行的权限控制会误导拷走这套代码的人。
    const warning = screen.getByTestId('boundary-warning');
    expect(warning.textContent).not.toMatch(/已强制执行|强制执行|已鉴权|服务端校验通过/);
  });

  it('两条告警都常驻页面，不是可折叠的小字', () => {
    renderScene();

    // role="note" 而非藏在 details/summary 里
    expect(screen.getAllByRole('note')).toHaveLength(2);
  });
});

describe('两台手机并排', () => {
  it('渲染房主视角与听众视角两台手机', () => {
    renderScene();

    expect(screen.getByTestId('vr-host')).toBeInTheDocument();
    expect(screen.getByTestId('vr-audience')).toBeInTheDocument();
  });

  it('每台手机有独立的可访问名称，读者能分清视角', () => {
    renderScene();

    expect(screen.getByRole('region', { name: '房主视角' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '听众视角' })).toBeInTheDocument();
  });
});

describe('身份条', () => {
  it('每台手机上方一个身份条，含 uid badge 与视角说明', () => {
    renderScene();

    expect(screen.getByTestId('identity-badge-host').textContent).toBe('host-1');
    expect(screen.getByTestId('identity-badge-audience').textContent).toBe('audience-1');
    expect(screen.getByText('房主视角')).toBeInTheDocument();
    expect(screen.getByText('听众视角')).toBeInTheDocument();
  });

  it('badge 颜色取自 roleColor —— 与时间线里的 badge 同源同色', () => {
    renderScene();

    // 时间线条目 badge 与这里都调 `roleColor`，所以「对得上」是靠共用来源保证的，
    // 不是靠两处各写一遍同样的颜色值。
    const host = screen.getByTestId('identity-badge-host');
    expect(host.style.color).toBe(roleColor('host').accent);
    expect(host.style.background).toBe(roleColor('host').soft);

    const audience = screen.getByTestId('identity-badge-audience');
    expect(audience.style.color).toBe(roleColor('audience').accent);
    expect(audience.style.background).toBe(roleColor('audience').soft);
  });

  it('两端 badge 颜色不同 —— 读者靠颜色而不是文字判断来自哪一端', () => {
    renderScene();

    expect(screen.getByTestId('identity-badge-host').style.color).not.toBe(
      screen.getByTestId('identity-badge-audience').style.color,
    );
  });
});

describe('手机内区块顺序', () => {
  it('自上而下：状态栏、房间头部、麦位网格、角色面板、成员条、公屏、底部操作条', () => {
    renderScene();

    const phone = screen.getByTestId('vr-host');
    // 取最具体的那个类名：角色面板是 `vr-block vr-role-panel`，`vr-block` 是通用外观类，
    // 断言它等于没断言 —— 任何区块都可能带上。
    const blocks = Array.from(phone.children).map((node) => {
      const names = node.className.split(' ').filter((name) => name !== 'vr-block');
      return names[0];
    });

    expect(blocks).toEqual([
      'vr-status-bar',
      'vr-room-header',
      'vr-seats',
      'vr-role-panel',
      'vr-member-bar',
      'vr-chat',
      'vr-action-bar',
    ]);
  });

  it('听众端区块顺序与房主端一致 —— 只有区块内容不同', () => {
    renderScene();

    const order = (testId: string) =>
      Array.from(screen.getByTestId(testId).children).map((node) => node.className.split(' ')[0]);

    expect(order('vr-audience')).toEqual(order('vr-host'));
  });

  it('底部操作条是公屏的兄弟节点且排在最后 —— 常驻手机框内，不随公屏滚走', () => {
    renderScene();

    const phone = screen.getByTestId('vr-host');
    const blocks = Array.from(phone.children);
    const chat = within(phone).getByTestId('chat-feed');
    const bar = blocks[blocks.length - 1];

    expect(bar.className).toContain('vr-action-bar');
    expect(chat.contains(bar)).toBe(false);
  });

  it('麦位网格按配置的麦位数渲染', () => {
    renderScene();

    const grid = within(screen.getByTestId('vr-host')).getByTestId('seat-1').parentElement!;
    expect(grid.children).toHaveLength(SEAT_COUNT);
  });
});

describe('生命周期', () => {
  it('挂载即连接 —— 零表单，点 tab 直接进房', () => {
    const { fakes } = renderScene();

    // 客户端已被创建（handlers 已交出），说明 start() 跑了。
    expect(() => fakes.host()).not.toThrow();
  });

  it('卸载时两端都断开', async () => {
    const fakes = createVoiceRoomFakes();
    const hostDisconnect = vi.fn(async () => undefined);
    const audienceDisconnect = vi.fn(async () => undefined);
    const createClients: typeof fakes.overrides.createClients = (config) => {
      const clients = fakes.overrides.createClients(config);
      return {
        host: { ...clients.host, disconnect: hostDisconnect },
        audience: { ...clients.audience, disconnect: audienceDisconnect },
      };
    };

    const { unmount } = render(
      <VoiceRoomScene
        env={ENV}
        search={SEARCH}
        overrides={{ createClients, createRtc: fakes.overrides.createRtc }}
      />,
    );
    unmount();
    await Promise.resolve();

    expect(hostDisconnect).toHaveBeenCalled();
    expect(audienceDisconnect).toHaveBeenCalled();
  });

  it('StrictMode 下重复挂载卸载不泄漏连接：断开次数不少于连接次数', async () => {
    const fakes = createVoiceRoomFakes();
    let connects = 0;
    let disconnects = 0;
    const createClients: typeof fakes.overrides.createClients = (config) => {
      const clients = fakes.overrides.createClients(config);
      const counted = {
        connect: async () => void connects++,
        disconnect: async () => void disconnects++,
      };
      return {
        host: { ...clients.host, ...counted },
        audience: { ...clients.audience, ...counted },
      };
    };

    const { unmount } = render(
      <StrictMode>
        <VoiceRoomScene
          env={ENV}
          search={SEARCH}
          overrides={{ createClients, createRtc: fakes.overrides.createRtc }}
        />
      </StrictMode>,
    );
    // 让 StrictMode 的「挂载 → 卸载 → 再挂载」全部走完
    await Promise.resolve();
    await Promise.resolve();
    unmount();
    await Promise.resolve();
    await Promise.resolve();

    // 具体次数取决于 React 的调度，不硬编码；关键是没有「连上了却没断开」的残留。
    expect(connects).toBeGreaterThan(0);
    expect(disconnects).toBeGreaterThanOrEqual(connects);
  });

  it('StrictMode 下渲染出的手机不重复 —— 每台只有一个', () => {
    renderScene({ strict: true });

    expect(screen.getAllByTestId('vr-host')).toHaveLength(1);
    expect(screen.getAllByTestId('vr-audience')).toHaveLength(1);
  });
});

describe('时间线来源', () => {
  it('把两端客户端作为 trace 来源交给外壳', () => {
    const fakes = createVoiceRoomFakes();
    const onTraceSources = vi.fn();

    render(
      <VoiceRoomScene
        env={ENV}
        search={SEARCH}
        overrides={fakes.overrides}
        onTraceSources={onTraceSources}
      />,
    );

    expect(onTraceSources.mock.calls[0][0]).toHaveLength(2);
  });

  it('卸载时交回空来源，避免外壳继续订阅已断开的客户端', () => {
    const fakes = createVoiceRoomFakes();
    const onTraceSources = vi.fn();

    const { unmount } = render(
      <VoiceRoomScene
        env={ENV}
        search={SEARCH}
        overrides={fakes.overrides}
        onTraceSources={onTraceSources}
      />,
    );
    unmount();

    expect(onTraceSources.mock.calls.at(-1)?.[0]).toEqual([]);
  });
});

describe('失败路径的可见反馈', () => {
  it('客户端报错后在对应那台手机上显示错误', async () => {
    const { fakes } = renderScene();

    fakes.audience().error('上麦失败：设备被占用');
    await screen.findByTestId('error-audience');

    expect(screen.getByTestId('error-audience').textContent).toContain('设备被占用');
    // 只影响报错那一端
    expect(screen.queryByTestId('error-host')).not.toBeInTheDocument();
  });

  it('被踢出后显示退出原因', async () => {
    const { fakes } = renderScene();

    fakes.audience().exit('kicked');
    await screen.findByTestId('exit-audience');

    expect(screen.getByTestId('exit-audience').textContent).toContain('踢出');
  });
});
