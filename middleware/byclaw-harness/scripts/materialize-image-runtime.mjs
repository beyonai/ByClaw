#!/usr/bin/env node
/** Keep Sharp's native CommonJS closure usable through profile-preserved paths. */
import { cp, mkdir, mkdtemp, readFile, realpath, rename, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageName = /^(?:@[a-z0-9._-]+\/)?[a-z0-9_][a-z0-9._-]*$/i;
const accepts = (values, current) => !values || (!values.includes(`!${current}`)
  && (!values.some(value => !value.startsWith('!')) || values.includes(current) || values.includes('any')));

async function locate(name, parent) {
  if (!packageName.test(name)) throw new Error(`Invalid native dependency name: ${name}`);
  const require = createRequire(join(parent, 'package.json'));
  for (const directory of require.resolve.paths(name) ?? []) {
    try {
      const manifestPath = await realpath(join(directory, name, 'package.json'));
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      if (manifest.name !== name) throw new Error(`Native dependency name mismatch: ${name}`);
      return { directory: dirname(manifestPath), manifest };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const error = new Error(`Missing installed native image dependency: ${name}`);
  error.code = 'MODULE_NOT_FOUND';
  throw error;
}

export async function materializeImageRuntime(workspace) {
  const consumer = await realpath(join(workspace, 'packages/attachment/attachment-local'));
  const manifest = JSON.parse(await readFile(join(consumer, 'package.json'), 'utf8'));
  if (manifest.name !== '@deepseek-ai/dsh-attachment-local' || manifest.version !== '0.2.1-rc.2') {
    throw new Error('Expected @deepseek-ai/dsh-attachment-local@0.2.1-rc.2');
  }
  const packages = new Map();
  const libc = process.platform === 'linux'
    ? (process.report.getReport().header.glibcVersionRuntime ? 'glibc' : 'musl') : undefined;
  async function visit(name, parent, optional = false) {
    let item;
    try { item = await locate(name, parent); } catch (error) {
      if (optional && error.code === 'MODULE_NOT_FOUND') return;
      throw error;
    }
    const pkg = item.manifest;
    const compatible = accepts(pkg.os, process.platform) && accepts(pkg.cpu, process.arch)
      && (!pkg.libc || accepts(pkg.libc, libc));
    if (!compatible) {
      if (optional) return;
      throw new Error(`Incompatible required image dependency: ${name}`);
    }
    const previous = packages.get(name);
    if (previous) {
      if (previous.directory !== item.directory) throw new Error(`Conflicting native image dependency: ${name}`);
      return;
    }
    packages.set(name, item);
    const optionals = pkg.optionalDependencies ?? {};
    for (const dependency of Object.keys(pkg.dependencies ?? {})) {
      if (!Object.hasOwn(optionals, dependency)) await visit(dependency, item.directory);
    }
    for (const dependency of Object.keys(optionals)) await visit(dependency, item.directory, true);
  }
  await visit('sharp', consumer);
  if (packages.get('sharp').manifest.version !== manifest.dependencies.sharp) {
    throw new Error('Sharp must retain the consumer\'s exact pinned version');
  }
  // Copy before replacing any links: an idempotent rerun may read these targets.
  const staging = await mkdtemp(join(dirname(consumer), '.image-runtime-'));
  try {
    for (const [name, item] of packages) {
      const target = join(staging, name);
      await mkdir(dirname(target), { recursive: true });
      await cp(item.directory, target, {
        recursive: true, dereference: true,
        filter: source => relative(item.directory, source).split(sep)[0] !== 'node_modules',
      });
    }
    for (const name of packages.keys()) {
      const target = join(consumer, 'node_modules', name);
      await mkdir(dirname(target), { recursive: true });
      await rm(target, { recursive: true, force: true });
      await rename(join(staging, name), target);
    }
  } finally { await rm(staging, { recursive: true, force: true }); }
  return { packages: [...packages].map(([name, item]) => ({ name, version: item.manifest.version })) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('usage: materialize-image-runtime.mjs WORKSPACE');
  console.log(JSON.stringify(await materializeImageRuntime(resolve(process.argv[2]))));
}
