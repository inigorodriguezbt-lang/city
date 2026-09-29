// Dev server config for the buildings-service sandbox: no HMR so that other
// agents' concurrent edits don't reload the gallery mid-screenshot.
import { defineConfig } from 'vite';

export default defineConfig({
  root: process.cwd(),
  worker: { format: 'es' },
  server: { host: true, hmr: false },
});
