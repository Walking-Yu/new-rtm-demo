/**
 * 实验室端到端测试。
 *
 * ## 用占位 App ID，刻意不验证真实连通性
 *
 * 这里注入假 App ID，`e2e` mode 使用无网络的页面会话/RTC adapter。e2e 要验证的是外壳、
 * 路由、渲染与交互，而不是 Agora 后端可用性。把真实凭证塞进 e2e 会让测试在
 * 没网、凭证过期、配额用尽时无故变红，而这些都不是代码问题。
 *
 * 完整真实链路仍需有效凭证**人工验收**（见票 25）。
 *
 * ## 因此「控制台无报错」需要一份白名单
 *
 * 假 App ID 必然引发登录失败的报错 —— 那是预期行为，不是缺陷。所以断言的是
 * **没有未预期的报错**：先滤掉可归因于「故意用了假凭证」的那一类，剩下的必须为空。
 * 白名单只列失败原因的特征串，不做宽泛匹配，否则真实的渲染错误会被一起吞掉。
 */

import { expect, test, type Page } from '@playwright/test';

/** 占位 App ID。32 位十六进制，形状合法但不对应任何真实项目。 */
const PLACEHOLDER_APP_ID = '00000000000000000000000000000000';

/**
 * 可归因于「故意用了假 App ID」的报错特征。
 *
 * 只匹配连接与鉴权失败这一类。**不要往这里加通用词**（如 `error`、`failed`）——
 * 那会把真实的渲染错误也滤掉，这条断言就形同虚设。
 */
const EXPECTED_NOISE = [
  // RTM 登录失败。-10003 是 INVALID_APP_ID，占位 App ID 必然走到这里。
  // 匹配具体错误码而不是 `RTM:ERROR` 前缀 —— 后者会把 RTM 的所有报错一并滤掉。
  'Error Code -10003',
  'LOGIN_ERROR',
  'INVALID_APP_ID',
  'invalid vendor key',
  'CAN_NOT_GET_GATEWAY_SERVER',
  'dynamic key expired',
  'AgoraRTMError',
  'AgoraRTCError',
  'Agora-SDK',
  // 连不上网关时的传输层噪声
  'WebSocket',
  'net::ERR_',
  'Failed to fetch',
  'ERR_CERT',
  // 假凭证下网关返回的 4xx/5xx
  'agora.io',
  'sd-rtn.com',
  // jsdom/浏览器对麦克风设备的限制（CI 无音频设备）
  'enumerateDevices',
  'NOT_SUPPORTED',
  'Permission denied',
  'NotFoundError',
  'NotAllowedError',
];

function isExpectedNoise(message: string): boolean {
  return EXPECTED_NOISE.some((pattern) => message.includes(pattern));
}

/** 开始收集控制台报错与页面异常，返回「取出未预期部分」的函数。 */
function collectErrors(page: Page): () => string[] {
  const messages: string[] = [];

  page.on('pageerror', (error) => messages.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const location = message.location();
    messages.push(`console: ${message.text()} (${location.url}:${location.lineNumber})`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) messages.push(`http ${response.status()} ${response.url()}`);
  });

  return () => messages.filter((message) => !isExpectedNoise(message));
}

/** 注入占位 App ID。必须在 bundle 加载**之前**跑 —— env 快照只在启动时读一次。 */
async function withAppId(page: Page): Promise<void> {
  await page.addInitScript((appId) => {
    (window as unknown as { __ENV__: { appId: string } }).__ENV__ = { appId };
  }, PLACEHOLDER_APP_ID);
}

/** 单端入口不自动连接，导航前只需确认角色选择页已稳定渲染。 */
async function waitForPlaceholderLoginToSettle(page: Page): Promise<void> {
  await expect(page.getByTestId('voice-room-entry')).toBeVisible();
}

function audienceInviteData(roomId = 'voice-room-invite'): string {
  return Buffer.from(JSON.stringify({
    localStorage: {
      'record-channel-list-20260818': {
        roomId,
        roomName: '邀请房间',
        createdAt: Date.parse('2026-08-18T01:00:00.000Z'),
        updatedAt: Date.parse('2026-08-18T01:00:00.000Z'),
        hostUserId: 'host-e2e',
        banUserIds: [],
      },
    },
    role: 'audience',
    pageUid: null,
    nickname: null,
  })).toString('base64url');
}

