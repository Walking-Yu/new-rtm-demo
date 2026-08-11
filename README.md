# RTM 场景实验室

用真实的 Agora RTM Web SDK 演示信令场景：每个场景在同一页面里跑**多个真实客户端**，
并把每一次 RTM API 调用与回调事件实时画在时间线上。

当前已实现 **语聊房**（房主端 + 听众端，两台手机并排）。注册表里另有 22 个已规划场景，
点进去是占位页 —— 骨架、导航、时间线是共用的，新增场景只需补自己的目录。

```
一级 tab   社交 / 教育 / 企业 / 物联网 / 内容 / 医疗 / 出行 / 游戏
二级 tab   该分类下的场景，已实现的可点进去，未实现的标「待建」
主区       场景本体（语聊房 = 两台手机）
右侧       时间线面板，按 uid 归并两端的 RTM 调用与事件
```

---

## 三条必读声明

**缺一不可。把本项目当作生产参考之前必须先读完这一节。**

### 1. 单页面多个 RTM 实例是实测可行，但官方文档未作保证

本项目的核心做法是**一个角色一个 `RTMClient` 实例**（房主一个、听众一个，同页共存）。
这条路径是实测可行的，但**官方文档没有承诺它**，反而在 SDK 自带的类型定义里写着相反口径的建议：

> 推荐全局只创建一个 RTM 实例……RTM 不支持多实例同时登录，请避免引发多实例互踢问题。
> —— `vendor/agora-rtm-2.3.0/agora-rtm.d.ts`

实测结论是：这句话实际约束的是**同一 `appId + userId`** 的重复实例（第二个会在构造期抛
`-10027 RTM_ERROR_DUPLICATE_USER_ID`），而不同 userId 的多实例可以正常构造、登录、各自收自己的事件
（事件回调按实例严格隔离，已实测）。SDK 里**不存在**实例数量上限的硬编码，也没有「实例数超限」的错误码。

但请注意这是**从实现与实测反推的结论，不是官方承诺**：

- 官方 migration guide 只说明事件回调绑定在 client 实例上，对跨实例行为无任何说明：
  <https://docs.agora.io/en/realtime-media/rtm/reference/migration-guide/web>
- 服务端对同 appId 大量并发 uid 的策略与**计费**影响未验证。
- 后续 SDK 版本可能改变这一行为。

**所以：照抄进生产前请自行压测并与声网确认。** 完整证据与偏移量级引用见
[`docs/research/2026-08-05-rtm-web-多实例与嵌入约束.md`](docs/research/2026-08-05-rtm-web-多实例与嵌入约束.md)。

一个直接的工程后果，实现时必须知道：那张重复 uid 注册表**只增不删**（全 bundle 无 `delete`）。
即 `logout()` 之后，同一个 userId 在**同一个页面生命周期内无法重建实例**。所以重连必须复用同一个
client 实例，而不是销毁重建；确实要重建就得换一个新 userId。

### 2. 治理动作不构成信任边界

Demo 里的踢出、封禁、强制麦控都是**客户端协作行为**：一端发消息、另一端自愿执行。
它们不是已强制执行的权限控制。任何一端改掉自己的代码就能不执行。

**生产环境必须在服务端校验。** 界面上也显式渲染了这条边界告警，请不要在二次开发时把它删掉，
也不要把这些动作描述成「已强制执行的权限控制」。

### 3. 默认 appId 无 token 鉴权，仅供体验

`index.html` 里内联注入的那个 App ID **没有开启 token 鉴权**，只为让 clone 下来就能跑通体验。

接入生产必须换成**支持 token 鉴权**的 App ID，并在 `login() / join()` 时传入 token。
代码里保留了 token 参数位，但**本项目不含 token 生成器、不接收 App Certificate、不预置任何密钥**，
也请不要新增 —— token 签发是服务端的事。

---

## 快速开始

环境要求：Node.js 20 或更高版本。

```bash
npm install
npm run dev          # http://127.0.0.1:8080/
```

不配置任何东西也能跑：`index.html` 里有一段开发用的体验 App ID 注入（见上面第 3 条声明）。
想换成自己的 App ID，两种方式任选：

```bash
cp .env.example .env.local   # 填 VITE_APP_ID=<你的 App ID>
```

或在浏览器控制台之外、由上层页面注入 `window.__ENV__`（见下一节）。运行时注入**优先于**构建期变量。

三者都没有时应用渲染引导页，不报错 —— 未配置不是异常。

常用命令：

