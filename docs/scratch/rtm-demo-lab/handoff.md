# 交接文档：RTM Demo 实验室重构

更新时间：2026-08-06

本文件是给下一位接手者（人或 agent）的入口。**它不重复决策内容**，只说明「现在在哪、下一步做什么、有哪些坑」。决策正文一律去 `map.md` 与各票文件里读。

## 一、先读这三个文件

按顺序读，大约 15 分钟：

1. `CLAUDE.md`（仓库根）—— 硬约束。重点：对话与文档一律简体中文；`docs/` 下的文档不允许删除；仓库里有两套互不依赖的代码。
2. `docs/scratch/rtm-demo-lab/map.md` —— 本次 effort 的地图。Notes 里 10 条前置决策 + Decisions so far 里 11 条已定结论 + Not yet specified 里剩下的三点迷雾。
3. `docs/inputs/index.md` —— 用户的原始需求（两级 tab 清单、时间线要求、`rtm.js`/`rtc.js` 目录要求、env 要求）。

补充材料：`docs/research/2026-08-05-rtm-web-多实例与嵌入约束.md`（多实例调研）、`docs/inputs/单个demo页面的参考UI.png`（腾讯云的布局参考，图片仍在 `docs/inputs/`）。

## 二、当前状态

### 这是一次 wayfinder effort，不是实现阶段

目标是**锁定「实验室骨架 + 语聊房样板场景」的全部设计决策**，产出一份可建造的 spec。23 个场景的逐个实现不在范围内。验收锚点：第二个场景能靠复制样板在一天内产出。

### 票池：11 张，全部 resolved —— 地图已无前沿

| 票 | 类型 | 状态 |
| --- | --- | --- |
| 01 场景清单与两级导航映射 | grilling | resolved |
| 02 rtm.ts 契约与目录形态 | grilling | resolved |
| 03 npm 依赖可安装化 | task | resolved |
| 04 RTM Web 多实例与嵌入约束调研 | research | resolved |
| 05 时间线数据模型与 uid 前缀 | grilling | resolved |
| 06 env 注入与本地兜底 | grilling | resolved |
| 07 共享 rtc.ts 接口边界 | grilling | resolved |
| 08 各场景客户端数量上限 | grilling | resolved |
| 09 单页 demo 布局原型 | prototype | resolved |
| 10 语聊房迁移切分 | grilling | resolved |
| 11 开源合规与交付清单 | grilling | resolved |

### 代码现状

- `demos/voice-room/` —— 现有语聊房 SPA（约 2700 行），六边形分层，测试完整。按 `10` 的决策，新骨架会在根 `src/` 下重建，**本阶段不删除它**。
- 根 `src/` —— 遗留 24 场景实验室，已从默认导航摘除，作为场景清单的种子使用。
- `demos/voice-room/src/prototype/` —— **09 号票的一次性布局原型**（约 1500 行，含 912 行 CSS）。全部假数据，不连 RTM/RTC。页面顶部有横幅写明「确认后即删除」。这是唯一有未提交改动的地方（`PrototypeApp.tsx`、`prototype.css`）。

原型跑法：

```bash
cd demos/voice-room && npm run dev
# 打开 http://127.0.0.1:8080/prototype.html
```

原型目前已确认的布局：一级 tab（横向滚动）+ 二级 tab（药丸形）+ 主区两台手机并排（房主视角 / 听众视角）+ 右侧 400px 时间线面板（可折叠成 40px 竖条，≤1240px 时变横排）。手机高度 `min(812px, calc(100vh - 210px))`，只有公屏滚动，其余区块 `flex-shrink: 0` 钉住，底部输入条常驻框内。麦位方框已按用户要求缩小两轮（当前 `min-height: 76px`、头像 26px）。

## 三、charting 已完成，下一步是逐票实现

决策票 `01`–`11` 全部 resolved，charting 也已完成：

- **spec** —— 同目录 `spec.md`，按 Matt 的模板写（Problem Statement / Solution / User Stories / Implementation Decisions / Testing Decisions / Out of Scope）。它是唯一的建造依据，与票冲突时以 spec 为准，并回头修票。
- **实现票** —— 同目录 `issues/12`–`25`，由 spec 拆出，每张票带 `Blocked by` 边。`12`、`13` 已 resolved，其余 `ready-for-agent`。
- **前沿**：`14`（env 与身份推导）、`16`（trace store）、`17`（状态与转移）、`21`（RTC 辅助）四张票的阻塞都已解除，可并行开工。

**下一步是对前沿票逐张跑 `/implement`，每张票开始前清空上下文。**

> 票号说明：`01`–`11` 是 wayfinder 阶段的决策票（产出决策），`12`–`25` 是实现票（产出代码），编号连续不重叠。下面几节保留下来，是为了说明 spec 里各项决策的来处。

charting 时特别注意这几处**跨票耦合**，spec 里要写成一致的整体，不能各票照抄：

