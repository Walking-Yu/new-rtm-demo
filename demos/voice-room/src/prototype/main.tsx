// 一次性布局原型入口，独立于 src/main.tsx，不参与主应用路由。
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PrototypeApp } from './PrototypeApp';
import './prototype.css';

const container = document.getElementById('prototype-root');
if (!container) {
  throw new Error('缺少 #prototype-root 挂载点');
}

createRoot(container).render(
  <StrictMode>
    <PrototypeApp />
  </StrictMode>,
);
