import { spawnSync } from 'node:child_process';
import { accessSync, constants, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

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
    expect(result.stdout).toContain('demos/voice-room');
    // vendor 进仓库的是 2.3.0 正式版（原先是 Downloads 下的 2.3.0-beta.0）
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

  it('points default npm workflows at the root skeleton, not the voice-room package', () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    // 新骨架是主线：根 dev/build 直接跑根 src/，不再委托给 demos/voice-room
    expect(packageJson.scripts.dev).toBe('vite --port 8080');
    expect(packageJson.scripts.build).toBe('tsc -b && vite build');
    // 遗留实验室搬到 src/legacy/，通过独立入口 legacy.html 访问
    expect(packageJson.scripts['dev:legacy']).toBe('vite --port 8081 --open /legacy.html');
    // demos/voice-room 保留但不再是默认目标，只能显式调用
    expect(packageJson.scripts['dev:voice-room']).toBe('npm --prefix demos/voice-room run dev');
  });

  it('keeps the legacy entry inside the root build output', () => {
    // build 同时产出 index.html 与 legacy.html 两个入口，所以 build:legacy 与 build 同义
    const viteConfig = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8');
    expect(viteConfig).toContain('legacy.html');
    expect(viteConfig).toContain('index.html');

    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts['build:legacy']).toBe(packageJson.scripts.build);
  });

  it('runs legacy vitest suites from their new src/legacy location', () => {
    const viteConfig = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8');
    expect(viteConfig).toContain('./src/legacy/test/setup.ts');
  });

  it('keeps a standalone executable launcher inside the copyable demo', () => {
    const childScript = resolve(process.cwd(), 'demos/voice-room/start-demo.sh');
    expect(() => accessSync(childScript, constants.X_OK)).not.toThrow();
  });
});
