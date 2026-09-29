// Dev server for sim-core integration runs (port 5203): serves the real game
// from the repo root with HMR and file watching off, so edits made by other
// agents while a playtest runs do not reload the page mid-test.
// usage: npx vite --config sandbox/sim-core/vite.config.ts --port 5203 --strictPort
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  base: './',
  worker: { format: 'es' },
  server: { host: true, hmr: false, watch: { ignored: ['**/*'] } },
});
