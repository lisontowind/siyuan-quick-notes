import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: { entry: resolve('src/index.ts'), formats: ['cjs'], fileName: () => 'index.js' },
    rollupOptions: { external: ['siyuan'], output: { exports: 'default', assetFileNames: 'index.[ext]' } },
    target: 'es2022',
  },
});
