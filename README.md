# RTM 场景实验室

用真实的 Agora RTM Web SDK 演示信令场景。语聊房每个浏览器 Tab 只运行**一个角色和一个 RTM client**，
并把当前角色的每一次 RTM 调用与回调事件实时画在时间线上。

当前已实现 **语聊房**（Host 与 Audience 分别在独立 Tab 中运行）。注册表里另有 22 个已规划场景，
点进去是占位页 —— 骨架、导航、时间线是共用的，新增场景只需补自己的目录。

想从源码理解 RTM 在语聊房中的推荐用法，请从[《语聊房：RTM 最佳实践示例》](src/scenes/voice-room/README.md)开始。它串起页面级 RTM 会话、Host/Audience 角色操作、入站事件、业务状态和进一步的协议时序文档。

```
一级 tab   社交 / 教育 / 企业 / 物联网 / 内容 / 医疗 / 出行 / 游戏
二级 tab   该分类下的场景，已实现的可点进去，未实现的标「待建」
主区       场景本体（语聊房 = 当前 Tab 的单角色视图）
右侧       时间线面板，展示当前角色的 RTM 调用与事件
```

---

## 三条必读声明

**缺一不可。把本项目当作生产参考之前必须先读完这一节。**

### 1. 单页面多个 RTM 实例是实测可行，但官方文档未作保证

> 历史说明：当前语聊房已不依赖同页多实例，每个 Tab 只创建一个 RTM client。以下调研结论仅供其他可能需要多实例的场景参考。

历史版本曾使用**一个角色一个 `RTMClient` 实例**（房主一个、听众一个，同页共存）。
这条路径是实测可行的，但**官方文档没有承诺它**，反而在 SDK 自带的类型定义里写着相反口径的建议：

> 推荐全局只创建一个 RTM 实例……RTM 不支持多实例同时登录，请避免引发多实例互踢问题。
> —— `agora-rtm@2.3.0` 包内的 `agora-rtm.d.ts`

实测结论是：这句话实际约束的是**同一 `appId + userId`** 的重复实例（第二个会在构造期抛
`-10027 RTM_ERROR_DUPLICATE_USER_ID`），而不同 userId 的多实例可以正常构造、登录、各自收自己的事件
（事件回调按实例严格隔离，已实测）。SDK 里**不存在**实例数量上限的硬编码，也没有「实例数超限」的错误码。

但请注意这是**从实现与实测反推的结论，不是官方承诺**：

- 官方 migration guide 只说明事件回调绑定在 client 实例上，对跨实例行为无任何说明：
  <https://docs.agora.io/en/realtime-media/rtm/reference/migration-guide/web>
- 服务端对同 appId 大量并发 uid 的策略与**计费**影响未验证。
- 后续 SDK 版本可能改变这一行为。

**所以：照抄进生产前请自行压测并与声网确认。** 完整证据与偏移量级引用见
[《RTM Web 多实例与嵌入约束》](src/scenes/voice-room/docs/2026-08-05-rtm-web-多实例与嵌入约束.md)。

一个直接的工程后果，实现时必须知道：那张重复 uid 注册表**只增不删**（全 bundle 无 `delete`）。
即 `logout()` 之后，同一个 userId 在**同一个页面生命周期内无法重建实例**。所以重连必须复用同一个
client 实例，而不是销毁重建；确实要重建就得换一个新 userId。

### 2. 治理动作不构成信任边界

Demo 里的踢出、封禁、强制麦控都是**客户端协作行为**：一端发消息、另一端自愿执行。
它们不是已强制执行的权限控制。任何一端改掉自己的代码就能不执行。

**生产环境必须在服务端校验。** 界面上也显式渲染了这条边界告警，请不要在二次开发时把它删掉，
也不要把这些动作描述成「已强制执行的权限控制」。

### 3. 仓库不包含真实 App ID、App Certificate 或 token

App ID 虽然不是密码，但它标识真实项目，公开后可能被滥用并消耗项目资源，因此不应提交真实值。仓库中的 `.env.example` 只保留空配置模板。

代码里保留了 token 参数位，但**本项目不含 token 生成器、不接收 App Certificate、不预置任何密钥**。生产环境应由 App Server 签发 token，并通过部署环境注入 App ID。

---

## 快速开始

环境要求：Node.js 20 或更高版本。

