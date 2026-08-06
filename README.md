# RTM 2.x 语聊房实践 Demo

默认入口现在只展示独立语聊房 SPA，使用本地 `agora-rtm@2.3.0-beta.0` 和 `agora-rtc-sdk-ng@4.24.6` 运行房主、听众两个真实客户端。其他场景源码仍保留在根目录 `src/`，但不会出现在默认导航和路由中。

## 本地运行

环境要求：Node.js 20 或更高版本。

一键安装独立目录的缺失依赖、启动 Demo 并打开浏览器：

```bash
./start-demo.sh
```

默认地址是 `http://127.0.0.1:8080/`。

只启动服务、不自动打开浏览器：

```bash
./start-demo.sh --no-open
```

可以通过 `RTM_DEMO_HOST` 和 `RTM_DEMO_PORT` 自定义监听地址和端口，例如：

```bash
RTM_DEMO_PORT=9090 ./start-demo.sh --no-open
```

也可以使用 npm 委托命令：

```bash
npm run dev
```

浏览器打开终端输出的本地地址即可进入语聊房。RTM/RTC Token 均为可选项；Agora 项目启用 Token 鉴权时，再分别填写房主和听众对应的 Token。两个 RTC 客户端会自动播放远端音频，必须佩戴耳机。

常用命令：

```bash
npm test
npm run build
npm run test:e2e
```

E2E 测试默认以无头浏览器运行，覆盖设置页、桌面双端工作台和移动端标签。

## 独立复制

语聊房源码、测试和启动脚本都位于 [`demos/voice-room/`](demos/voice-room/)，不引用根目录旧场景代码。当前 RTM beta 通过本地 `file:` 路径加载；复制到其他机器时还需要提供 beta 包并修改路径，或替换为已发布版本。

完整凭证准备、语聊房流程、生产治理边界和源码结构见 [`demos/voice-room/README.md`](demos/voice-room/README.md)。

## 保留的旧场景实验室

原 24 场景实验室没有删除，可通过以下命令继续做维护验证：

```bash
npm run dev:legacy
npm run test:legacy
npm run build:legacy
```
