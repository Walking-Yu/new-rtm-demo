# 18 — 房主端可拷走的 RTM 文件

**Blocked by:** 16, 17

**Status:** resolved

**What to build:** **整套设计的核心产物。** 一个客户可以单文件拷进自己项目直接用的房主端 RTM 文件，导出房主的全部业务动作，每个方法内部写明「这个业务动作要按什么顺序调哪些 RTM API」。做完这一个文件，「第二个场景一天产出」的验收锚点才有实体可复制。

**零依赖是硬约束**：只允许 import SDK 本身与纯类型。不允许 import 共享目录下任何模块，不允许 import 同目录的转移函数（它以参数注入）。

先建假 SDK client 保住 operations 轨迹范式：注入点从 port 下移到 SDK 工厂，构造参数增加一个可选的 client 工厂，默认值是真实的 SDK 创建函数。测试传入记录调用轨迹的假实现。这是唯一为可测性开的口子，不算违反零依赖。**不要改成直接 mock Agora SDK。**

按下列分组逐轮 TDD，每组先写失败测试再实现：

- [x] **连接与分阶段回滚**：注册事件必须在登录之前；订阅失败时逆序清理并登出；清理过程中再抛异常时暴露的仍是**最初**的失败原因——最后这条最容易在实现时写丢
- [x] **Lock 与乐观并发**：完整轨迹是获取锁、重新读快照、reduce、带修订号写入、释放锁；转移函数抛异常时释放锁仍然发生；锁不存在时先创建再重新获取；容忍对端抢先创建导致的「锁已存在」竞态——后两条是实测踩出来的路径，必须有测试锁住，否则日后重构一定会丢
- [x] **消息封装与去重**：发出的消息是合法信封（带版本号、消息 ID、过期时间）；房间不匹配、目标不是自己、已过期的消息一律丢弃；同一消息 ID 收两次时第二次不触发业务处理
- [x] **治理命令的 ack**：踢出、封禁、强制静音、强制下麦发出时标记需要 ack 并登记超时定时器；收到对端 ack 后定时器被清掉；超时未收到则触发错误回调
- [x] **语义方法逐个**：按 spec 的清单每个方法一条测试，断言调用轨迹。注意强制静音与强制下麦是**对他人、需 ack**，与听众侧对自己的操作语义不同——原先靠可选参数是否为空区分的隐式分支要消掉
- [x] **trace 采集**：每次 API 调用产生一条带耗时的调用节点；每次收到事件产生一条事件节点；API 失败时带错误码与错误信息；每条都带自己的 uid 与角色
- [x] **重连靠重新读取**：连接状态从重连中回到已连接时，重新订阅、重新拉在线状态、重新拉 Storage，不重放任何历史消息。在线状态查询要翻页取全部用户
- [x] 全绿后检查零依赖：只能出现纯类型 import，任何运行时的相对 import 都必须改掉

Storage 的 metadata key 与锁名固定，**禁止在 mutate 之外改快照**。每个语义方法内部是 mutate 加必要的消息发布，**不要直接 import 转移函数**——它经参数注入。

## Answer

`src/scenes/voice-room/rtm-host.ts`（1071 行）+ `rtm-host.test.ts`（1207 行，**74 个测试**）。

验证状态：`npx vitest run src/scenes/voice-room/rtm-host.test.ts` → 74 passed；`npm test` → 233 passed（基线 159 + 新增 74）；`npm run build`（含 `tsc -b`）→ 绿。

### 零依赖怎么被守住的

三条运行时 import 全部是 `import type`，唯一的运行时 import 是 `agora-rtm`：

```
import AgoraRTM from 'agora-rtm';                                    ← 唯一运行时
import type { RTMConfig, RTMEvents } from 'agora-rtm';
import type { SeatInvitation, VoiceRoomSnapshot } from './state';    ← 纯类型
import type { VoiceRoomStateAdapter } from './stateAdapter';         ← 纯类型
```

**这条不靠人工检查守，靠三个测试守**：正则扫源码里 `^import`（排除 `import type`）后的相对路径必须为空数组、运行时 import 列表必须恰好是 `['agora-rtm']`、不得出现 `'./transitions'` 的运行时 import。日后重构手滑加了 import 会立刻红。

源码读取用 Vite 的 `?raw` 而不是 `node:fs` —— 见下面「踩到的坑」第 4 条。

### SDK 边界的类型不用 `InstanceType<typeof AgoraRTM.RTM>`

