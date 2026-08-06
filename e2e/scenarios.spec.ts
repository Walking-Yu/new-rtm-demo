import { expect, test } from '@playwright/test';

const scenarioIds = [
  'social-presence',
  'social-chat',
  'voice-room-interaction',
  'voice-room-seats',
  'live-social-pk',
  'one-to-one-call',
  'room-moderation',
  'classroom-messaging',
  'classroom-stage',
  'classroom-quiz',
  'education-device',
  'enterprise-collaboration',
  'field-operations',
  'video-meeting',
  'device-telemetry',
  'device-control',
  'security-alerts',
  'live-chat-gifts',
  'live-operations',
  'live-guests',
  'telemedicine-call',
  'dispatch-order',
  'driver-rider-messaging',
  'gaming-voice-social',
] as const;

for (const scenarioId of scenarioIds) {
  test(`${scenarioId} opens and executes its primary action`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => {
      if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`);
    });
    page.on('console', (message) => {
      if (message.type() === 'error') {
        const location = message.location();
        errors.push(`${message.text()} (${location.url}:${location.lineNumber}:${location.columnNumber})`);
      }
    });

    await page.goto(`/scenarios/${scenarioId}`);
    await expect(page.locator('h1')).toBeVisible();
    await page.locator('.action-button').first().click();
    await expect(page.locator('[aria-label="事件时间线"] li')).toHaveCount(1);
    expect(errors).toEqual([]);
  });
}

test('desktop workbench shows navigation, canvas, and control rail', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/scenarios/voice-room-seats');

  await expect(page.getByRole('complementary', { name: '场景导航' })).toBeVisible();
  await expect(page.getByLabel('场景画布')).toBeVisible();
  await expect(page.getByLabel('场景控制台')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('voice-room-desktop.png'), fullPage: true });

  await page.goto('/scenarios/device-control');
  await expect(page.getByLabel('设备状态')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('device-control-desktop.png'), fullPage: true });
});

test('mobile navigation opens a scenario without obscuring the workbench', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/scenarios/voice-room-seats');

  await page.getByRole('button', { name: '打开场景导航' }).click();
  await page.getByRole('link', { name: /远程指令、任务与配置下发/ }).click();
  await expect(page.getByRole('heading', { name: '远程指令、任务与配置下发' })).toBeVisible();
  await expect(page.getByLabel('设备状态')).toBeVisible();

  await page.goto('/scenarios/voice-room-seats');
  await page.screenshot({ path: testInfo.outputPath('voice-room-mobile.png'), fullPage: true });
});
