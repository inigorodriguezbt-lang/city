// Node ESM resolve hook: lets the TS sources (extensionless imports) run under
// `node --experimental-transform-types`. Used only by the mapgen node harness.
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

export async function resolve(specifier, context, next) {
  if ((specifier.startsWith('.') || specifier.startsWith('/')) && !/\.[cm]?[jt]s$/.test(specifier) && context.parentURL) {
    const base = new URL(specifier, context.parentURL);
    const p = fileURLToPath(base);
    for (const cand of [p + '.ts', p + '/index.ts']) {
      if (existsSync(cand) && statSync(cand).isFile()) return next(pathToFileURL(cand).href, context);
    }
  }
  return next(specifier, context);
}

if (!globalThis.__mapgenLoaderRegistered) {
  globalThis.__mapgenLoaderRegistered = true;
  register(import.meta.url);
}