```bash
npm install
cp .env.example .env.local   # 填写 VITE_APP_ID=<你的 App ID>
npm run dev          # http://127.0.0.1:8080/
```

启动脚本默认监听所有 IPv4 网卡，在 HTTPS `8080` 上提供服务，并且不自动打开浏览器。日志会打印其他设备可访问的局域网 IPv4 URL：

```bash
./start-demo.sh             # 默认：HTTPS 8080，监听 0.0.0.0，不打开浏览器
./start-demo.sh --https     # 显式 HTTPS 8080
./start-demo.sh --http      # HTTP 8080
./start-demo.sh --both      # HTTP 8080 + HTTPS 8443
```

`--no-open` 作为旧命令的兼容参数继续接受，但默认行为本身已经不会打开浏览器。只允许本机访问时可显式设置 `RTM_DEMO_HOST=127.0.0.1`。

局域网麦克风、摄像头或 Clipboard API 需要可信 HTTPS。HTTPS 模式使用 `mkcert` 为 `localhost`、`127.0.0.1` 和自动发现的局域网 IPv4 地址生成证书到 `.cert/`。首次使用需由用户自行执行 `mkcert -install`；其他电脑或手机还需要安装并信任启动日志中打印的 `rootCA.pem`。不要提交 `.cert/`、私钥或本地 CA。

App ID 有两种配置方式：

```bash
cp .env.example .env.local   # 填 VITE_APP_ID=<你的 App ID>
```

或在浏览器控制台之外、由上层页面注入 `window.__ENV__`（见下一节）。运行时注入**优先于**构建期变量。

三者都没有时应用渲染引导页，不报错 —— 未配置不是异常。

常用命令：

```bash
npm run build        # tsc -b && vite build，单入口
npm run dev:https    # HTTPS 8080；需先由 start-demo.sh 生成证书
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

优先级：`window.__ENV__.appId` → `import.meta.env.VITE_APP_ID` → 未配置。
若上层显式注入了空的 `window.__ENV__` 且没有 `VITE_APP_ID`，则视为未配置并渲染引导页；
这也是 E2E 稳定覆盖未配置分支的方式。

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

## 为什么 RTM 按角色拆模块、RTC 共享一份

**这一节不能省。** 少了它，后来者容易把业务协议塞回 `rtm.ts`，或把两个角色的 RTM 机制抽成共享基类。

本节只概括整个实验室的模块取舍；语聊房的完整阅读顺序、RTM primitive 选择和单页生命周期见[场景 README](src/scenes/voice-room/README.md)。

每个角色由 `rtm.ts` 与 `onRtmEvent.ts` 组成：前者提供按功能命名的原子 RTM 操作，后者负责事件绑定、信封校验和去重。业务状态统一留在 `event-driven-single-room-client.ts`，SDK client 与 login/logout 统一留在 `app-rtm.ts`。Host/Audience 的角色模块刻意独立，`rtc.ts` 则全场景共享。

| | 角色 RTM bundle | `rtc.ts` |
| --- | --- | --- |
| 定位 | **可复制的 RTM 接入样板** | **脚手架** |
| 目标 | 按角色复制 `rtm.ts + onRtmEvent.ts` | 让 demo 能听见声音 |
| 依赖 | 只依赖页面级 RTM seam，不依赖业务状态 | 可 import 共享层 |
| 份数 | 一场景一角色一套 | 全场景共享一份 |

一句话：**RTM 是这个 demo 要教的东西，RTC 只是为了把 RTM 的效果演示出来所必需的配套。**

客户的项目里通常已有 RTC 接法，不需要复制这份；RTM 则按业务角色复制。页面级会话统一管理 client 与 login/logout，两个角色的 `rtm.ts` / `onRtmEvent.ts` 刻意不抽共享基类。

同一条原则的两个推论：

- **页面级会话是唯一 SDK 所有者。** 它在 login 前注册事件，角色模块只依赖操作端口与事件分发 seam。
- **业务 store 不直接 import RTM SDK。** 它只调用 Host 或 Audience `rtm.ts` 的语义接口。
- **Storage 完全事件驱动。** Host 在空 `SNAPSHOT` 上初始化四个 key，Audience 不写 Storage，所有端都不主动读 metadata 或使用 Lock。

所有进入房间的成员都会加入 RTC 频道以收听远端音频；只有**实际在麦位上的用户**才创建并发布本地麦克风轨道。RTC 接法没有角色差异，所以 `rtc.ts` 不需要按角色拆份。
时间线**只呈现 RTM**，不采集 RTC —— 混入 RTC 节点会稀释「RTM 的数据流」这条主线。

---

## 目录导览

```
index.html                 唯一入口，不包含真实 App ID