```bash
npm run build        # tsc -b && vite build，单入口
npm test             # vitest
npm run test:e2e     # playwright，无头
```

房间号与各端 uid 自动推导，也可以用 URL 覆盖后把链接发给别人进同一个房间：

```
/social/voice-room?room=my-room&uid.host=alice&uid.audience=bob
```

**两端都会真实播放音频，人工验证时请戴耳机。**

---

## 注入契约

本实验室的设计前提是**被嵌进上层网站**（文档站、活动页）。上层通过 `window.__ENV__` 传入 App ID：

```ts
interface LabEnv {
  appId?: string;
}
```

优先级：`window.__ENV__.appId` → `import.meta.env.VITE_APP_ID` → 未配置（渲染引导页）。

**这个顺序不可颠倒。** `import.meta.env` 是构建期烧进 bundle 的常量，若让它优先，上层就永远换不掉 appId。

### 必须在加载 bundle 之前同步注入

env 快照**只在启动时读一次**，之后不监听变化、不轮询、不代理劫持。所以注入脚本必须放在
app 入口 `<script type="module">` 之前：

```html
<!-- 国内站：App ID 取自 https://console.shengwang.cn/ -->
<script>
  window.__ENV__ = { appId: '你的国内站 App ID' };
</script>
<script type="module" src="/assets/index-xxxx.js"></script>
```

```html
<!-- 国际站：App ID 取自 https://console.agora.io/ -->
<script>
  window.__ENV__ = { appId: '你的国际站 App ID' };
</script>
<script type="module" src="/assets/index-xxxx.js"></script>
```

两份示例的**脚本形状完全相同**，差别只在 App ID 来自哪个控制台。两站是不同的域与不同的项目体系，
App ID 不可互换；接入网关区域与防火墙白名单也不同 —— 白名单清单请向声网侧确认，
本仓库的调研笔记里那份域名列表是从 SDK bundle 反推的**候选清单**，不是官方承诺的完整集合。

### 嵌进 iframe 的话

```html
<iframe src="https://<demo-host>/social/voice-room"
        allow="camera; microphone"
        sandbox="allow-scripts allow-same-origin"></iframe>
```

- `allow-same-origin` **不可省**。RTM 只用 localStorage，无 `allow-same-origin` 的 sandbox iframe 里
  访问 localStorage 抛 `SecurityError`，`login()` 会直接失败。这是最容易被上层「出于安全」删掉、
  进而造成「你那能跑我这不能跑」的一项。
- `allow="camera; microphone"` 用于跨域委派设备权限，`'self'` 默认不委派给跨域子框架。
- CSP 的 `connect-src` 需显式列出接入与上报域名，不要依赖 `'self'`。

---

## 为什么 RTM 一角色一份、RTC 共享一份

**这一节不能省。** 少了它，后来者一定会尝试把两份 `rtm-*.ts` 抽成共享基类 —— 那正好会毁掉本项目的产品价值。

目录里看起来存在明显的「重复」：`rtm-host.ts` 与 `rtm-audience.ts` 各写一遍登录、订阅、锁、信封、
去重、重连，而 `rtc.ts` 只有共享的一份。这不是疏忽，是两类文件的**目标不同**：

| | `rtm-<role>.ts` | `rtc.ts` |
| --- | --- | --- |
| 定位 | **教材** | **脚手架** |
| 目标 | 被客户整份拷进自己项目 | 让 demo 能听见声音 |
| 依赖 | 零 runtime 依赖，只 import SDK 与纯类型 | 可自由 import 共享层（`rtcErrors` 等） |
| 份数 | 一场景一角色一份 | 全场景共享一份 |

一句话：**RTM 是这个 demo 要教的东西，RTC 只是为了把 RTM 的效果演示出来所必需的配套。**

客户的项目里已经有自己的 RTC 接法，不需要我们这份；但他们需要看到「语聊房的房主端，
用 RTM 到底该按什么顺序调哪些 API」。抽共享基类会让这条阅读路径断掉 —— 拷走一个文件变成拷走一棵依赖树，
而「打开一个文件就能看懂并拷走」是本项目唯一的核心卖点。

同一条原则的两个推论：

- **`rtm-<role>.ts` 里任何运行时的相对 import 都是 bug。** 业务规则经构造参数 `stateAdapter` 注入，
  而不是 import 同目录的转移函数。
- **`rtm-<role>.ts` 只写「调用顺序」，不写「业务规则」。** 「上麦要先抢锁、再读快照、再写回、再释放锁」
  是调用顺序，写在里面；「只有房主能同意上麦」是业务规则，在注入的纯函数里。

