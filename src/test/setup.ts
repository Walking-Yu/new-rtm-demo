/**
 * 根 vitest 的全局 setup。
 *
 * 它服务**整个根测试套件**（`src/**` 与 `tests/**`），所以住在 `src/test/` 下，
 * 而不是任何某一个场景或子目录里 —— 放进子目录会让「这个模块可以被移走」这类
 * 改动意外带走整套测试基础设施。
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
});
