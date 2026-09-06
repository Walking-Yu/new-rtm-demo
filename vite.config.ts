import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  const https = mode === 'https'
    ? {
        key: readFileSync(resolve('.cert/dev-key.pem')),
        cert: readFileSync(resolve('.cert/dev.pem')),
      }
    : undefined;

  /*
   * 隧道模式：把开发服务器挂到 Cloudflare Tunnel 之类的公网域名后面时，
   * 浏览器带的 Host 是那个域名，而 Vite 默认只放行 localhost 一类的主机名。
   * 由 `start-demo.sh --tunnel <域名>` 写入 `RTM_DEMO_TUNNEL_HOST`，这里只做两件事：
   * 放行该域名，并让 HMR 客户端走 `wss://<域名>:443`（TLS 由隧道终结，本地仍是 HTTP）。
   * 不设时行为与之前完全一致。
   */
  const tunnelHost = process.env.RTM_DEMO_TUNNEL_HOST?.trim() || undefined;

  return {
    plugins: [react()],
    server: {
      https,
      allowedHosts: tunnelHost ? [tunnelHost] : undefined,
      hmr: tunnelHost ? { host: tunnelHost, protocol: 'wss', clientPort: 443 } : undefined,
    },
  // E2E 通过页面脚本显式注入环境，不读取开发者本机的任何 `.env*` 文件。
  // 普通 dev/build 的 envDir 保持默认值，因此 `.env.local` 仍正常生效。
  envDir: mode === 'e2e' ? false : undefined,
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
   * 不配置 `build.rollupOptions.input`：只有根 `index.html` 一个入口，
   * 走 Vite 默认行为即可。
   */
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
  },
  };
});
