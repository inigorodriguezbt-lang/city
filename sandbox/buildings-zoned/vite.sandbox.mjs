// Dev config for the buildings-zoned sandbox: no HMR / full reloads, so other
// agents' concurrent edits don't navigate the page away mid-screenshot.
import { defineConfig } from 'vite';
export default defineConfig({
  root: new URL('../..', import.meta.url).pathname,
  base: './',
  worker: { format: 'es' },
  server: { host: true, hmr: false, watch: { ignored: (p) => /\/(src|sandbox)\//.test(p) && !/src\/render(\/buildings(\/|$)|$)|sandbox\/buildings-zoned(\/|$)/.test(p) } },
});