改为手写 `RtmClientLike` 接口，只声明本文件真正调用的 12 个方法。理由：前者会把整个 SDK 类形状拖进签名，测试的假实现就得实现几十个用不到的方法。

`createClient?: RtmClientFactory` 默认值是 `new AgoraRTM.RTM(...)`，客户拷走后不需要关心这个参数。

### 强制静音/下麦的隐式分支已消掉

遗留 `VoiceRoomClient` 靠 `targetUserId && targetUserId !== settings.userId` 判断「是对自己还是对他人」。现在房主端只有 `forceMuteSeat(userId, muted)` 与 `forceLeaveSeat(userId)` 两个方法，签名里 userId 必填、语义固定是「对他人 + 需 ack」；听众侧的「对自己 + 不需 ack」归票 19。分支消失在类型层面，不是靠运行时判断。

### 房主端多出的两个方法（spec 清单外）

`activateOwnSeat(seatId)` 与 `rollbackOwnSeat(seatId)`。

原因：**本文件完全不碰 RTC**，而麦位激活由媒体结果驱动。房主自己的 seat-0 初始是 `joining`，需要容器在 `publishMicrophone()` 成功后回调一次 RTM 写入才能转 `active`。遗留实现把这段 RTC 调用内联在 `connect()` 里（`VoiceRoomClient.ts` 154–161 行），新架构下 RTC 归共享模块，所以这个反向驱动点必须暴露成方法。这是唯一一处 RTC 结果反向驱动 RTM 写入的地方，票 22 的容器负责接线。

### `ensureRoomState()`：房主独有

Storage 里没有房间状态时由房主写入初始快照，同样走锁。听众端不该有这个方法 —— 听众读不到状态时应当等房主写，而不是自己造一个。票 19 复制时要**删掉**这一段。

### 踩到的四个坑（都是测试先红才发现的）

1. **假 SDK 的「第 N 次调用失败」注入按调用序号计数是错的。** `connect()` 里的 `ensureRoomState()` 已经先取过一次锁，所以业务方法里的第一次 `acquireLock` 其实是全局第二次。改成一次性布尔标志 `acquireLockFailNext`，抛完自动复位。
2. **trace 快照只复制元素挡不住改写。** `entries.map(e => ({...e}))` 挡得住 `push`，挡不住 `snapshot[0].name = 'x'`（改到的是拷贝，但那份拷贝被缓存并持续返回，对外可观察输出已经错了）。改用与 `traceStore.ts` 相同的双层 Proxy（数组一层 + 每个元素一层，`set`/`deleteProperty`/`defineProperty` 全返回 true 静默忽略）。
3. **测试辅助 `flush()` 不能用 `setTimeout`。** ack 那组测试开了 `vi.useFakeTimers()`，宏任务边界会让 `flush()` 直接挂死 5 秒后超时。改成只排微任务（`for 50 次 await Promise.resolve()`），假定时器与真定时器下都成立。
4. **零依赖检查一开始用 `node:fs` + `import.meta.url`，两处都错。** jsdom 环境下 `import.meta.url` 不是 `file:` URL（运行时报错）；改用 `process.cwd()` 后 `vitest` 绿了但 **`tsc -b` 红了** —— `tsconfig.app.json` 的 `types` 里没有 `node`。最终改用 Vite 的 `import('./rtm-host.ts?raw')`，类型来自已引用的 `vite/client`，两边都过。

第 4 条正是交接里那条教训的现场复现：**只跑 `npx vite build` 会漏掉 `tsc -b` 的错**，必须跑 `npm run build`。

### 交接提到的技术债：没有撞上，但仍然存在

`stateAdapter.parseStored` 只校验顶层字段（`seats` 只判是不是对象、元素形状不校验）。本票没撞上，因为 `mutate()` 的路径是 `parseStored(...) ?? this.snapshot` —— 畸形数据要么在 `parseStored` 被顶层校验拦掉，要么形状足以让 reducer 正常工作。

**但 `{"seats":{"seat-0":5}}` 这类「顶层合法、元素畸形」的数据仍会穿过 `parseStored` 并在 reducer 里抛。**在本文件里它的后果是可控的：reducer 抛异常时 `finally` 仍会释放锁（有测试锁住），错误正常上抛给调用方。**没有把它顺手修掉** —— 加深校验属于票 17 的产物范围，改动会牵动票 17 的测试；留给验收票 25 决定是否补一张票。
