import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const resolveRootFile = (path: string) => resolve(root, path);
const readRootFile = (path: string) => readFileSync(resolveRootFile(path), 'utf8');

describe('Agent 开发约定', () => {
  it('keeps the Codex and Claude entry points identical', () => {
    const agentsPath = resolveRootFile('AGENTS.md');
    expect(existsSync(agentsPath), '根目录应提供 Codex 入口 AGENTS.md').toBe(true);

    if (!existsSync(agentsPath)) return;

    const agents = readRootFile('AGENTS.md');
    const claude = readRootFile('CLAUDE.md');

    expect(agents).toBe(claude);
    expect(agents).toContain('AGENTS.md` 与 `CLAUDE.md` 必须保持逐字一致');
    expect(agents).toContain(
      '未经用户明确要求，不得运行 `git add`、`git commit`、`git commit --amend`、`git push`',
    );
    expect(agents).not.toContain('seats-lock');
    expect(agents).not.toContain('业务事件 handler 返回摘要和可选异步 completion');
    expect(agents).toContain('`onRtmEvent.ts` 先记录事件 trace，再调用 `consume`');
  });
});
