import { resolve } from 'node:path'
import autoprefixer from 'autoprefixer'
import postcssNesting from 'postcss-nesting'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import webExtension from 'vite-plugin-web-extension'

export default defineConfig({
  root: 'src',
  plugins: [
    vue(),
    webExtension({
      manifest: 'manifest.json',
      skipManifestValidation: true,
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  css: {
    postcss: {
      plugins: [postcssNesting(), autoprefixer()],
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
})