test.describe('外壳与导航', () => {
  test.beforeEach(async ({ page }) => {
    await withAppId(page);
  });

  test('首页渲染，8 个一级 tab 可见', async ({ page }) => {
    const unexpected = collectErrors(page);
    await page.goto('/');

    const primaryNav = page.getByRole('navigation', { name: '一级场景分类' });
    await expect(primaryNav).toBeVisible();
    await expect(primaryNav.getByRole('link')).toHaveCount(8);

    expect(unexpected()).toEqual([]);
  });

  test('根路径重定向到语聊房 —— 唯一已实现的场景', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/social\/voice-room$/);
  });

  test('切一级 tab 后二级 tab 跟着换', async ({ page }) => {
    const unexpected = collectErrors(page);
    await page.goto('/');

    const secondaryNav = page.getByRole('navigation', { name: '二级场景' });
    // 默认落在社交分类，它有 6 个场景
    await expect(secondaryNav.getByRole('link')).toHaveCount(6);

    await waitForPlaceholderLoginToSettle(page);
    await page.getByRole('link', { name: '游戏' }).click();

    // 游戏分类只有 1 个场景
    await expect(secondaryNav.getByRole('link')).toHaveCount(1);
    await expect(secondaryNav.getByRole('link', { name: /游戏语音房/ })).toBeVisible();

    expect(unexpected()).toEqual([]);
  });

  test('点计划中场景进占位页', async ({ page }) => {
    const unexpected = collectErrors(page);
    await page.goto('/');

    await waitForPlaceholderLoginToSettle(page);
    await page.getByRole('link', { name: /连麦、PK/ }).click();

    const placeholder = page.getByTestId('scene-placeholder');
    await expect(placeholder).toBeVisible();
    // 占位页写明该场景计划演示哪些 RTM 能力，并指回语聊房
    await expect(placeholder.getByRole('link', { name: /语聊房/ })).toBeVisible();

    expect(unexpected()).toEqual([]);
  });

  test('切换场景时两级 tab 与时间线面板不重建', async ({ page }) => {
    await page.goto('/');

    const timeline = page.getByRole('complementary', { name: '时间线' });
    await expect(timeline).toBeVisible();

    await waitForPlaceholderLoginToSettle(page);
    await page.getByRole('link', { name: /连麦、PK/ }).click();
    await expect(page.getByTestId('scene-placeholder')).toBeVisible();

    // 两级 tab 与时间线仍在原位（layout route 之外的部分不随场景切换卸载）
    await expect(page.getByRole('navigation', { name: '一级场景分类' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: '二级场景' })).toBeVisible();
    await expect(timeline).toBeVisible();
  });
});

