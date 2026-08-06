import { expect, test, type Page } from '@playwright/test';

function monitorErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function fillSettings(page: Page) {
  await page.getByLabel('App ID').fill('test-app-id');
}

test('setup validates required fields and shows the headphones warning', async ({ page }, testInfo) => {
  const errors = monitorErrors(page);
  await page.setViewportSize(testInfo.project.name === 'desktop-chromium'
    ? { width: 1440, height: 1000 }
    : { width: 390, height: 844 });
  await page.goto('/');

  await expect(page.getByRole('heading', { name: '语聊房 RTM + RTC 实践' })).toBeVisible();
  await expect(page.getByText('请佩戴耳机')).toBeVisible();
  await expect(page.getByLabel(/Token/)).toHaveCount(4);
  await expect(page.getByText('App Certificate')).toHaveCount(0);
  await page.getByRole('button', { name: '保存并进入语聊房' }).click();
  await expect(page.getByRole('alert')).toContainText('请填写 App ID');

  await page.screenshot({ path: testInfo.outputPath('setup.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('setup rejects duplicate endpoint User IDs', async ({ page }) => {
  const errors = monitorErrors(page);
  await page.goto('/');
  await fillSettings(page);
  await page.getByLabel('听众 User ID').fill('host-001');
  await page.getByRole('button', { name: '保存并进入语聊房' }).click();

  await expect(page.getByRole('alert')).toContainText('房主和听众必须使用不同的 User ID');
  expect(errors).toEqual([]);
});

test('settings stay in sessionStorage and room entry starts automatic connection', async ({ page }, testInfo) => {
  const errors = monitorErrors(page);
  await page.setViewportSize(testInfo.project.name === 'desktop-chromium'
    ? { width: 1440, height: 1000 }
    : { width: 390, height: 844 });
  await page.goto('/');
  await fillSettings(page);
  await page.getByRole('button', { name: '保存并进入语聊房' }).click();

  await expect(page).toHaveURL(/\/room\/voice-room-001$/);
  await expect(page.locator('section[aria-label="房主端"]')).toBeAttached();
  await expect(page.locator('section[aria-label="听众端"]')).toBeAttached();
  await expect(page.getByTestId(/^seat-/)).toHaveCount(8);
  await expect(page.getByRole('button', { name: '连接两个客户端' })).toHaveCount(0);
  await expect(page.locator('.connection-summary, button:has-text("重新连接")')).toHaveCount(1);
  await page.waitForTimeout(1000);
  await expect(page.getByText(/does not provide an export named 'default'/)).toHaveCount(0);
  await expect(page.getByText('场景实验室')).toHaveCount(0);
  await expect(page.getByText('e2e-host-rtm-token')).toHaveCount(0);

  const storage = await page.evaluate(() => {
    const serialized = sessionStorage.getItem('agora.voice-room.connection.v1');
    return {
      sessionKeys: Object.keys(sessionStorage),
      localEntries: Object.entries(localStorage),
      settings: serialized ? JSON.parse(serialized) : null,
    };
  });
  expect(storage.sessionKeys).toEqual(['agora.voice-room.connection.v1']);
  const serializedLocalStorage = JSON.stringify(storage.localEntries);
  expect(serializedLocalStorage).not.toContain('test-app-id');
  expect(serializedLocalStorage).not.toContain('voice-room-001');
  expect(serializedLocalStorage).not.toContain('host-001');
  expect(serializedLocalStorage).not.toContain('audience-001');
  expect(serializedLocalStorage).not.toContain('agora.voice-room.connection.v1');
  expect(storage.settings.host).not.toHaveProperty('rtmToken');
  expect(storage.settings.host).not.toHaveProperty('rtcToken');
  expect(storage.settings.audience).not.toHaveProperty('rtmToken');
  expect(storage.settings.audience).not.toHaveProperty('rtcToken');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: testInfo.outputPath('room-shell.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('unknown routes return to setup with a clear error', async ({ page }) => {
  const errors = monitorErrors(page);
  await page.goto('/scenarios/voice-room-seats');

  await expect(page).toHaveURL(/\?reason=unknown-route$/);
  await expect(page.getByRole('alert')).toContainText('页面不存在，已返回连接设置');
  expect(errors).toEqual([]);
});

test('desktop keeps host and audience side by side', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'desktop layout assertion');
  await page.goto('/');
  await fillSettings(page);
  await page.getByRole('button', { name: '保存并进入语聊房' }).click();

  const host = await page.getByRole('region', { name: '房主端' }).boundingBox();
  const audience = await page.getByRole('region', { name: '听众端' }).boundingBox();
  expect(host).not.toBeNull();
  expect(audience).not.toBeNull();
  expect(audience!.x).toBeGreaterThan(host!.x + host!.width - 2);
  await expect(page.getByRole('tablist', { name: '客户端视图' })).toBeHidden();
});

test('mobile tabs switch the visible endpoint without removing either panel', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium', 'mobile layout assertion');
  await page.goto('/');
  await fillSettings(page);
  await page.getByRole('button', { name: '保存并进入语聊房' }).click();

  const host = page.locator('section[aria-label="房主端"]');
  const audience = page.locator('section[aria-label="听众端"]');
  await expect(host).toBeVisible();
  await expect(audience).toBeHidden();
  await page.getByRole('tab', { name: '听众端' }).click();
  await expect(host).toBeHidden();
  await expect(audience).toBeVisible();
  await expect(page.locator('.endpoint-panel')).toHaveCount(2);
});
