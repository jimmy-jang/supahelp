import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export default defineConfig({
  build: {
    outDir: join(tmpdir(), 'supahelp-account-e2e'),
    emptyOutDir: true,
    lib: {
      entry: 'tests/e2e/account-app.ts',
      formats: ['cjs'],
      fileName: () => 'app.cjs',
    },
    rollupOptions: {
      external: [
        'electron',
        ...builtinModules,
        ...builtinModules.map((name) => `node:${name}`),
      ],
    },
  },
});
