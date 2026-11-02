import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'copy-standalone-pwa-files',
        closeBundle() {
          const outDir = path.resolve(__dirname, 'dist');
          if (!fs.existsSync(outDir)) return;
          for (const file of ['manifest.json', 'sw.js', 'app.js']) {
            const src = path.resolve(__dirname, file);
            const dest = path.resolve(outDir, file);
            if (fs.existsSync(src)) {
              fs.copyFileSync(src, dest);
            }
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