src/app/                   实验室外壳：路由、两级 tab、env 解析、身份推导、样式
src/scenes/registry.ts     8 个一级分类 + 23 个二级场景的注册表
src/scenes/voice-room/     唯一已实现的场景；单 Tab 单角色
  README.md                语聊房 RTM 最佳实践与源码阅读入口
  docs/                    语聊房对外文档、函数映射与进一步说明
src/shared/rtc.ts          全场景共享的 RTC 辅助模块
src/shared/timeline/       trace store、多实例归并、过滤
src/test/setup.ts          vitest 全局 setup
src/vite-env.d.ts          Vite 客户端类型（import.meta.env、?raw 后缀）

e2e/lab.spec.ts            端到端测试
tests/                     仓库形态与启动脚本的断言
```

`src/scenes/voice-room/` 内部：

```
host/rtm.ts                    房主端原子 RTM 操作
host/onRtmEvent.ts             房主端事件绑定与协议校验
audience/rtm.ts                听众端原子 RTM 操作
audience/onRtmEvent.ts         听众端事件绑定与协议校验
app-rtm.ts                与单页面应用生命周期对齐的唯一 client、login/logout 与事件分发
browser-room-directory.ts      Local Storage 房间目录
voice-room-url.ts              唯一 data 参数 codec
room-entry-controller.ts       Host/Audience 归一化入房
event-driven-single-room-client.ts 单角色业务桥接与事件 store
config.ts                      麦位数与初始公告
VoiceRoomScene.tsx 场景容器
```

## 语聊房源码导航

以下文件组成语聊房的 RTM 运行路径：

先阅读[语聊房场景 README](src/scenes/voice-room/README.md)，了解 Storage、Presence 和 Message 在场景中的分工，以及生产环境必须由 App Server 替换的 Local Storage、nickname、token 和权限实现。单独复制一个 `rtm.ts` 不包含完整的收信和业务状态实现。

| 文件 | 说明 |
| --- | --- |
| `src/scenes/voice-room/host/rtm.ts` | Host 订阅、Storage 单写、消息信封和 trace |
| `src/scenes/voice-room/host/onRtmEvent.ts` | Host SDK 事件过滤、信封校验、去重和 listener 调用 |
| `src/scenes/voice-room/audience/rtm.ts` | Audience 订阅、消息信封、Presence 和 trace |
| `src/scenes/voice-room/audience/onRtmEvent.ts` | Audience SDK 事件过滤、信封校验、去重和 listener 调用 |
| `src/scenes/voice-room/app-rtm.ts` | 与语聊房单页面应用生命周期对齐的唯一 SDK client、login/logout 与事件分发 |
| `src/scenes/voice-room/event-driven-single-room-client.ts` | 当前单角色的语聊房业务协议与 Demo 房间 store |
| `src/scenes/voice-room/voice-room-url.ts` | Demo 邀请 URL 与 `data=...` 短邀请内容的 codec；生产环境应替换为服务端房间/邀请凭证 |

旧 Lock、同页双客户端 orchestrator 和兼容入口已经删除；当前目录只保留正式运行路径。

`src/app/` 是实验室外壳，`src/shared/` 是时间线与 RTC 脚手架，不属于语聊房的 RTM 场景协议。

---

## Agora RTM SDK 来源

`agora-rtm@2.3.0` 已正式发布到 npm，项目通过 `"agora-rtm": "^2.3.0"` 安装。
运行 `npm install` 会从当前 npm registry 下载 SDK，并由 `package-lock.json` 锁定实际版本
与完整性校验值。

本机若仍保留发布前的 `vendor/` 历史副本，该目录会被 `.gitignore` 忽略，不随开源仓库分发。

## 许可证

本仓库自身的 demo 代码与文档采用 MIT，见 [`LICENSE`](LICENSE)。
通过 npm 安装的 `agora-rtm` 与 `agora-rtc-sdk-ng` 各自遵循其自身许可证，不属于本仓库 MIT 许可证覆盖范围。
