/**
 * 新骨架端到端测试。本仓库现在只有这一套 e2e —— 遗留实验室的
 * `scenarios.spec.ts` 已随遗留代码搬去 `new-rtm-demo-legacy`。
 *
 * ## 用占位 App ID，刻意不验证真实连通性
 *
 * 这里注入的是假 App ID，RTM 一定登录失败。**这是有意的**：e2e 要验证的是外壳、
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
  // RTM 登录失败。-10023 是「appId 无效 / 鉴权不通过」，占位 App ID 必然走到这里。
  // 匹配具体错误码而不是 `RTM:ERROR` 前缀 —— 后者会把 RTM 的所有报错一并滤掉。
  'Error Code -10023',
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

    await page.getByRole('link', { name: '游戏' }).click();

    // 游戏分类只有 1 个场景
    await expect(secondaryNav.getByRole('link')).toHaveCount(1);
    await expect(secondaryNav.getByRole('link', { name: /游戏语音房/ })).toBeVisible();

    expect(unexpected()).toEqual([]);
  });

  test('点计划中场景进占位页', async ({ page }) => {
    const unexpected = collectErrors(page);
    await page.goto('/');

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

  test('点语聊房后两台手机可见', async ({ page }) => {
    const unexpected = collectErrors(page);
    await page.goto('/social/voice-room');

    // 房主视角与听众视角各一台
    await expect(page.getByTestId('vr-host')).toBeVisible();
    await expect(page.getByTestId('vr-audience')).toBeVisible();

    expect(unexpected()).toEqual([]);
  });

  test('每台手机上方有身份条，两端 uid badge 不同色', async ({ page }) => {
    await page.goto('/social/voice-room');

    const hostBadge = page.getByTestId('identity-badge-host');
    const audienceBadge = page.getByTestId('identity-badge-audience');
    await expect(hostBadge).toBeVisible();
    await expect(audienceBadge).toBeVisible();

    // badge 颜色按角色固定（roleColors.ts 是唯一来源），两端必须不同 ——
    // 读者靠颜色而不是文字判断条目来自哪一端。
    const colorOf = (locator: typeof hostBadge) =>
      locator.evaluate((node) => getComputedStyle(node).color);
    expect(await colorOf(hostBadge)).not.toBe(await colorOf(audienceBadge));
  });

  test('两条常驻告警都在页面上，生产边界告警不含「已强制执行」', async ({ page }) => {
    await page.goto('/social/voice-room');

    await expect(page.getByText('请佩戴耳机')).toBeVisible();

    const boundary = page.getByTestId('boundary-warning');
    await expect(boundary).toBeVisible();
    await expect(boundary).toContainText('不构成信任边界');
    // 治理动作是客户端协作行为，不能被说成已强制执行的权限控制
    await expect(boundary).not.toContainText('已强制执行');
  });

  test('手机内不裁切：底部操作条在手机框内可见', async ({ page }) => {
    await page.goto('/social/voice-room');

    const phone = page.getByTestId('vr-host');
    const phoneBox = await phone.boundingBox();
    const actionBox = await phone.locator('.vr-action-bar').boundingBox();

    expect(phoneBox).not.toBeNull();
    expect(actionBox).not.toBeNull();
    // 底部操作条常驻手机框内，不被裁掉、不随公屏滚走
    expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(phoneBox!.y + phoneBox!.height + 1);
  });

  test('手机内只有公屏可滚动', async ({ page }) => {
    await page.goto('/social/voice-room');

    // 真浏览器里量实际滚动能力：手机外框本身不滚，公屏那一块才滚。
    const phoneScrolls = await page
      .getByTestId('vr-host')
      .evaluate((node) => node.scrollHeight > node.clientHeight + 1);
    expect(phoneScrolls).toBe(false);

    const chatOverflow = await page
      .getByTestId('vr-host')
      .locator('[data-testid="chat-feed"]')
      .evaluate((node) => getComputedStyle(node).overflowY);
    expect(chatOverflow).toBe('auto');
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
    const phones = page.locator('.vr-phones');

    // 宽屏：时间线在主区右侧
    await page.setViewportSize({ width: 1440, height: 1000 });
    const wideTimeline = await timeline.boundingBox();
    const widePhones = await phones.boundingBox();
    expect(wideTimeline!.x).toBeGreaterThan(widePhones!.x);

    // 1240px 及以下：退化为单列，时间线落到主区下方
    await page.setViewportSize({ width: 1000, height: 1000 });
    const narrowTimeline = await timeline.boundingBox();
    const narrowPhones = await phones.boundingBox();
    expect(narrowTimeline!.y).toBeGreaterThan(narrowPhones!.y);
  });
});

test.describe('env 未配置', () => {
  /**
   * 显式注入空 appId 来构造「未配置」。
   *
   * 不能靠「什么都不注入」—— `index.html` 里有一段开发用的默认注入（`??=`），
   * 不注入时拿到的是那个体验 App ID，就成了已配置。空串会被 `normalizeAppId`
   * 收敛成 `undefined`，等价于未配置；同时它不是 nullish，所以 `??=` 不会覆盖它。
   */
  test('渲染引导页，不进场景', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __ENV__: { appId: string } }).__ENV__ = { appId: '' };
    });
    const unexpected = collectErrors(page);
    await page.goto('/social/voice-room');

    const guide = page.getByTestId('env-guide');
    await expect(guide).toBeVisible();
    await expect(page.getByTestId('vr-host')).toHaveCount(0);

    // 未配置不是异常，引导页不该用报错口吻
    await expect(guide).toContainText('VITE_APP_ID');
    await expect(guide).toContainText('__ENV__');
    await expect(guide).not.toContainText(/错误|失败|异常/);

    expect(unexpected()).toEqual([]);
  });
});
