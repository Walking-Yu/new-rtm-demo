# 交接文档：RTM 场景实验室

更新时间：2026-08-20

## 当前状态

`rtm-demo-lab` 已完成语聊房单 Tab 单角色架构迁移的主体实现（票 41–48）。当前仓库只有根目录 `src/` 下的一套应用代码：

```text
src/
  app/       路由、两级导航、环境与身份
  scenes/    8 个一级分类、23 个二级场景；语聊房已实现
  shared/    RTC 脚手架与 RTM 时间线
  test/      Vitest 全局 setup
```

旧的独立语聊房 SPA 与旧的 24 场景实验室已迁移到相邻仓库 `../new-rtm-demo-legacy/`。旧 Lock RTM、同页双端 orchestrator、兼容入口和专属历史测试也已从当前仓库删除；需要核对历史行为时去归档仓库运行。

## 先读这些

1. 根目录 `AGENTS.md` 或 `CLAUDE.md`：两份文件逐字一致，是当前工程约束。
2. `spec.md`：实验室骨架与语聊房样板的建造依据。
3. `issues/25-验收与收尾.md`：三条架构规则、验收结论与未决项。
4. `README.md`：运行方式、生产边界与嵌入契约。
5. `语聊房页面初始化-api-备忘录-最新.md`：语聊房当前最终架构契约。

## 验证状态

2026-08-18 本轮定向验证：

- `npx vitest run`：25 个测试文件、297 项通过。
- `npm run build`：通过，单入口只产出 `dist/index.html`。
- `npm run test:e2e`：27 项通过、1 项跳过；E2E 使用独立 mode 和无网络 adapter，不加载本机 `.env.local`。

Playwright 启动 Vite 时显式传入 `--mode e2e`，该 mode 下设置 `envDir: false`。因此开发者可以长期在 `.env.local` 配置真实 `VITE_APP_ID`，测试仍能稳定覆盖未配置分支；普通 demo 启动不受影响。

## 尚未完成

- 其余 22 个场景仍是占位页，这是原 effort 的范围边界。
- “第二个场景一天产出”尚未得到真实场景实现的验证，只能作为设计目标。
- 两站域名白名单仍需向声网侧确认。
- 当前分支已有 Git 基线，但仍有已暂存变更和本次尚未暂存的说明更新等待最终提交；未经用户明确授权，不得提交或推送。

## 当前关键约束

- 一个 Tab 只有一个角色和一个页面级 RTM client。
- Host/Audience `rtm.ts` 只依赖页面级会话 seam，不 login/logout、不主动读 Storage、不使用 Lock。
- Storage 只有四个房间 key；目录与封禁只存 Local Storage。
- 麦位只表达归属，RTC 发布失败保留麦位。
- 重连仅消费 SDK 后续全量事件，不重订阅、不重放、不补读。
- 时间线只呈现 RTM，不采集 RTC trace。
- 治理动作属于客户端协作，不构成生产信任边界。

## 归档仓库

`../new-rtm-demo-legacy/` 有自己的 Git 基线、依赖、启动脚本与 README：

```bash
cd ../new-rtm-demo-legacy
npm test
npm run build:legacy
npm run build:voice-room
```

当前仓库通过 npm 安装 `agora-rtm@2.3.0`，本机遗留的 `vendor/` 已被 gitignore，不随开源仓库分发。归档仓库的历史副本独立保留。
