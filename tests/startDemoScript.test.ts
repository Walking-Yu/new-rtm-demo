import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 这份测试守的是「一键启动」与「默认命令指向新骨架」这两件事。
 *
 * 遗留的 24 场景实验室（原 `src/legacy/`、`legacy.html`、`e2e/scenarios.spec.ts`）
 * 与独立语聊房 SPA（原 `demos/voice-room/`）已整体搬去 `new-rtm-demo-legacy`
 * 仓库。原先断言它们存在的用例改为断言**它们不再被主仓库引用** —— 反向断言
 * 是必要的：只删掉旧断言的话，日后谁把 `--prefix demos/voice-room` 之类的
 * 转发加回来，测试不会拦。
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
    // 启动器现在直接跑根目录新骨架，不再转发给已搬走的独立 SPA
    expect(result.stdout).toContain('scenes/voice-room');
    // vendor 进仓库的是 2.3.0 正式版
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

  it('points default npm workflows at the root skeleton', () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts.dev).toBe('vite --port 8080');
    expect(packageJson.scripts.build).toBe('tsc -b && vite build');
    expect(packageJson.scripts.test).toBe('vitest run');
    expect(packageJson.scripts['test:e2e']).toBe('playwright test');
  });

  it('keeps no script delegating to the relocated legacy packages', () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const scriptNames = Object.keys(packageJson.scripts);
    expect(scriptNames).not.toContain('dev:legacy');
    expect(scriptNames).not.toContain('test:legacy');
    expect(scriptNames).not.toContain('build:legacy');
    expect(scriptNames).not.toContain('dev:voice-room');
    expect(scriptNames).not.toContain('test:e2e:legacy');

    // 没有任何脚本还在委托给搬走的目录
    for (const command of Object.values(packageJson.scripts)) {
      expect(command).not.toContain('demos/voice-room');
      expect(command).not.toContain('legacy.html');
    }
  });

  it('builds a single entry now that the legacy entry is gone', () => {
    // 入口文件本身消失，这是「不再产出第二入口」的硬事实
    expect(existsSync(resolve(process.cwd(), 'legacy.html'))).toBe(false);

    /*
     * 断言不再配置多入口。
     *
     * 这里刻意**不**做 `not.toContain('legacy.html')` 的整份文件子串匹配 ——
     * 配置里的注释也会命中，说明搬迁原因的注释反而会让断言变红。改为断言
     * 「没有 rollupOptions.input 这种多入口配置」，匹配的是行为而不是字符。
     */
    const viteConfig = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8');
    const withoutComments = viteConfig
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(withoutComments).not.toContain('legacy.html');
    expect(withoutComments).not.toContain('rollupOptions');
  });

  it('runs vitest setup from a location the skeleton owns', () => {
    // setup 原先住在 src/legacy/test/ 下，却服务整个根 vitest —— 搬迁前已提出来
    const viteConfig = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8');
    expect(viteConfig).toContain('./src/test/setup.ts');
    expect(existsSync(resolve(process.cwd(), 'src/test/setup.ts'))).toBe(true);
    expect(existsSync(resolve(process.cwd(), 'src/legacy'))).toBe(false);
  });
});
