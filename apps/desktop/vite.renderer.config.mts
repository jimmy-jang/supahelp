import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Strict CSP for packaged builds only; the dev server needs React Refresh's inline script.
const csp: Plugin = {
  name: 'supahelp-csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace(
      '<head>',
      `<head><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:">`,
    ),
};

// https://vitejs.dev/config
export default defineConfig({
  plugins: [react(), tailwindcss(), csp],
});
