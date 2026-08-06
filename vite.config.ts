import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        // 新骨架入口（主线）
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        // 遗留 24 场景实验室入口，保留做维护验证
        legacy: fileURLToPath(new URL('./legacy.html', import.meta.url)),
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/legacy/test/setup.ts'],
    css: true,
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
  },
});
