import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  // The SiYuan package ships declarations; its implementation only exists in the host.
  test: { alias: { siyuan: resolve('tests/siyuan-host.ts') } },
});
