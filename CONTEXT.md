# RTM 场景实验室

本上下文描述语聊房 Demo 中跨 UI、Local Storage、RTM 消息和房间会话共享的领域术语。

## 语聊房生命周期

**活跃房间（active room）**：
仍允许 Audience 加入、成员继续互动和 Host 恢复的房间。Host 当前不在线不改变其活跃状态。
_避免使用_：在线房间、已连接房间

**已解散房间（inactive room）**：
Host 明确终止、所有已加入成员都应退订且不再允许恢复或加入的房间。
_避免使用_：临时离线房间、空房间

**暂时离开（temporary leave）**：
Host 离开当前 RTC/RTM 房间会话但保留房间为 active；成员继续留在房内互动，Host 麦位显示暂时离开，之后可通过 Host URL 恢复。
_避免使用_：解散、结束房间

**解散房间（dissolve room）**：
Host 把房间置为 inactive 并通知当前成员退出房间会话的终止动作。
_避免使用_：退出、暂时离开
