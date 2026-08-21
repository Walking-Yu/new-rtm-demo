/**
 * 单页应用入口。
 *
 * 环境快照在这里读一次（`readEnvSnapshot`），结果注入 `App` —— 组件树里不再读全局，
 * 测试可以直接传入任意 env 状态。
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { readEnvSnapshot } from './envSnapshot';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App env={readEnvSnapshot()} />
  </StrictMode>,
);
