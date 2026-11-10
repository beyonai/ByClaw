// Copy installed browser dependencies at their original paths, excluding Harness peers.
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const destination = process.argv[2];
if (!destination?.startsWith('/')) throw new Error('Absolute output directory required');
const browser = '/opt/byclaw/dsh-managed/profiles/web/node_modules/@byclaw/dsh-browser-use';
const seen = new Set();
function copyPackage(directory) {
  const real = realpathSync(directory);
  if (seen.has(real)) return;
  seen.add(real);
  const manifest = JSON.parse(readFileSync(join(real, 'package.json'), 'utf8'));
  const output = join(destination, real);
  mkdirSync(dirname(output), { recursive: true });
  cpSync(real, output, { recursive: true, verbatimSymlinks: true });
  if (directory !== real) {
    mkdirSync(dirname(join(destination, directory)), { recursive: true });
    symlinkSync(real, join(destination, directory));
  }
  const require = createRequire(join(real, 'package.json'));
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    let entry;
    try { entry = require.resolve(`${name}/package.json`); }
    catch { entry = require.resolve(name); }
    let root = dirname(entry);
    while (!existsSync(join(root, 'package.json')) ||
      JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name !== name) {
      const parent = dirname(root);
      if (parent === root) throw new Error(`Package root missing: ${name}`);
      root = parent;
    }
    copyPackage(root);
  }
}
copyPackage(browser);
console.log(`Browser runtime: ${seen.size} installed packages`);
