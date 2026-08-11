import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  /*
   * vendor 里的 RTM SDK 是 UMD/CJS 产物（`module.exports = ...`，无 `exports.default`）。
   * 生产构建走 Rollup 的 commonjs 转换没问题，但开发服务器不预构建它时会按 ESM 解析，
   * 于是浏览器报 `does not provide an export named 'default'`，整个 app 起不来。
   *
   * 显式列进 `optimizeDeps.include` 强制预构建成 ESM。**不要删** —— 它是软链进来的
   * 本地包，Vite 的自动依赖发现对软链包不可靠。
   */
  optimizeDeps: {
    include: ['agora-rtm'],
  },
  /*
   * 不配置 `build.rollupOptions.input`：现在只有根 `index.html` 一个入口，
   * 走 Vite 默认行为即可。遗留实验室的 `legacy.html` 第二入口已随遗留代码
   * 一起搬去 `new-rtm-demo-legacy` 仓库，这里不再保留。
   */
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
  },
});
