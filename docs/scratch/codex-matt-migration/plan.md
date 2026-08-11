# Codex / Claude + Matt 双兼容迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Codex 与 Claude Code 从两个平台原生入口读取完全相同的项目规则，并继续共享现有 Matt 工作流配置。

**Architecture:** `AGENTS.md` 与 `CLAUDE.md` 是内容完全一致的双入口，`docs/agents/` 继续承载平台中立的 Matt 配置。仓库级 Vitest 测试锁定双入口一致性和 Matt 配置完整性，README 说明使用边界。

**Tech Stack:** Markdown、Node.js `fs`、Vitest 4。

**项目覆盖规则：** 本计划不执行 `git add`、`git commit`、`git push` 或同类命令。虽然实施技能通常建议频繁提交，但用户没有授权，本仓库的 git 安全规则优先。

---

## 文件结构

- 创建 `AGENTS.md`：Codex 的仓库级指令入口，与 `CLAUDE.md` 完全一致。
- 修改 `CLAUDE.md`：将开头改为平台中立表述，并加入双入口同步规则。
- 创建 `tests/agentInstructions.test.ts`：验证入口一致性与 Matt 配置完整性。
- 修改 `README.md`：记录 Codex / Claude + Matt 的使用方式和安全边界。
- 保留 `docs/agents/*.md`：只验证，不修改。

### Task 1：用测试定义双入口契约

**Files:**

- Create: `tests/agentInstructions.test.ts`
- Read: `CLAUDE.md`
- Expected missing file: `AGENTS.md`

- [x] **Step 1：创建失败测试**

```ts
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
  });

  it.each([
    'docs/agents/issue-tracker.md',
    'docs/agents/triage-labels.md',
    'docs/agents/domain.md',
  ])('keeps the Matt configuration at %s', (path) => {
    expect(existsSync(resolveRootFile(path))).toBe(true);
  });
});
```

- [x] **Step 2：运行测试并确认红灯**

Run: `npx vitest run tests/agentInstructions.test.ts`

Expected: FAIL，原因是根目录还没有 `AGENTS.md`。

### Task 2：建立完全一致的 Codex 与 Claude 入口

**Files:**

- Create: `AGENTS.md`
- Modify: `CLAUDE.md:1-4`
- Test: `tests/agentInstructions.test.ts`

- [x] **Step 1：把 `CLAUDE.md` 的开头改为平台中立规则**

用 `apply_patch` 将文件开头替换为：

```markdown
# Agent 项目约定

本文件为 Codex 与 Claude Code 提供在本仓库工作时必须遵循的项目约定。

## 双入口同步规则

根目录 `AGENTS.md` 与 `CLAUDE.md` 必须保持逐字一致。修改任一文件时必须同步修改另一个文件，并运行 `npx vitest run tests/agentInstructions.test.ts` 验证。

## 变更与 Git 安全

- 不要随意删除代码、文件或目录。删除本次任务开始前已经存在的内容，必须先获得用户确认。
- 未经用户明确要求，不得运行 `git add`、`git commit`、`git commit --amend`、`git push` 或同类暂存、提交与推送命令。完成实现不代表获得提交授权。
```

保留现有 `## 语言约定` 及其后全部内容，不重排或重写业务约束。

- [x] **Step 2：用 `apply_patch` 创建内容完全相同的 `AGENTS.md`**

`AGENTS.md` 的完整内容必须是修改后的 `CLAUDE.md` 全文。创建后先运行：

Run: `diff -u AGENTS.md CLAUDE.md`

Expected: 无输出，exit code 为 0。

- [x] **Step 3：运行契约测试并确认绿灯**

Run: `npx vitest run tests/agentInstructions.test.ts`

Expected: PASS，入口一致性、同步规则、git 安全规则和三份 Matt 配置检查全部通过。

### Task 3：记录 Codex / Claude + Matt 工作流

**Files:**

- Modify: `README.md`，在 `## 许可证` 前插入新章节
- Test: `tests/agentInstructions.test.ts`

- [x] **Step 1：加入工作流说明**

用 `apply_patch` 插入：

```markdown
## Codex / Claude + Matt 工作流

仓库同时支持 Codex 与 Claude Code：`AGENTS.md` 和 `CLAUDE.md` 是内容完全一致的项目规则入口，修改时必须同步。`docs/agents/` 保存两端共享的 Matt 工作流配置，`docs/scratch/` 保存 spec、map、issues 和 handoff 等工作产物。

Matt skills 是开发环境依赖，不是本应用的 npm 依赖。使用相关流程前，需要在 Agent 环境中安装 `mattpocock/skills`，并确认能显式调用 `wayfinder`、`to-spec`、`to-tickets`、`implement`、`tdd`、`code-review`、`domain-modeling` 等 skills。不同客户端使用各自支持的显式 skill 调用入口。

项目规则优先于 skill 默认动作。除非用户明确要求，不得因为 `implement` 或其他 skill 的建议而运行 `git add`、`git commit`、`git push` 或同类命令。
```

- [x] **Step 2：确认 README 与入口中的安全规则一致**

Run: `rg -n 'Codex / Claude \+ Matt|git add|git commit|git push' README.md AGENTS.md CLAUDE.md`

Expected: README 出现工作流标题和 git 安全说明；两个入口内容仍保持一致。

### Task 4：完成验证

**Files:**

- Verify: `AGENTS.md`
- Verify: `CLAUDE.md`
- Verify: `README.md`
- Verify: `tests/agentInstructions.test.ts`

- [x] **Step 1：重新运行聚焦测试**

Run: `npx vitest run tests/agentInstructions.test.ts`

Expected: PASS。

- [x] **Step 2：运行完整 Vitest 测试集**

Run: `npm test`

Expected: 全部 Vitest 测试通过。若出现失败，先区分本次变更与工作区原有失败；本次新增测试必须通过。

- [x] **Step 3：检查变更范围与双入口一致性**

Run: `diff -u AGENTS.md CLAUDE.md`

Expected: 无输出，exit code 为 0。

Run: `git status --short -- AGENTS.md CLAUDE.md README.md tests/agentInstructions.test.ts docs/scratch/codex-matt-migration`

Expected: 只显示本计划声明的 Agent 迁移文件；不执行暂存或提交。

- [x] **Step 4：报告结果**

报告新增或修改的文件、聚焦测试与完整测试结果，以及当前工作区仍存在但未触碰的其他改动。不要执行浏览器测试、文件删除、git 暂存或提交。