另外，只有**实际开麦的那个用户**才创建 RTC 实例，所以 `rtc.ts` 也不需要按角色拆份。
时间线**只呈现 RTM**，不采集 RTC —— 混入 RTC 节点会稀释「RTM 的数据流」这条主线。

---

## 目录导览

```
index.html                 唯一入口。含开发用的体验 App ID 注入

src/app/                   实验室外壳：路由、两级 tab、env 解析、身份推导、样式
src/scenes/registry.ts     8 个一级分类 + 23 个二级场景的注册表
src/scenes/voice-room/     唯一已实现的场景
src/shared/rtc.ts          全场景共享的 RTC 辅助模块
src/shared/timeline/       trace store、多实例归并、过滤
src/test/setup.ts          vitest 全局 setup
src/vite-env.d.ts          Vite 客户端类型（import.meta.env、?raw 后缀）

e2e/lab.spec.ts            端到端测试
tests/                     仓库形态与启动脚本的断言
vendor/agora-rtm-2.3.0/    尚未发布到 npm 的 RTM SDK，版权归声网
docs/                      spec、实现票、调研笔记
```

`src/scenes/voice-room/` 内部：

```
rtm-host.ts        房主端 RTM 单文件 ← 可拷走
rtm-audience.ts    听众端 RTM 单文件 ← 可拷走
state.ts           房间快照类型
transitions.ts     纯函数状态转移（业务规则都在这里）
stateAdapter.ts    快照的序列化与校验
orchestrator.ts    两端编排：创建两个 client、按生命周期连接与清理
VoiceRoomScene.tsx 场景容器
components/        纯展示组件
```

## 哪些文件可以直接拷走

**按需拷这几个，其余都是实验室脚手架：**

| 文件 | 说明 |
| --- | --- |
| `src/scenes/voice-room/rtm-host.ts` | 房主端。零 runtime 依赖，拷走即可用 |
| `src/scenes/voice-room/rtm-audience.ts` | 听众端。同上 |
| `src/scenes/voice-room/state.ts` | 房间快照类型。纯类型 |
| `src/scenes/voice-room/transitions.ts` | 纯函数转移。想换业务规则就改这里 |
| `src/scenes/voice-room/stateAdapter.ts` | 快照序列化。把上面三个接到 RTM 单文件上 |

两份 `rtm-*.ts` 的文件头注释里写了拷走前必须知道的事，以及该角色 RTM 用法的总览表格。

**不需要拷的**：`src/app/`（外壳）、`src/shared/`（时间线与 RTC 脚手架）、`components/`（展示层）、
`orchestrator.ts`（同页两端编排是 demo 特有需求）。

---

## 关于 vendor 里的 SDK

`agora-rtm@2.3.0` 尚未发布到 npm（npm 上最高仍是 `2.2.4`），所以随仓库携带在
`vendor/agora-rtm-2.3.0/`，依赖写成相对路径 `file:./vendor/agora-rtm-2.3.0`，
任意机器 clone 后 `npm install` 都能装上。

**该包版权归声网（Agora Lab, Inc.），遵循其自带的许可声明，不在本仓库 MIT 许可证范围内。**

正式发布到 npm 后：把依赖改回 `"agora-rtm": "^2.3.0"` 并删除 `vendor/` 目录。

## Codex / Claude + Matt 工作流

仓库同时支持 Codex 与 Claude Code：`AGENTS.md` 和 `CLAUDE.md` 是内容完全一致的项目规则入口，修改时必须同步。`docs/agents/` 保存两端共享的 Matt 工作流配置，`docs/scratch/` 保存 spec、map、issues 和 handoff 等工作产物。

Matt skills 是开发环境依赖，不是本应用的 npm 依赖。使用相关流程前，需要在 Agent 环境中安装 `mattpocock/skills`，并确认能显式调用 `wayfinder`、`to-spec`、`to-tickets`、`implement`、`tdd`、`code-review`、`domain-modeling` 等 skills。不同客户端使用各自支持的显式 skill 调用入口。

项目规则优先于 skill 默认动作。除非用户明确要求，不得因为 `implement` 或其他 skill 的建议而运行 `git add`、`git commit`、`git push` 或同类命令。

## 许可证

本仓库自身的 demo 代码与文档采用 MIT，见 [`LICENSE`](LICENSE)。
`vendor/` 下的 SDK 与通过 npm 安装的 `agora-rtc-sdk-ng` 各自遵循其自身许可证。