test.describe('语聊房场景', () => {
  test.beforeEach(async ({ page }) => {
    await withAppId(page);
  });

  test('首次打开只显示 Host/Audience 选择，不创建隐藏双端', async ({ page }) => {
    const unexpected = collectErrors(page);
    await page.goto('/social/voice-room');

    await expect(page.getByTestId('voice-room-entry')).toBeVisible();
    await expect(page.getByLabel('房间标题')).toBeVisible();
    await expect(page.getByLabel('邀请链接')).toBeVisible();
    await expect(page.getByLabel('房主语聊房')).toHaveCount(0);
    await expect(page.getByLabel('听众语聊房')).toHaveCount(0);

    expect(unexpected()).toEqual([]);
  });

  test('Host/Audience 入口与房间列表在定高卡片内可滚动到达', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 577 });
    await page.goto('/social/voice-room');
    await expect(page.getByTestId('voice-room-entry')).toBeVisible();

    const entry = page.getByTestId('voice-room-entry');
    const timeline = page.getByRole('complementary', { name: '时间线' });
    const audiencePanel = page.locator('.vr-entry__choice-panel').nth(1);
    await expect(audiencePanel).toBeAttached();
    const dimensions = await entry.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));

    expect(dimensions.clientHeight).toBeLessThanOrEqual(520);
    expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
    const entryBox = await entry.boundingBox();
    const timelineBox = await timeline.boundingBox();
    expect(Math.abs((entryBox!.y + entryBox!.height) - (timelineBox!.y + timelineBox!.height))).toBeLessThanOrEqual(1);
    await audiencePanel.scrollIntoViewIfNeeded();
    await expect(page.getByLabel('邀请链接')).toBeVisible();
    await page.getByText('本机最近房间').scrollIntoViewIfNeeded();
    await expect(page.getByText('本机最近房间')).toBeVisible();
  });

  test('Host 创建时先挂载房间壳与 loading 蒙层，订阅后移除蒙层', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/social/voice-room');

    await page.getByLabel('房间标题').fill('E2E 房间');
    await page.getByRole('button', { name: '创建并进入' }).click();
    await expect(page.getByLabel('房主语聊房')).toBeVisible();
    await expect(page.getByTestId('voice-room-loading-overlay')).toContainText('正在加载房间…');
    await expect(page.getByTestId('voice-room-loading-overlay')).toHaveCount(0);
    await expect(page.getByLabel('房主语聊房').getByText('房主视角', { exact: true })).toBeVisible();
    await expect(page.getByLabel('房主语聊房').locator('.vr-single__header')).not.toContainText(/host-/);
    await expect(page.getByTestId('voice-room-entry')).toHaveCount(0);

    const controlBounds = await page.locator('.vr-single__panel .vr-single__control-group').evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { left: Math.round(rect.left), right: Math.round(rect.right) };
      }),
    );
    expect(new Set(controlBounds.map(({ left }) => left)).size).toBe(1);
    expect(new Set(controlBounds.map(({ right }) => right)).size).toBe(1);

    const room = page.getByLabel('房主语聊房');
    await room.getByRole('button', { name: '复制观众邀请链接' }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toMatch(/^http:\/\/127\.0\.0\.1:4173\/social\/voice-room\?data=[A-Za-z0-9_-]+$/);
    const toast = room.getByText('已复制完整邀请链接');
    await expect(toast).toBeVisible();
    await expect(toast).toHaveCount(0, { timeout: 4_000 });
  });

  test('移动端首次加载停留在页面顶部，不被公屏自动滚动带走', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto('/social/voice-room');
    await expect(page.getByTestId('voice-room-entry')).toBeVisible();

    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('choose 页直接提供 Audience 邀请 URL 输入和本地目录空态', async ({ page }) => {
    await page.goto('/social/voice-room');
    await expect(page.getByLabel('邀请链接')).toBeVisible();
    await expect(page.getByText('暂无可加入的本地房间。')).toBeVisible();
  });

  test('Audience 粘贴 data 邀请内容后进入单端房间', async ({ page }) => {
    await page.goto('/social/voice-room');
    await page.getByLabel('邀请链接').fill(`data=${audienceInviteData('voice-room-test')}`);
    await page.getByRole('button', { name: '加入房间' }).click();

    await expect(page.getByLabel('听众语聊房')).toBeVisible();
    await expect(page.getByLabel('听众语聊房').getByText('听众视角', { exact: true })).toBeVisible();
    await expect(page.getByLabel('听众语聊房').locator('.vr-single__header')).not.toContainText(/audience-/);
  });

  test('Audience 直达邀请 URL 不闪现 choose，成功后 URL 仍只有 data', async ({ page }) => {
    await page.goto(`/social/voice-room?data=${audienceInviteData()}`);
    await expect(page.getByLabel('听众语聊房')).toBeVisible();
    await expect(page.getByLabel('听众语聊房').getByLabel('我的上麦')).toHaveCount(0);
    const composer = page.getByLabel('听众语聊房').getByLabel('聊天内容').locator('..');
    await expect(composer.locator('button').last()).toHaveText('申请上麦');
    await expect(page.getByText('房间连接状态：connected')).toBeVisible();
    await page.getByRole('button', { name: '显示连接' }).click();
    await expect(page.getByRole('complementary', { name: '时间线' }).getByText('linkState')).toHaveCount(0);
    await page.waitForFunction(() => {
      const encoded = new URL(location.href).searchParams.get('data');
      if (!encoded) return false;
      const padded = encoded.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(encoded.length / 4) * 4, '=');
      const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)))) as {
        nickname?: string | null;
      };
      return typeof payload.nickname === 'string';
    });
    const identityBeforeRefresh = await page.evaluate(() => {
      const encoded = new URL(location.href).searchParams.get('data')!;
      const padded = encoded.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(encoded.length / 4) * 4, '=');
      return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)))) as {
        pageUid: string;
        nickname: string;
      };
    });
    expect(identityBeforeRefresh.nickname).toMatch(/^[A-Z][a-z]+_\d{3}$/);
    await expect(page.getByLabel('听众语聊房').locator('.vr-single__nickname')).toHaveText(identityBeforeRefresh.nickname);
    expect(await page.evaluate(() => [...new URL(location.href).searchParams.keys()])).toEqual(['data']);
    expect(await page.evaluate(() => document.querySelector('[data-testid="voice-room-entry"]') === null)).toBe(true);

    await page.reload();
    await expect(page.getByLabel('听众语聊房')).toBeVisible();
    await expect(page.getByLabel('听众语聊房').locator('.vr-single__nickname')).toHaveText(identityBeforeRefresh.nickname);
    await expect(page.getByTestId('voice-room-entry')).toHaveCount(0);
    expect(await page.evaluate(() => [...new URL(location.href).searchParams.keys()])).toEqual(['data']);
    const identityAfterRefresh = await page.evaluate(() => {
      const encoded = new URL(location.href).searchParams.get('data')!;
      const padded = encoded.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(encoded.length / 4) * 4, '=');
      return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)))) as {
        pageUid: string;
        nickname: string;
      };
    });
    expect(identityAfterRefresh).toMatchObject(identityBeforeRefresh);
  });
});

