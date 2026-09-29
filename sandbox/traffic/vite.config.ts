// Dev server for the traffic sandbox: no HMR so concurrent edits by other agents
// don't reload the page mid-screenshot.
import { defineConfig } from 'vite';

export default defineConfig({
  root: process.cwd(),
  worker: { format: 'es' },
  server: { host: true, hmr: false },
});
