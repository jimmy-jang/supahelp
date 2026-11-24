import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export default defineConfig({
  define: {
    'import.meta.url': 'require("node:url").pathToFileURL(__filename).href',
  },
  build: {
    outDir: join(tmpdir(), 'supahelp-case-e2e'),
    emptyOutDir: true,
    lib: {
      entry: 'tests/e2e/case-app.ts',
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