test.describe('时间线面板', () => {
  test.beforeEach(async ({ page }) => {
    await withAppId(page);
  });

  test('可折叠、可展开', async ({ page }) => {
    const unexpected = collectErrors(page);
    await page.goto('/social/voice-room');

    const timeline = page.getByRole('complementary', { name: '时间线' });
    const body = page.locator('.lab-body');
    await expect(body).toHaveAttribute('data-timeline', 'expanded');

    await page.getByTestId('timeline-toggle').click();
    await expect(body).toHaveAttribute('data-timeline', 'collapsed');
    // 折叠态仍留一条竖条与条目计数，数据不清空
    await expect(timeline).toBeVisible();
    await expect(page.getByTestId('timeline-count')).toBeVisible();

    await page.getByTestId('timeline-toggle').click();
    await expect(body).toHaveAttribute('data-timeline', 'expanded');

    expect(unexpected()).toEqual([]);
  });

  test('窄屏时时间线转为主区下方的横排区块', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', '只在桌面项目里改视口验证断点');

    await page.goto('/social/voice-room');
    const timeline = page.getByRole('complementary', { name: '时间线' });
    const roomEntry = page.getByTestId('voice-room-entry');

    // 宽屏：时间线在主区右侧
    await page.setViewportSize({ width: 1440, height: 1000 });
    const wideTimeline = await timeline.boundingBox();
    const wideEntry = await roomEntry.boundingBox();
    expect(wideTimeline!.x).toBeGreaterThan(wideEntry!.x);

    // 960px 及以下：退化为单列，时间线落到主区下方
    await page.setViewportSize({ width: 900, height: 1000 });
    const narrowTimeline = await timeline.boundingBox();
    const narrowEntry = await roomEntry.boundingBox();
    expect(narrowTimeline!.y).toBeGreaterThan(narrowEntry!.y);
  });
});

test.describe('env 未配置', () => {
  /**
   * 显式注入空 appId，验证空白配置会被 `normalizeAppId` 收敛为未配置。
   */
  test('渲染引导页，不进场景', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __ENV__: { appId: string } }).__ENV__ = { appId: '' };
    });
    const unexpected = collectErrors(page);
    await page.goto('/social/voice-room');

    const guide = page.getByTestId('env-guide');
    await expect(guide).toBeVisible();
    await expect(page.getByTestId('voice-room-entry')).toHaveCount(0);

    // 未配置不是异常，引导页不该用报错口吻
    await expect(guide).toContainText('VITE_APP_ID');
    await expect(guide).toContainText('__ENV__');
    await expect(guide).not.toContainText(/错误|失败|异常/);

    expect(unexpected()).toEqual([]);
  });
});
