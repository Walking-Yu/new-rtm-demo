# 目录架构审计

审计日期：2026-08-11

最近复核：2026-08-11

## 结论

应用目录架构已经干净。此前的业务代码与迁移变更已统一进入暂存区；本次说明更新按项目规则没有自动暂存，因此 Git 工作区还不是最终 clean 状态。

当前仓库已经是单入口、单应用。旧 `src/legacy/`、`legacy.html`、`demos/voice-room/` 均不存在。`src/scenes/voice-room/` 是现在正式的语聊房场景，不是遗留代码。

初次审计发现的 Git 混合状态、未跟踪 Agent 文件、已跟踪 `.DS_Store` 和已跟踪测试结果均已处理。当前唯一尚未处理的目录清理项是根目录 `语聊房assets/`。

## 顶层目录

| 目录 | 用途 | 是否必要 | 判断 |
| --- | --- | --- | --- |
| `.claude/` | Claude Code 本机配置，当前只有 `settings.local.json` | 可选 | 不影响应用，已由全局 Git ignore 忽略，可本地保留 |
| `.git/` | Git 仓库对象、索引、分支和历史 | 必要 | 版本控制必需，不要手工修改 |
| `dist/` | `npm run build` 生成的生产包 | 可再生 | 不应提交，已忽略；需要时重新构建 |
| `docs/` | 需求、调研、spec、票据、handoff 和 Agent 配置 | 必要 | 结构合理；原先已跟踪的两个 `.DS_Store` 已移除，删除变更已暂存 |
| `e2e/` | Playwright 端到端测试，目前只有 `lab.spec.ts` | 必要 | 单套 E2E，符合单应用架构 |
| `node_modules/` | npm 安装的依赖 | 本地必要 | 可通过 `npm install` 重建，已忽略，不应提交 |
| `src/` | 唯一应用源码 | 必要 | 架构干净：只有 `app/`、`scenes/`、`shared/`、`test/` |
| `test-results/` | Playwright 失败上下文、trace 和运行状态 | 可再生 | 已从 Git 跟踪列表移除并整体忽略；本地目录可按需保留或重新生成 |
| `tests/` | 仓库结构与 Agent 规则测试 | 必要 | 防止恢复多入口、双入口漂移等结构回归 |
| `vendor/` | 随仓库携带尚未发布的 `agora-rtm@2.3.0` | 当前必要 | `npm install` 依赖它；SDK 正式发布后才能移除 |
| `语聊房assets/` | 最初需求、截图、照片、Word 文档等原始输入 | 应用不需要 | 未被源码引用且已忽略；所需参考图已进入 `docs/inputs/`，建议确认后迁出或删除 |

## 根目录文件

| 文件 | 用途 | 是否必要 | 判断 |
| --- | --- | --- | --- |
| `.DS_Store` | macOS Finder 元数据 | 不需要 | 已忽略，可删除 |
| `.env.example` | App ID 配置模板 | 必要 | 应提交，不含真实凭证 |
| `.env.local` | 本机 App ID 配置 | 可选 | 已忽略；普通 demo 会加载它，E2E 独立 mode 不会加载 |
| `.gitignore` | 排除依赖、构建物、凭证和本地素材 | 必要 | 基本合理 |
| `AGENTS.md` | Codex 项目约束入口 | 必要 | 已纳入 Git 暂存区，并由测试锁定与 `CLAUDE.md` 逐字一致 |
| `CLAUDE.md` | Claude Code 项目约束入口 | 必要 | 与 `AGENTS.md` 逐字一致 |
| `LICENSE` | 项目 MIT 许可证 | 开源必要 | 应保留 |
| `README.md` | 项目说明、运行方式和生产边界 | 必要 | 当前描述的是新单应用 |
| `index.html` | Vite 唯一 HTML 入口 | 必要 | 单入口架构核心 |
| `package.json` | npm 脚本和依赖声明 | 必要 | 只管理当前应用 |
| `package-lock.json` | 锁定完整依赖树 | 必要 | 应提交，保证可重复安装 |
| `playwright.config.ts` | 无头 E2E、浏览器和测试服务器配置 | 必要 | 只指向 `e2e/` |
| `start-demo.sh` | 环境检查、安装依赖和一键启动 | 必要 | 项目约定的标准启动入口 |
| `tsconfig.json` | TypeScript 工程引用入口 | 必要 | 串联 app/node 两套配置 |
| `tsconfig.app.json` | `src/` 应用与测试的 TypeScript 配置 | 必要 | 范围正确，只包含 `src` |
| `tsconfig.node.json` | Vite、Playwright 等 Node 配置文件的 TypeScript 配置 | 必要 | 范围正确 |
| `vite.config.ts` | Vite 构建、开发服务器和 Vitest 配置 | 必要 | 单入口，没有遗留多入口配置 |

## 清理状态

| 原问题 | 当前状态 | 结论 |
| --- | --- | --- |
| Git 工作区大量 staged/unstaged 混合 | 此前的业务代码与迁移变更已统一进入暂存区；本次说明更新尚未暂存 | 原问题已完成，文档更新等待纳入最终提交 |
| `AGENTS.md` 等文件未跟踪 | `AGENTS.md`、Agent 测试和迁移文档均已进入暂存区 | 已完成，等待最终提交 |
| `docs/.DS_Store`、`docs/superpowers/.DS_Store` 已被跟踪 | 两个文件均已从工作树移除，删除变更已暂存 | 已完成，等待最终提交 |
| `test-results/.last-run.json` 已被跟踪 | 已从 Git 跟踪列表移除，`test-results/` 继续由 `.gitignore` 忽略 | 已完成 |
| `语聊房assets/` 位于项目根目录 | 目录仍在，未被源码引用，也未在归档仓库找到副本 | **未完成：确认后迁入归档仓库或删除** |

## 可选的本地卫生清理

根目录 `.DS_Store` 与 `docs/scratch/.DS_Store` 仍存在，但都已被忽略，不会进入 Git。它们不影响构建、测试或提交，可按需删除。

综上：代码架构已经干净；此前的 Git 变更已经统一暂存；除 `语聊房assets/` 外，初次审计列出的仓库清理项均已完成。本次说明更新仍需在最终提交前纳入暂存区。
