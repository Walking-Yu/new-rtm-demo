# window.__ENV__ 注入与本地兜底

Type: grilling
Status: resolved
Blocked by: 04

## Question

上层页面通过 `window.__ENV__` 注入配置，具体契约是什么？本地开发怎么兜底？

需要定：

- `window.__ENV__` 的字段（至少一个 appId；是否还要 region、日志级别、场景白名单）。
- 读取时机与缺失时的行为：注入晚于 app 启动怎么办、完全没有注入时是报错页还是降级到 `.env`。
- 本地开发的 `.env` 兜底形态（Vite 的 `import.meta.env` 与 `window.__ENV__` 的优先级）。
- 现有 `SetupPage`（appId + 房间 ID + 两个用户 + 4 个 token 表单）的处置：删除、还是保留为本地调试入口。
- 房间 ID 与多个用户身份如何自动生成，避免不同访客互相干扰。

已定前提：单一 appId，RTM/RTC 共用，默认无 token 鉴权，不向体验用户索要 token。

被 `04` 阻塞的原因：如果实验室以 iframe 形式嵌入，`window.__ENV__` 的可达性与 storage 分区行为会影响注入方案与兜底策略。

## Answer

### 一、`window.__ENV__` 只有 appId（用户决策）

```ts
interface LabEnv {
  appId: string;
}
declare global {
  interface Window { __ENV__?: LabEnv }
}
```

**只有 `appId` 一个字段**，不加 region、日志级别、场景白名单：

- region —— `04` 已定国内站与国际站各自同源部署两份、各带一套 env，区域由「部署了哪一份」决定，不需要运行时字段。
- 日志级别 —— 开发期需要就改代码，没有让上层网站调它的场景。
- 场景白名单 —— `01` 已定未实现场景 tab 可见可点、进去是占位页，可见性是注册表 `status` 字段的职责，不由 env 控制。

字段集要扩展等到有真实需求，不预留。

### 二、优先级链：`window.__ENV__` → `import.meta.env` → 引导页

```
window.__ENV__.appId          线上：上层页面注入，最高优先级
  ↓ 缺失
import.meta.env.VITE_APP_ID   本地：.env 兜底
  ↓ 缺失
引导页（不是报错页）
```

`window.__ENV__` 必须能覆盖 `import.meta.env` —— 后者是构建期烧进 bundle 的常量，若让它优先，上层网站就永远换不掉 appId。

两者都缺时渲染**引导页**而非报错页：说明「本地开发请在 `.env` 写 `VITE_APP_ID=`，线上部署请在加载 bundle 前注入 `window.__ENV__`」，并给出两段可复制的代码。区别在于这不是异常，是未配置状态，措辞不用报错口吻。

体验用 appId `fd5c9856c5ee480d9dfec236ebc58815`（`11` 提供）只进 `.env` 与 `index.html` 的开发用内联 script，**不作为源码里的第三层硬编码兜底** —— 否则删掉 env 配置后 demo 仍能跑，注入契约就失去了约束力。

### 三、读取时机：要求同步注入，启动时读一次快照

上层页面**必须在加载 app bundle 之前**写好 `window.__ENV__`：

```html
<script>window.__ENV__ = { appId: '...' };</script>
<script type="module" src="/assets/index.js"></script>
```

`04` 已定同源路由挂载（不用跨域 iframe），一段内联 `<script>` 就能满足，天然早于 app 启动。

App 启动时**读一次快照**存进模块常量，不监听后续变化、不做 `window.__ENV__` 的轮询或代理劫持。支持异步注入意味着要引入「等待 env」的加载态、以及注入迟到时已建立的 RTM 连接如何重连的问题，收益不成比例。这一要求写进 README 的注入契约一节。

### 四、不做「填表进房」：点 tab 直接进场景（用户决策）

新骨架**不实现** `SetupPage` 的等价物。点二级 tab 直接进入场景并自动连接，零表单、零手填。理由：appId 来自 env，token 按已定决策默认不需要，房间 ID 与用户身份自动生成（见下），表单已无输入项可填。

`demos/voice-room/src/app/SetupPage.tsx`（186 行 + 73 行测试）在本阶段**不删除** —— 按 `10`，`demos/voice-room/` 整体保留，删除时机留给 `11`。这里定的只是根 `src/` 新骨架不再建等价物。

连带失效的现有产物：`connectionSettings.ts` 的 `appId` / `roomId` / 4 个 token 字段与 `sessionStorage` 持久化（key `agora.voice-room.connection.v1`）在新骨架里都没有对应物。新骨架的运行时配置不落 storage，每次刷新重新推导。

### 五、房间 ID 与用户身份：随机生成 + URL 可覆盖（用户决策）

**默认随机**，保证不同访客天然隔离：

```
房间 ID：voice-room-<random>      每次进入场景生成
uid：   host-<random> / audience-<random>
```

`<random>` 用短随机串（如 6 位 base36），足够避碰且便于口头传达。角色前缀保留 —— 时间线的 uid badge 依赖它做可读区分（见 `05`、`09`）。

**URL query 可覆盖**，用于两人对连同一个房间做真实联调：

```
?room=demo-42              指定房间 ID
?uid=host-alice            指定本端 uid（可选）
```

覆盖值不写入任何 storage，只从 URL 读；刷新时 URL 还在，行为稳定；分享链接即可让对方进同一个房间。这是 `04` 定的同源路由挂载下最省的做法 —— 无需 sessionStorage、无需后端分配、无需上层网站参与。

同一标签页内两个客户端（`host` + `audience`）的 uid 必须不同，由前缀 + 各自独立随机段保证，不做冲突检测。

### 六、连带确认的边界

- **仍不接收 token**：`login` 保留 token 参数位（`11` 的第三条声明），但 env 里没有 token 字段，也不从 URL 读 token。客户换成支持 token 的 appId 时自己接 token server。
- **仍不接收 App Certificate**：项目不含 token 生成器、不预置密钥，这一条不因 env 契约的引入而松动。

### 七、留给 charting 的实现要点

- env 读取放 `src/app/` 下单独一个模块（如 `env.ts`），导出已解析的 `appId` 与一个「未配置」判定，路由在渲染场景前先过这个判定。
- 房间 ID / uid 的推导放同一层（`src/app/`），不放场景目录 —— 它是实验室外壳的职责，`rtm-<role>.ts` 只接受构造参数传入的 uid，保持零依赖。
- `.env.example` 需含 `VITE_APP_ID=`（`11` 交付清单已列）。
- README 的注入契约一节需给出两站各一份 `<script>` 示例（`11` 已列）。
