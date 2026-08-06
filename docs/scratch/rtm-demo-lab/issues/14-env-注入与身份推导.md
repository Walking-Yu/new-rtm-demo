# 14 — env 注入与身份推导

**Blocked by:** 12

**Status:** resolved

**历史备注（已过时，保留作轨迹）：** 上一个 session 停在 TDD 的 RED —— `src/app/env.test.ts` 已写好但 `src/app/env.ts` 未创建。本次接手时确认 RED 后按原测试实现，未重写该文件的断言。

**What to build:** 上层网站能在加载 bundle 前注入 appId 并生效；本地开发不注入时自动用本地配置兜底；两者都缺时用户看到一个引导页而不是报错页。进场景不需要填任何表单——房间 ID 与 uid 自动生成，也能用 URL 参数指定以便两人对连同一个房间做真实联调。

纯逻辑、无 UI，完全 TDD。

- [x] 线上注入的 appId 能覆盖构建期烧进 bundle 的本地配置（反了的话上层网站永远换不掉 appId）
- [x] 只有本地配置时用它
- [x] 两者都缺时返回可被 UI 识别的未配置状态，不抛异常
- [x] 启动时读一次快照即固定，不监听后续变化、不轮询、不代理劫持全局对象
- [x] 源码里没有第三层硬编码兜底（体验用 appId 只进本地配置文件与开发用内联脚本）
- [x] 房间 ID 与两端 uid 自动生成，uid 带角色前缀（时间线的 uid badge 依赖前缀做可读区分）
- [x] 同一标签页内两端 uid 必须不同，靠前缀加各自独立随机段保证，不做冲突检测
- [x] URL 参数可覆盖房间 ID 与本端 uid
- [x] 覆盖值不写入任何 storage——要真断言这条，实现时容易手滑加回去

## Answer

四个文件，两个模块，纯逻辑无 UI，20 个测试。

| 文件 | 职责 |
| --- | --- |
| `src/app/env.ts` | `resolveEnv(inputs)` —— 纯函数，输入显式传入，不读全局、不带状态 |
| `src/app/envSnapshot.ts` | `readEnvSnapshot()` —— 读一次全局快照并记忆化 |
| `src/app/identity.ts` | `deriveIdentity({ sceneId, roles, search?, randomSegment? })` |
| 三份同名 `*.test.ts` | 与源文件同目录同名 |

### env：优先级与未配置状态

`ResolvedEnv` 是判别式联合，`configured: false` 分支**运行时不设置 `appId` 键**（测试直接断言 `not.toHaveProperty('appId')`），类型上标注 `appId?: undefined` 只为让调用方不必在每个读取点加断言。`source` 字段（`'window.__ENV__' | 'import.meta.env'`）供引导页做自诊断提示。

空字符串与纯空白都不算有效 appId：`window.__ENV__ = { appId: '' }` 会**回落**到 `import.meta.env`，而不是判定为已配置。

### 纯函数与副作用分文件（review 结论）

`resolveEnv` 与 `readEnvSnapshot` 起初写在同一个文件里，导致要断言模块级记忆化必须另开一个 `env.snapshot.test.ts` 来绕开 vitest 的模块隔离 —— 文件名和源文件对不上。code review 判定为 Divergent Change，已拆成两个模块，两份测试各自落回同名源文件。

`readEnvSnapshot` 里原本有 `typeof window === 'undefined'` 的 SSR 守卫，一并删掉：这个 SPA 只跑浏览器，spec 没有任何 SSR 要求，属未被要求的预留。

### 身份推导：`?uid.<role>=`（**对 spec 的扩展**）

spec 第 153 行写的是 `?uid=` 覆盖「本端 uid」，但第 155 行同时明确一个标签页内跑多端 —— 多端下「本端」没有唯一指代。因此扩展成按角色键化：

```
?room=demo-42                          覆盖房间号
?uid.host=alice&uid.audience=bob       按角色分别覆盖
?uid=alice                             主角色（roles 第一项）的简写，兼容 spec 原例
```

`?uid=` 的原有语义保留并有测试盯住，是加法不是改法。**这是本票对 spec 的扩展，spec 未记载**；若后续有场景不接受这个形态，回头改 spec。

### 前缀不变式与裸前缀边界

覆盖值缺少角色前缀时补齐（`?uid.host=alice` → `host-alice`），已带前缀的不重复补（幂等）。补齐是为了让「不做冲突检测」这个决策成立 —— 前缀不同即保证跨角色 uid 天然不撞。

code review 发现的实际缺陷：`?uid.host=host-` 会得到裸前缀 `host-`，它满足前缀不变式却零区分度，两端各写一次就撞成同一个 uid。已修为**剥掉前缀后主体为空则视为无效覆盖**，回落到自动生成，并补测试覆盖 `host-`、`-`、`--` 三种输入。

### 随机段的消耗规则

只有真正需要生成的槽位才调用 `randomSegment()` —— 被 URL 覆盖的房间号或 uid 不消耗。这条规则是 TDD 过程中一个失败测试逼出来的：起初房间号无论是否被覆盖都先抽一段，导致 `?room=` 一出现，后面各端 uid 抽到的随机段整体前移。

### 不落 storage

`identity.test.ts` 有独立一个 `describe` 正面断言 `sessionStorage.length === 0` 且 `localStorage.length === 0`。两个模块的源码里都没有任何 storage 调用。

### 删掉的东西

`RoomIdSource`（`'url' | 'generated'`）—— 本票 9 条验收项没有一条要求区分房间号来源，注释自承用途在「UI 提示联调链接」，那是票 15 之后的事。code review 判定为 Speculative Generality，连同它的断言一起删除。票 15 若真需要，届时再加。

### 遗留问题（不属本票）

`src/legacy/runtime/rtm/AgoraRtmAdapter.ts:121` 监听 RTM 2.3 已废弃的 `status` 事件，`tsc -b` 因此有两条报错（`TS2345` + `TS7006`）。核对过该文件 diff 是票 12 搬迁产生的 157 行纯新增，本票一行未改 —— 在本票开工前就是红的。测试全绿（58 passed），只有类型检查受影响。需要单独一张票或并进票 15。
