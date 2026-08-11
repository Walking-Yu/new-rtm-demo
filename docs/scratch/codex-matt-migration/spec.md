# Codex / Claude + Matt 双兼容迁移

## Problem Statement

仓库当前通过根目录 `CLAUDE.md` 向 Claude Code 提供项目约束，并通过
`docs/agents/` 与本机安装的 `mattpocock/skills` 组织 issue、spec、triage、
domain modeling 和实现流程。业务代码不依赖 Claude 或 Matt，但 Codex 不以
`CLAUDE.md` 作为仓库级指令入口，因此现有约束不能稳定地被 Codex 直接消费。

迁移目标是在不破坏 Claude Code 使用方式的前提下，让 Codex 与 Claude Code
读取同一套项目约束，并继续复用现有 Matt 工作流产物。

## Solution

采用完整双入口方案：根目录同时保留 `AGENTS.md` 与 `CLAUDE.md`，两份文件内容
逐字一致，使用平台中立的标题和开场说明。新增自动化测试锁定两份文件的一致性，
并验证 Matt 工作流所依赖的三份仓库配置存在。

README 增加 Codex / Claude + Matt 工作流说明，明确 Matt skills 是开发环境依赖，
不是应用运行依赖；它们需要在使用者的 Agent 环境中另行安装。仓库中的
`docs/agents/` 和 `docs/scratch/` 继续作为跨 Agent 共享的持久化工作产物。

## User Stories

- 作为 Codex 使用者，我希望 Codex 启动后直接读取完整项目约束，不依赖间接引用
  `CLAUDE.md`。
- 作为 Claude Code 使用者，我希望现有 `CLAUDE.md` 和 `.claude/` 配置继续可用。
- 作为维护者，我希望修改任一 Agent 入口后，测试能发现两份规则发生漂移。
- 作为 Matt skills 使用者，我希望 Codex 与 Claude Code 都沿用同一套本地 Markdown
  issue tracker、triage 标签和 domain 文档约定。
- 作为仓库使用者，我希望 Agent 不会因为 Matt 的默认流程而擅自暂存或提交代码。

## Implementation Decisions

### 双入口保持完全一致

- 新建根目录 `AGENTS.md`。
- 将 `CLAUDE.md` 开头改为 Codex / Claude Code 通用表述。
- 两份文件保持逐字一致，而不是让一个入口引用另一个入口。
- 两份文件都写明：修改项目级 Agent 规则时必须同步修改另一个入口。

直接加载完整规则比跨文件引用更可靠。完全一致也让同步测试保持简单，不需要维护
平台差异白名单。

### Matt 配置继续共享

保留并继续使用：

- `docs/agents/issue-tracker.md`
- `docs/agents/triage-labels.md`
- `docs/agents/domain.md`
- `docs/scratch/<effort>/` 下的 spec、map、issues 与 handoff

不复制或 vendor 本机的 Matt skill 源码到仓库。README 只记录前置条件和主要 skill
名称，不虚构未经当前安装来源验证的安装命令。

### 仓库安全规则覆盖 skill 默认动作

项目规则的优先级高于 skill 的默认建议。即使 Matt 的 `implement` 或其他 skill
要求 commit，Agent 也不得在用户未明确要求时运行 `git add`、`git commit`、
`git push` 或同类命令。

`.claude/settings.local.json` 继续保留给 Claude Code 使用。迁移不创建项目级
`.codex/` 私有配置，也不把用户机器上的 Codex 全局配置写入仓库。

### 变更范围

本次只创建或修改：

- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `tests/agentInstructions.test.ts`
- `docs/scratch/codex-matt-migration/spec.md`
- `docs/scratch/codex-matt-migration/plan.md`

不修改应用运行时代码、构建配置、RTM/RTC 实现、现有 Matt 配置或历史
`docs/superpowers/` 文档。

## Testing Decisions

新增 Node 环境下运行的 Vitest 测试：

1. 读取根目录 `AGENTS.md` 与 `CLAUDE.md`，断言内容完全相同。
2. 断言两份入口包含双入口同步规则。
3. 断言 `docs/agents/issue-tracker.md`、`docs/agents/triage-labels.md` 和
   `docs/agents/domain.md` 均存在。

先单独运行新增测试，再运行完整 `npm test`。本次不改变浏览器行为，因此不运行
Playwright E2E。

## Success Criteria

- Codex 能从根目录 `AGENTS.md` 读取全部项目约束。
- Claude Code 继续从 `CLAUDE.md` 读取相同约束。
- 两份入口逐字一致，自动化测试可阻止漂移。
- README 清楚说明 Matt skills 的定位、共享产物和 git 安全边界。
- 新增测试与完整 Vitest 测试集通过。
- 没有业务代码变更，没有文件删除，没有 git 暂存或提交。

## Out of Scope

- 修改或 fork 全局 `~/.agents/skills/` 下的 Matt skills。
- 为 Codex 或 Claude Code写入用户级认证、模型、MCP 或权限配置。
- 清理当前工作区已有的 staged、unstaged 或删除状态。
- 修复现有 Playwright 已知红灯。
- 修改现有 RTM Demo 功能或 UI。
