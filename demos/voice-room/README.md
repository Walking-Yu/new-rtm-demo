# Agora RTM + RTC 语聊房实践 Demo

这是一个可独立复制的语聊房 SPA。它使用：

- 本地 `agora-rtm@2.3.0-beta.0`：Message Channel、User Channel、Presence、Storage 和 Lock。
- `agora-rtc-sdk-ng@latest`：真实麦克风发布、远端音频订阅与播放。
- React、TypeScript、Vite、Vitest 和 Playwright。

页面在一个浏览器标签页中运行房主和听众两个真实客户端。请先佩戴耳机，两个 RTC 客户端会自动播放彼此的远端音频，扬声器外放可能产生啸叫。

## 独立运行

要求 Node.js 20 或更高版本。

```bash
./start-demo.sh
```

脚本会在缺少依赖时执行 `npm install`，随后打开 `http://127.0.0.1:8080/`。

只启动、不打开浏览器：

```bash
./start-demo.sh --no-open
```

检查环境与 SDK 版本：

```bash
./start-demo.sh --check
```

自定义监听地址或端口：

```bash
RTM_DEMO_HOST=0.0.0.0 RTM_DEMO_PORT=9090 ./start-demo.sh --no-open
```

也可以使用 npm：

```bash
npm install
npm run dev
```

## 复制给客户

源码仍独立位于 `demos/voice-room/`，不引用仓库根目录的 `src/`。当前 RTM beta 依赖指向 `/Users/zhouxueqin/Downloads/agora-rtm-2.3.0-beta.0`；复制到其他机器前，需要同时提供该 beta 包并修改 `package.json` 中的 `file:` 路径，或替换为已发布的 npm 版本。

## 准备凭证

连接页需要填写：

- 一个 App ID 和一个房间 ID。
- 房主的显示名和字符串 User ID。
- 听众的显示名和字符串 User ID。
- 可选的房主、听众 RTM Token 和 RTC Token。

每个端点在 RTM 和 RTC 中必须使用相同的房间 ID 和相同的字符串 User ID，房主与听众 User ID 必须不同。若 Agora 项目没有启用 Token 鉴权，四个 Token 输入框全部留空即可；空值会被规范化为 `undefined` 传入 RTM/RTC 运行时，RTC 适配器仅在调用 `client.join` 时转换为 SDK 要求的 `null`。若项目启用了 Token 鉴权，四个 Token 必须分别与对应产品、频道和 User ID 匹配。

Token 应由可信业务服务端签发。本项目不接收 App Certificate，不包含 Token 生成器，也没有预置凭证。表单值只写入当前标签页的 `sessionStorage`，不会写入 `localStorage`。

## RTM 2.3.0 beta 接入约定

- 在 `login` 前注册事件，只使用 `linkState` 处理基础链路状态；官网当前 API 页面已将旧 `status` 标为废弃。
- 使用 `token` 事件，并且只把 `WILL_EXPIRE` 识别为 Token 即将过期；不再同时监听旧事件，避免重复通知。
- Message Channel 同时订阅 Message、Presence、Storage 和 Lock。Presence 查询会沿 `nextPage` 拉取全部在线用户，不请求未使用的临时状态。
- Lock 必须先存在才能获取。适配器首次遇到 `LOCK_NOT_EXIST` 时创建 Lock，并兼容另一客户端抢先创建产生的 `LOCK_ALREADY_EXIST` 竞态，然后重新获取。
- 断网恢复后重新订阅并主动读取 Presence 与 Storage 快照，保证恢复后使用最终房间状态对账。

核对来源：[声网 RTM JavaScript 初始配置 API](https://doc-internal.shengwang.cn/doc-new/rtmjs/api-ref/rtm2/javascript/toc-configuration/configuration)、[Lock API](https://doc-internal.shengwang.cn/doc-new/rtmjs/api-ref/rtm2/javascript/toc-lock/lock)，以及本地 beta 包内的类型定义。

## 演示流程

1. 保存连接设置，进入 `/room/:roomId`。
2. 进入房间页后，房主和听众自动依次登录 RTM、订阅 Message Channel、恢复 Presence/Storage，再加入 RTC；只有自动连接失败时才显示“重新连接”。
3. 房主发布麦克风；听众以纯收听状态加入。两端自动订阅并播放远端音频。
4. 听众选择空麦位并申请，随后可取消；房主可同意或拒绝。
5. 同意后麦位先进入 `joining`。听众成功发布 RTC 麦克风后，Storage 中的麦位才变为 `active`；发布失败会回滚为空位。
6. 房主也可选择空麦位并邀请听众，听众接受或拒绝。
7. 在麦听众可静音、解除静音或主动下麦；房主可请求静音、强制下麦、踢出或封禁。
8. 两端可发送公屏消息、表情和礼物；房主可更新 Storage 中的房间公告。
9. 断网恢复后，客户端重新订阅并拉取 Presence/Storage，按最终快照对账麦克风状态。

每个端点底部的操作时间线分别展示连接、发送、接收、执行 ACK、状态和错误，方便客户对照源码。

## 生产边界

- Demo 中的踢出、封禁和强制麦控是客户端协作执行，不是可信权限系统。生产环境必须由业务后端认证房主、校验命令并维护权威封禁状态。
- RTM Storage 保存低频房间快照，不替代长期业务数据库。
- 公屏消息是当前会话事件，不包含离线历史、漫游、未读或推送，不等同于完整 IM。
- SDK 返回发送成功只表示平台接受。关键治理命令仍使用 `messageId`、EXECUTED ACK、超时和幂等去重。

## 目录

```text
src/domain/          纯领域状态、转移和消息协议
src/runtime/ports/   SDK 无关端口
src/runtime/agora/   Agora RTM/RTC 适配器
src/runtime/         单端语聊房运行时
src/components/      可复用语聊房界面组件
src/app/             设置页、双端房间页和路由
e2e/                 无头端到端测试
```

## 验证

```bash
npm test
npm run build
npm run test:e2e
```

Playwright 默认使用无头浏览器。房间页会按产品行为启动自动连接，但测试只使用无效占位 App ID，不验证真实 Agora 网络连接成功；完整真实链路仍需使用有效项目凭证人工验收。
