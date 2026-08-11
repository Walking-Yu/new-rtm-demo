import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 这份测试守的是仓库的「启动契约」：一条命令能起来，默认命令指向根目录的实验室，
 * 构建只产出单入口，vitest 的 setup 住在 `src/test/` 下。
 *
 * 断言全部写成正向形式（「应该是什么」），不写「不应该是什么」—— 后者需要预设
 * 一份历史清单，读的人无从判断清单为何如此。
 */
describe('start-demo.sh', () => {
  it('provides an executable environment check for one-command startup', () => {
    const script = resolve(process.cwd(), 'start-demo.sh');
    expect(() => accessSync(script, constants.X_OK)).not.toThrow();

    const result = spawnSync(script, ['--check'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Demo environment is ready');
    expect(result.stdout).toContain('scenes/voice-room');
    // vendor 里携带的是 2.3.0 正式版
    expect(result.stdout).toContain('agora-rtm@2.3.0');
    expect(result.stdout).toContain('agora-rtc-sdk-ng@4.24.6');
  });

  it('documents port 8080 as the default public URL', () => {
    const script = resolve(process.cwd(), 'start-demo.sh');
    const result = spawnSync(script, ['--help'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Default URL: http://127.0.0.1:8080/');
  });

  it('keeps the four default npm workflows pointed at this package', () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    // 四条默认命令都在本包内执行，不跨包委托（`--prefix` 会破坏这一点）
    expect(packageJson.scripts.dev).toBe('vite --port 8080');
    expect(packageJson.scripts.build).toBe('tsc -b && vite build');
    expect(packageJson.scripts.test).toBe('vitest run');
    expect(packageJson.scripts['test:e2e']).toBe('playwright test');

    for (const command of Object.values(packageJson.scripts)) {
      expect(command).not.toContain('--prefix');
    }
  });

  it('builds exactly one entry from the repo root', () => {
    // 只有一个入口页
    expect(existsSync(resolve(process.cwd(), 'index.html'))).toBe(true);

    /*
     * 断言不配置多入口。匹配的是 `rollupOptions`（多入口必经的配置项）而不是
     * 某个具体文件名 —— 前者是行为，后者只是字符。注释先剥掉，避免说明性文字
     * 意外命中。
     */
    const viteConfig = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8');
    const withoutComments = viteConfig
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(withoutComments).not.toContain('rollupOptions');
  });

  it('runs vitest setup from src/test', () => {
    const viteConfig = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8');
    expect(viteConfig).toContain('./src/test/setup.ts');
    expect(existsSync(resolve(process.cwd(), 'src/test/setup.ts'))).toBe(true);
  });

  it('keeps archived applications outside this single-application repository', () => {
    for (const archivedPath of [
      'demos/voice-room',
      'src/legacy',
      'legacy.html',
      'e2e/scenarios.spec.ts',
    ]) {
      expect(existsSync(resolve(process.cwd(), archivedPath)), archivedPath).toBe(false);
    }

    const domainGuide = readFileSync(resolve(process.cwd(), 'docs/agents/domain.md'), 'utf8');
    expect(domainGuide).toContain('本仓库只有一个应用');
    expect(domainGuide).not.toContain('demos/voice-room/');
    expect(domainGuide).not.toContain('src/legacy/');
  });

  it('isolates e2e from the developer local env without changing normal dev mode', () => {
    const viteConfig = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8');
    const playwrightConfig = readFileSync(resolve(process.cwd(), 'playwright.config.ts'), 'utf8');

    expect(viteConfig).toContain("mode === 'e2e' ? false : undefined");
    expect(playwrightConfig).toContain('--mode e2e');
    expect(playwrightConfig).toContain('reuseExistingServer: false');
  });
});
