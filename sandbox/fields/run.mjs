// Bundles bench.ts with rolldown and runs it in Node.
//   node sandbox/fields/run.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const out = join(mkdtempSync(join(tmpdir(), 'fields-')), 'bench.mjs');
execFileSync('npx', ['rolldown', join(here, 'bench.ts'), '--file', out, '--platform', 'node', '--format', 'esm'], { stdio: ['ignore', 'ignore', 'inherit'], cwd: join(here, '../..') });
execFileSync('node', [out, ...process.argv.slice(2)], { stdio: 'inherit' });