- `05` 的 `TraceEntry` 字段 ↔ `09` 的三维筛选（`uid` / `role` / `kind`）↔ `10` 的「trace 由 `rtm-<role>.ts` 自持」—— 筛选不新增字段，归并在 `shared/timeline/`。
- `06` 的「不做 SetupPage 等价物、uid 随机生成」↔ `10` 的「`rtm-<role>.ts` 只接受构造参数传入的 uid」—— 身份推导归 `src/app/`，场景目录不参与。
- `02`/`05`/`10` 共同的**零依赖铁律** ↔ `07` 的「`rtc.ts` 允许被 import」—— 这是唯一的例外，spec 必须写明理由，否则后来者会误以为可以再抽共享层。
- `08` 的「端数写在场景目录 `config.ts`」↔ `01` 的「注册表只留四字段」—— 不要把端数塞回注册表。

spec 必须覆盖的骨架形态（来自 `10`）：

```
src/
  app/                    路由、两级 tab 导航、env 读取
  scenes/
    registry.ts           场景注册表（id/title/summary/status 四字段）
    voice-room/
      index.tsx           该场景的 main container
      rtm-host.ts         ← 可拷走，零依赖
      rtm-audience.ts     ← 可拷走，零依赖（多个听众实例共享）
      state.ts            快照类型
      transitions.ts      纯函数转移（注入给 rtm-*.ts）
      config.ts           端数上限等场景配置
  shared/
    rtc.ts                共享 RTC 辅助（允许被 import）
    timeline/             时间线面板 + 多实例 trace 归并
    ui/                   通用外壳
vendor/
  agora-rtm-2.3.0/        未发布的 SDK 包
```

## 四、坑与风险清单

按会咬人的顺序排：

1. **仓库一个 commit 都没有。** `git log` 报 `your current branch 'master' does not have any commits yet`，索引里已 `git add` 了 134 个文件。开源前需要建立基线 —— 但**不要擅自 commit**，`CLAUDE.md` 明确要求 git 提交类操作必须由用户显式发起。
2. **依赖指向本机绝对路径。** 根 `package.json` 与 `demos/voice-room/package.json` 都写着 `"agora-rtm": "file:/Users/zhouxueqin/Downloads/agora-rtm-2.3.0-beta.0"`。换机器 `npm install` 直接失败。`11` 已决定改为 vendor 相对路径，但 `vendor/` 目录**还没建**，包也还没复制进来。源包在 `/Users/zhouxueqin/Desktop/agora-rtm-demo/agora-rtm@2.3.0`（已核验是 2.3.0 正式版、零 runtime 依赖、license `Apache`）。
3. **`agora-rtm@2.3.0` 仍未发布到 npm**，registry 最高 `2.2.4`。发布后要把 `file:./vendor/...` 换成 `^2.3.0` 并删掉 `vendor/`。
4. **多 RTM 实例是实测可行、官方文档未保证。** 这是整个架构的地基（一角色一个 client 实例），README 必须显式声明这一状态，否则客户照抄进生产、日后 SDK 行为变化时会误判归因。
5. **`agora-rtc-sdk-ng` 版本没锁**，写的是 `"latest"`。`03` 已决定锁版本，还没落地。
6. **两站部署的域名白名单未核实。** 国内站与国际站是不同域，这是从「两站分立」推出的必然结果，不是查证过的事实。写进 README 前必须核对官方域名列表。
7. **治理动作不构成信任边界。** 踢出、封禁、强制麦控都是客户端协作行为。现有 `RoomPage` 有显式告警，保持这个表述，不要改写成「已强制执行的权限控制」。
8. **原型是一次性的。** 页面横幅写明「确认后即删除」。但删除时机由用户定，不要自行删 —— 且 09 的答案没写进票之前，删了就等于丢决策。

## 五、环境

- Node `v22.22.1`（要求 ≥ 20）。
- 常用命令见 `CLAUDE.md` 的「常用命令」一节；根目录脚本通过 `npm --prefix` 委托给 `demos/voice-room`。
- 体验用 appId：`fd5c9856c5ee480d9dfec236ebc58815`（无 token 鉴权，仅供体验）。项目不接收 App Certificate、不含 token 生成器、不预置密钥 —— 不要新增。
- 需要浏览器访问 Jira / Confluence / DataLego 时，用全局约定的 `agent-browser --profile ~/.agent-browser/agoralab`。

## 六、工作流约定

- 票的认领与解决流程见 `docs/agents/issue-tracker.md`：开工前把 `Status:` 改成 `claimed`，完成后追加 `## Answer`、改成 `resolved`、再往 `map.md` 的 Decisions so far 追加一条一句话摘要 + 链接。
- 一票一文件，绝不合并。
- spec 放 `docs/scratch/<feature-slug>/spec.md`，实现票放 `docs/scratch/<feature-slug>/issues/<NN>-<slug>.md`；调研笔记放同目录的 `research-<slug>.md`。
