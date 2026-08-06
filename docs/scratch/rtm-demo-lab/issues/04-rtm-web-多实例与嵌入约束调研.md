# RTM Web 多实例与嵌入约束调研

Type: research
Status: resolved
Blocked by: —

## Question

单个浏览器页面内并存多个 RTM client 实例，官方是否支持、有无实例数上限、事件监听器是否互相隔离？以及本实验室作为一个页面被挂进上层网站（可能是 iframe）时，RTM/RTC 有哪些已知约束（跨域、storage 分区、WebSocket 连接数、域名白名单）？

这条会反向决定 `08`（各场景客户端数量上限）和多用户场景的整体设计：语聊房现在跑 2 个客户端，会议室和互动课堂天然要更多。如果存在硬上限，多端场景必须改成"1 个真实端 + 其余模拟"。

要求：以官方文档为主要来源，给出 URL 与原文引用；查不到的结论明确标注"官方文档未说明"，不要用听起来合理的数字填空。

## Answer

本票以「用户直接确认 + 调研引用」结案，不再等待 research 子代理。用户对声网 SDK 实际行为的确认优先于文档推断；文档与之冲突处如实标注。

### 1. 多 RTM client 实例：可行（用户确认），但文档未保证

- **结论**：一个页面内可并存多个 RTM client 实例，只要 uid 不同。**由用户直接确认**。
- **官方文档表述相反**：migration guide 写明 RTM 2.x 事件回调**绑定到 client 实例、全局生效** —— 「全局」的范围是该实例下所有 channel 与 topic，**跨实例行为无任何说明**。所有 API 示例均为实例作用域（`rtm.addEventListener(...)`）。
  来源：<https://docs.agora.io/en/realtime-media/rtm/reference/migration-guide/web>
- **实例数上限**：官方文档未说明具体数字。
- **事件监听器是否跨实例隔离**：官方文档未说明。按「绑定到 client 实例」的表述推断应当隔离，但这是推断，不是文档保证。

**因此本项目的定位是「实测可行、文档未保证」**。多实例是本实验室的核心做法（见 `05`：一场景一角色一份 `rtm-<role>.ts`），开源交付时 README **必须声明这一状态**，否则客户照抄进生产、日后 SDK 行为变化时会误判归因。此项交由 `11`（开源合规与交付清单）落实。

### 2. RTC 的姿态与 RTM 相反：一页多 client 是隐性支持

- 文档明确指导 `createClient` **两次**（`uplinkClient` / `downlinkClient`）做通话前上下行测速。
  来源：<https://docs.agora.io/en/realtime-media/video/build/manage-connection-and-quality/pre-call-tests/web>
- v4.6.0 fixed-issues 有一条：「Using multiple clients on one web page caused unexpected issues.」—— 说明多 client 是被承认并修复过的用法。
  来源：<https://docs.agora.io/en/realtime-media/video/reference/release-notes/web>
- 实例数上限：官方文档未说明。

**注意不要把 RTC 的宽容度推广到 RTM** —— 两者文档姿态不同。不过本项目 RTC 用量很小：只有「实际开音视频的那个用户」创建 RTC 实例（见 `07`），所以多 RTC 实例基本不会出现。

### 3. 嵌入约束：同源部署，不走跨域 iframe

**用户确认**：路由挂载在同一站点下，与文档站同源部署，目标站点为 `doc.shengwang.cn`（国内）与 `docs.agora.io`（国际）。

由此确定：

- **`window.__ENV__` 注入成立** —— 同源，子页面能读到父页面写入的全局变量。`06` 的前提由此定死。
- **麦克风/摄像头权限无 iframe 障碍** —— 不走跨域 iframe，无需父页面 `allow="microphone; camera"`，`getUserMedia` 直接可用。
- **storage 分区、跨域 iframe 的 localStorage/IndexedDB 限制均不适用** —— 这些问题只在跨域 iframe 场景出现。
- **每主机 WebSocket 连接数上限**：官方文档未说明；浏览器层面的限制（Chrome/Firefox 的 per-host 上限）未经本票核实。多实例场景下每个 RTM client 各持连接，若未来出现连接数问题，需回到此处补充核实。

### ⚠️ 关键发现：目标站点是两个不同域，不是一个

`doc.shengwang.cn` 与 `docs.agora.io` 是**两个独立域**（国内站 / 国际站）。同源要求协议、域名、端口三者全同，因此「与两者同源」在浏览器语义上不可能同时成立。实际含义是：**本实验室需部署两份**，各自挂在对应站点下，两份之间互不同源。

三处必然影响：

1. `window.__ENV__` 在两边各自成立，注入机制不受影响。
2. **appId 大概率要分两套** —— 国内站与国际站是不同的声网项目、接入不同区域的 RTM 网关。`06` 必须处理「同一份代码、两套 env」，不是一套。
3. **RTM/RTC 的域名白名单/防火墙要求两站不同**，README 需分开写。此条为「两站分立」推出的必然结果，**具体域名清单未核实**，写入文档前必须核对官方防火墙白名单页面。

### 未解决 / 留待后续核实

- RTM client 实例数的具体上限（官方文档未说明）。
- 事件监听器跨实例隔离的官方确认（当前为推断）。
- 浏览器 per-host WebSocket 连接数上限，及多实例下是否触及。
- 国内站与国际站各自的域名白名单清单（写 README 前必须核实，交 `11`）。

## Comments

- 第一次 research 子代理因 API 连接中断提前终止，停在"验证多实例之间事件监听器是否隔离"这一步，未留下可用结论。需要重跑。
