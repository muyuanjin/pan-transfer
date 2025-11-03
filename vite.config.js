import { defineConfig } from 'vite';
import webExtension from 'vite-plugin-web-extension';

export default defineConfig({
  root: 'src',
  plugins: [
    webExtension({
      manifest: 'manifest.json',
      skipManifestValidation: true,
    }),
  ],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});
