# 共享 rtc.ts 接口边界

Type: grilling
Status: resolved
Blocked by: 02

## Question

共享的 `rtc.ts` 辅助模块暴露哪些能力、边界划在哪？

需要定：

- 接口清单：加入/离开频道、开关麦克风、开关摄像头、订阅并播放远端、音量指示。是否还要屏幕共享（会议/教育场景可能要，但会扩大 RTC 范围）。
- 摄像头相关的视频渲染怎么交给 UI（返回 track 让组件自己 play，还是传入容器 id）。
- 与 `rtm.ts` 零依赖决策的关系确认：`rtc.ts` 是共享单份、允许被 import，这一点与 `rtm.ts` 的规则不同，需要在文档里写清"为什么 RTM 一场景一份而 RTC 共享"。
- `rtc.ts` 要不要也采集 trace 进时间线，还是时间线只呈现 RTM。
- 错误处理与现有 `errorMap` 的关系。

已定前提：RTC 仅作辅助，只覆盖语音与视频；本 demo 主要展示 RTM 能力。

## Answer

### 一句话

`rtc.ts` 是**全场景共享的单份辅助模块**，只做「加入频道 / 开关麦 / 开关摄像头 / 订阅远端」四件事；**音频内部直接播，视频把 track 交给 UI 自己播**（B 方案）。

### 谁创建 RTC

只有**实际开音视频的那个用户**创建 RTC 实例（用户确认）。这与 RTM 不同：RTM 是一角色一实例（`rtm-<role>.ts`），RTC 只有开麦/开摄像头的那一个角色才有。多用户场景下只允许一人开麦开摄像头（地图 Notes 决策 6），所以同一时刻页面内通常只有 1 个 RTC client。

由此也确认：`rtc.ts` **不需要**按角色拆份，共享单份即可 —— 它不像 `rtm.ts` 那样承载「这个场景怎么用 RTM」的教学价值。

### 接口清单

```ts
export interface RtcHandlers {
  connection: (state: ConnectionState, reason?: string) => void;
  remoteAudio: (uid: string, published: boolean) => void;
  /** 视频不在内部播，把 track 抛出来交给 UI */
  remoteVideo: (uid: string, track: IRemoteVideoTrack | null) => void;
  volume: (levels: Record<string, number>) => void;
}

export interface RtcHelper {
  registerEvents(handlers: RtcHandlers): void;
  join(settings: { appId: string; roomId: string; userId: string }): Promise<void>;
  leave(): Promise<void>;

  publishMicrophone(): Promise<void>;
  unpublishMicrophone(): Promise<void>;
  setMicrophoneMuted(muted: boolean): Promise<void>;

  publishCamera(): Promise<void>;
  unpublishCamera(): Promise<void>;
  setCameraMuted(muted: boolean): Promise<void>;
  /** 本地预览同样交出 track，不在内部播 */
  getLocalVideoTrack(): ILocalVideoTrack | null;
}
```

`token` 字段**从签名中去掉** —— 地图 Notes 决策 5 定了默认无 token 鉴权。现有 `RtcJoinSettings.token?` 属于要删的历史包袱；日后换成支持 token 的 appId，再在此处加回一个参数。

**屏幕共享不做。** 会议 / 教育场景可能需要，但它会把 RTC 从「辅助」扩成一等能力，与「本 demo 主打 RTM」冲突。留到真正实现会议场景时另开 effort。

### 视频渲染边界：B 方案（交出 track）

`rtc.ts` 只负责 `client.subscribe(user, 'video')`，然后通过 `remoteVideo(uid, track)` 回调把 track 抛给业务层；React 组件在 `useEffect` 里对自己的 ref 调 `track.play(el)`，卸载时 `track.stop()`。

选 B 而非「传容器 id 进去」的理由：React 下容器挂载时机与 `play()` 调用时机的竞态用 A 很难做干净（容器未渲染就 play 会静默失败），而 23 个场景共用同一个播放组件，写一次即可复用。这也是声网官方 React 示例的写法。

**音视频处理方式故意不一致**：音频保持现有做法，`rtc.ts` 内部 `track.play()` 直接播。理由是音频没有渲染位置，交出 track 只会让业务层多做无意义的事。这个不一致要在 `rtc.ts` 顶部注释里写明理由，避免后人「统一」掉。

代价（已知）：远端 video track 的生命周期跨了模块边界 —— `rtc.ts` 负责 subscribe/unsubscribe，UI 负责 play/stop。约定为：**`rtc.ts` 在 `user-unpublished` / `leave()` 时以 `remoteVideo(uid, null)` 通知 UI 先停播，再做 unsubscribe**，UI 收到 `null` 即停止渲染。

### 为什么 RTM 一场景一角色一份、RTC 共享一份

需要写进文档（`11` 的交付清单要检查这段是否存在）：

- `rtm-<role>.ts` 的产品目标是**被客户拷走集成**，所以零依赖、场景语义方法、内含 trace。它是教材。
- `rtc.ts` 的目标只是**让 demo 能听见声音、看见画面**。客户的项目里已经有自己的 RTC 接法，不需要这份。它是脚手架。

一句话：RTM 是本 demo 要教的东西，RTC 是为了把 RTM 的效果演示出来所必需的配套。

### `rtc.ts` 不采集 trace

时间线**只呈现 RTM**。理由：时间线是用来讲「RTM API 与事件的数据流」的（`docs/inputs/index.md` 原话），混入 RTC 节点会稀释这条主线。

例外是一处**必须体现**的耦合：语聊房的麦位激活由媒体结果驱动（`joining` → RTC `publishMicrophone()` 成功 → `active`，失败则回滚）。这条链路里 RTC 的成败会触发后续 RTM 写入，时间线上会自然看到那次 RTM 调用，无需单独的 RTC 节点。若实测发现看不懂中间发生了什么，再考虑加一类 `kind: 'media'` 节点 —— 记入迷雾，不在本票定。

### 错误处理

保留现有 `errorMap` 的 `mapRtcError` / `rtcError`，但它属于**共享层**，`rtc.ts` 可以 import。这与 `rtm-<role>.ts` 的零依赖规则不同 —— 再次因为 `rtc.ts` 不需要被拷走。

现有 `AgoraRtcAdapter` 里两处 `throw new Error('麦克风尚未发布')` / `('RTC 尚未加入房间')` 是裸 Error，应统一走 `rtcError`，便于业务层区分「用法错误」与「SDK 错误」。

### 与现有代码的差距（供 `10` 估工）

现有 RTC 层是**纯音频**的：`RtcPort` 六个方法全是麦克风，`AgoraRtcAdapter` 的 `user-published` 里有 `if (mediaType !== 'audio') return`，直接丢弃视频。**摄像头相关的全部能力是新增，不是迁移。**

### 未决，留给后续

- `rtc.ts` 的具体存放路径 —— 等骨架目录形态（`10`）。
- 是否需要 `mode: 'rtc'` 之外的模式（直播场景可能要 `live` + 主播/观众角色）—— 等真正实现直播场景。现有代码硬编码 `{ mode: 'rtc', codec: 'vp8' }`。
