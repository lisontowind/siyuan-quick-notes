import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  // The SiYuan package ships declarations; its implementation only exists in the host.
  // Only run project tests; artifacts may contain upstream source trees.
  test: { include: ['tests/**/*.test.ts'], alias: { siyuan: resolve('tests/siyuan-host.ts') } },
});
