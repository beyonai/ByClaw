import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function violations(packageJson) {
  const errors = [];
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const [name, version] of Object.entries(packageJson[section] || {})) {
      if (/^[~^]/.test(version)) errors.push(`${section}.${name}: ${version}`);
    }
  }
  return errors;
}

export function main(args) {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const files = args.length ? args : execFileSync('git', ['ls-files', '-z', '*package.json'], {
    cwd: root, encoding: 'utf8',
  }).split('\0').filter(Boolean);
  let failed = false;
  for (const file of files) {
    const candidate = path.resolve(root, file);
    if (!existsSync(candidate)) continue;
    const absolute = realpathSync(candidate);
    // Only repository-relative fixture directories are excluded, not ancestors of the checkout.
    if (path.relative(root, absolute).split(path.sep).some(part =>
      ['tests', '__tests__', 'fixtures', '.scratch'].includes(part))) continue;
    if (!existsSync(absolute)) continue;
    try {
      const pkg = JSON.parse(readFileSync(absolute, 'utf8'));
      if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) throw new Error('Expected a package object');
      for (const error of violations(pkg)) {
        console.error(`${file}: ${error}`);
        failed = true;
      }
    } catch (error) {
      console.error(`${file}: ${error.message}`);
      failed = true;
    }
  }
  if (!failed) console.log('Package dependency version pinning passed');
  return failed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
