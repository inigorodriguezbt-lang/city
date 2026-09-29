// Bundles harness.ts with rolldown and runs it in Node.
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const out = join(mkdtempSync(join(tmpdir(), 'simcore-')), 'harness.mjs');
const entry = process.argv.includes('--perf') ? 'perf.ts' : 'harness.ts';
execFileSync('npx', ['rolldown', join(here, entry), '--file', out, '--platform', 'node', '--format', 'esm'], { stdio: ['ignore', 'ignore', 'inherit'], cwd: join(here, '../..') });
execFileSync('node', [out, ...process.argv.slice(2)], { stdio: 'inherit' });
