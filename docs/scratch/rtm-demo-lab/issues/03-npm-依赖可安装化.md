# npm 依赖可安装化

Type: task
Status: resolved
Blocked by: —

## Question

当前 `agora-rtm` 通过本机路径 `file:/Users/zhouxueqin/Downloads/agora-rtm-2.3.0-beta.0` 解析，任何人 clone 之后 `npm install` 直接失败。开源前必须让任意机器可安装。

需要做的事：

- 确认 `agora-rtm@2.3.0-beta.0` 是否已在 npm 上发布（或有可用的 beta tag / 私有源）。
- 若未发布：确定过渡方案——把包 vendor 进仓库某个目录并用相对 `file:` 引用，还是等发布、期间在 README 写明手工放置步骤。
- 顺带修掉 `tests/startDemoScript.test.ts` 硬断言 `agora-rtc-sdk-ng@4.24.6` 而 `package.json` 写 `latest` 的矛盾：要么锁版本，要么放宽断言。

已知前提：用户表示"目前先指向本地，后续会发布到 npm"。所以本票的产出是一个**在发布之前也能让外部机器跑通**的过渡方案，以及发布后切换的步骤。

## Answer

**方案：把 beta 包 vendor 进仓库，用相对 `file:` 路径引用。**

### 决定性事实（已核验）

- `agora-rtm@2.3.0-beta.0` **不在 npm registry**。`npm view agora-rtm versions` 最高只到 `2.2.4`；dist-tags 为 `latest=2.2.4`、`special=2.2.3-3`。2.3.0 系列一个版本都没发布，所以「等发布」不是短期可行路径。
- 本地包内容干净、体积可接受：4 个文件 —— `agora-rtm.js`（1.4 MB）、`agora-rtm.d.ts`（92 KB）、`package.json`（615 B）、`README.md`（7.6 KB）。
- 该包 **零 runtime dependencies**，只有一条 `peerDependencies: agora-rtc-sdk-ng@^4.24.3`。`main`/`browser` 均指向 `agora-rtm.js`，`types` 指向 `agora-rtm.d.ts`。`license` 字段值为 `Apache`。
- 因此 vendor 进仓库不会牵进依赖树，也不需要构建步骤。

### 落地方式

1. 在仓库内新建 `vendor/agora-rtm-2.3.0-beta.0/`，原样放入上述 4 个文件。
2. `package.json` 的依赖改为相对路径 `file:./vendor/agora-rtm-2.3.0-beta.0`（**不能是绝对路径**）。
3. 删除现有 `package-lock.json` 中残留的 `../../../Downloads/...` 绝对路径条目，重新 `npm install` 生成 lock。
4. 在 README 写明：这是尚未发布的 beta 包，已随仓库提供；待 2.3.0 正式发布后改为 `"agora-rtm": "^2.3.0"` 并删除 `vendor/`。

### 需要一并处理的两处矛盾

- `tests/startDemoScript.test.ts:19-20` 硬断言 `agora-rtm@2.3.0-beta.0` 与 `agora-rtc-sdk-ng@4.24.6`，而 `package.json` 里 rtc 写的是 `latest`（lock 锁在 4.24.6）。`latest` 一旦漂移测试即红。**结论：把 `agora-rtc-sdk-ng` 锁到确定版本**（`4.24.6`，满足 beta 包的 peer 要求 `^4.24.3`），断言保留。顺带把其余 `latest` 依赖也锁版本 —— 开源项目不应让 `npm install` 的结果随时间漂移。
- `start-demo.sh` 用 `require('./node_modules/agora-rtm/package.json').version` 读版本，vendor 后仍成立（`file:` 依赖在 `node_modules` 下建符号链接），无需改动。

### 遗留的位置张力（交给 `10` / `11`）

`demos/voice-room/` 现有「能整目录拷出仓库交付」的产品要求（见 `CLAUDE.md`）。vendor 目录若放在仓库根，voice-room 单独拷走后相对路径断裂；放进 demo 目录内则不断，但新架构下 23 个场景共处一个应用，vendor 归属需要重新表述。**本票只定「vendor 进仓库 + 相对路径」，具体目录位置取决于新骨架的目录形态**，留给 `10`（语聊房迁移切分）与 `11`（开源合规与交付清单）。

### 合规待确认（非工程问题）

该包 `license` 字段为 `Apache`，但它是尚未公开发布的 beta 版本。对外开源分发一个未发布的 SDK 包是否合规，需要用户在声网内部确认 —— 本票不代为判断。若不合规，退化方案是依赖 `agora-rtm@2.2.4`（已发布），但需先核对本项目用到的 API 在 2.2.4 上是否齐备。
