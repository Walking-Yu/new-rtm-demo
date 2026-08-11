/**
 * 外壳与场景之间的上下文。
 *
 * ## 为什么需要它
 *
 * 场景容器要两样外壳持有的东西：解析好的 env（拿 appId）与「把 trace 来源交上去」
 * 的回调（时间线面板在外壳里，不在场景里）。而场景是通过注册表按 id 查出来渲染的，
 * 中间隔着路由，**没法用 props 一层层传**。
 *
 * ## 为什么把测试注入口也放这里
 *
 * 场景一挂载就自动连接（spec「身份推导」：零表单、点 tab 直接进房）。外壳的测试
 * 会渲染到真实场景，如果没有注入口，它们就会去连真实 RTM —— 单元测试里发真实网络
 * 请求既慢又不确定。所以上下文带一个 `voiceRoomOverrides`，测试塞假工厂进来。
 *
 * 生产代码从不设置它（`LabRoutes` 不暴露这个 prop），所以它不是「为测试留的后门
 * 参数」，而是外壳自己的依赖注入点。
 */

import { createContext, useContext } from 'react';
import type { ResolvedEnv } from './env';
import type { TraceSource } from '../shared/timeline/useMergedTraces';
import type { OrchestratorDeps } from '../scenes/voice-room/orchestrator';

/** 场景可注入的依赖。目前只有语聊房一个已实现场景。 */
export type VoiceRoomOverrides = Pick<OrchestratorDeps, 'createClients' | 'createRtc'>;

export interface SceneContextValue {
  env: ResolvedEnv;
  /**
   * 场景把两端的 trace 来源交给外壳。
   *
   * **实现方必须是稳定引用**（`useCallback`）—— 场景会把它放进 effect 依赖，
   * 每次渲染换新函数会让 effect 反复重跑。
   */
  publishTraceSources?: (sources: readonly TraceSource[]) => void;
  voiceRoomOverrides?: VoiceRoomOverrides;
}

/**
 * 默认值是「未配置 env」而不是 `undefined`。
 *
 * 这样场景在没有 Provider 的情况下渲染会走「未配置」分支，而不是读 `undefined.env`
 * 崩掉 —— 崩溃只会掩盖「忘了包 Provider」这个真实问题。
 */
const SceneContext = createContext<SceneContextValue>({ env: { configured: false } });

export const SceneContextProvider = SceneContext.Provider;

export function useSceneContext(): SceneContextValue {
  return useContext(SceneContext);
}
