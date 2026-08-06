/**
 * 已规划场景的统一占位页。
 *
 * 一个组件服务全部 22 个已规划场景，**不给每个场景单独写文案** —— 只有标题与摘要
 * 来自注册表，其余引导文案共用。tab 可见可点、进来是路线图而不是灰置的死路，
 * 这是「让客户看见 RTM 能覆盖多少场景」的展示目的（见 spec「场景注册表」）。
 */

import { Link } from 'react-router-dom';

import { capabilitiesOf } from '../scenes/capabilities';
import type { SceneEntry } from '../scenes/registry';

interface ScenePlaceholderProps {
  scene: SceneEntry;
}

export function ScenePlaceholder({ scene }: ScenePlaceholderProps) {
  const capabilities = capabilitiesOf(scene.id);

  return (
    <div className="lab-placeholder" data-testid="scene-placeholder">
      <p className="lab-placeholder__badge">路线图</p>
      <h1 className="lab-placeholder__title">{scene.title}</h1>
      <p className="lab-placeholder__summary">{scene.summary}</p>
      {/*
        「计划演示哪些 RTM 能力」是票 15 与 spec 的明确要求。能力标签不进注册表
        （四字段护栏），单独住在 `scenes/capabilities.ts`。
      */}
      <div className="lab-placeholder__capabilities">
        <span className="lab-placeholder__capabilities-label">计划演示的 RTM 能力</span>
        <ul className="lab-placeholder__capability-list">
          {capabilities.map((capability) => (
            <li key={capability} className="lab-placeholder__capability">
              {capability}
            </li>
          ))}
        </ul>
      </div>
      <p className="lab-placeholder__note">
        这个场景尚未构建。实验室先把它列出来，是为了说明 RTM 能覆盖到这里。
      </p>
      <p className="lab-placeholder__cta">
        想先看真实链路，请前往 <Link to="/social/voice-room">语聊房：麦位与房内互动</Link>
        —— 目前唯一已实现的场景，两个真实客户端跑在同一个标签页里。
      </p>
    </div>
  );
}
