import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig(async () => {
  const { default: vue } = await import('@vitejs/plugin-vue');

  return {
    plugins: [vue()],
    resolve: {
      alias: {
        '@': resolve(__dirname, './src')
      }
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.spec.ts'],
      reporters: 'basic',
      watch: false
    }
  };
});
