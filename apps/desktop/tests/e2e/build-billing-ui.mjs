import { build } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
const outDir = join(tmpdir(), 'supahelp-billing-ui');
await build({
  configFile: false,
  define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [react(), tailwindcss()],
  build: {
    outDir,
    emptyOutDir: true,
    lib: {
      entry: 'tests/e2e/billing-ui.tsx',
      formats: ['iife'],
      name: 'BillingFixture',
      fileName: () => 'fixture.js',
      cssFileName: 'fixture',
    },
  },
});
await writeFile(
  join(outDir, 'index.html'),
  '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; font-src \'self\' data:; img-src \'self\' data:"><link rel="stylesheet" href="./fixture.css"></head><body><div id="root"></div><script src="./fixture.js"></script></body></html>',
);
