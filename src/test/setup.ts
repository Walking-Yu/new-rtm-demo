/**
 * 根 vitest 的全局 setup。
 *
 * 它服务**整个根测试套件**（`src/**` 与 `tests/**`），不是某一套代码专用的。
 * 原先住在 `src/legacy/test/setup.ts`，遗留实验室搬出仓库时提到这里 ——
 * 放在遗留目录里会让「移走遗留代码」意外带走新骨架的测试基础设施。
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
});
