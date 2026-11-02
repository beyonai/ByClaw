#!/usr/bin/env node
// Build only. Runtime uses the checked-in bundle and needs no npm installation.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.dirname(fileURLToPath(import.meta.url));
const vendor = path.join(root, 'vendor');
const result = spawnSync('npx', ['--yes', '--package=esbuild@0.25.0', 'esbuild',
  path.join(root, 'screenshot-deps-entry.mjs'), '--bundle', '--platform=node', '--format=cjs',
  '--target=node18', '--minify', '--legal-comments=inline',
  `--outfile=${path.join(vendor, 'screenshot-deps.cjs')}`], { cwd: os.tmpdir(), stdio: 'inherit' });
if (result.error || result.status !== 0) throw new Error('Screenshot dependency bundle build failed');
for (const [source, destination] of [
  ['pngjs/LICENSE', 'LICENSE.pngjs'], ['fflate/LICENSE', 'LICENSE.fflate'],
]) fs.copyFileSync(path.join(root, 'node_modules', source), path.join(vendor, destination));
