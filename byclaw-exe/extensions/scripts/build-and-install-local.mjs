#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const usage = 'Usage: node build-and-install-local.mjs --source <extensions-dir> --target <openclaw-extensions-dir>';

function isWithin(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function canonicalPath(candidate) {
  const absolute = path.resolve(candidate);
  const missing = [];
  let existing = absolute;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) throw new Error(`Path does not have an existing ancestor: ${absolute}`);
    missing.unshift(path.basename(existing));
    existing = parent;
  }
  return path.join(fs.realpathSync(existing), ...missing);
}

function parseArgs(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!['--source', '--target'].includes(flag) || !value || value.startsWith('--') || values[flag.slice(2)]) {
      throw new Error(usage);
    }
    values[flag.slice(2)] = path.resolve(value);
  }
  if (!values.source || !values.target || Object.keys(values).length !== 2) throw new Error(usage);
  return values;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertRegularMetadata(filePath) {
  const stat = fs.lstatSync(filePath, { throwIfNoEntry: false });
  if (!stat?.isFile()) throw new Error(`Extension metadata must be a regular file: ${filePath}`);
}

function selectPackageManager(directory) {
  if (fs.existsSync(path.join(directory, 'package-lock.json')) || fs.existsSync(path.join(directory, 'npm-shrinkwrap.json'))) {
    return { command: 'npm', prefix: [] };
  }
  if (fs.existsSync(path.join(directory, 'pnpm-lock.yaml'))) {
    return { command: 'corepack', prefix: ['pnpm'] };
  }
  throw new Error(`Extension package requires a deterministic lockfile: ${directory}`);
}

function hasRuntimeDependencies(packageJson) {
  // Peer dependencies are supplied by the OpenClaw host, so they do not require a packaged node_modules tree.
  return ['dependencies', 'optionalDependencies'].some((field) => {
    const dependencies = packageJson[field];
    return dependencies && typeof dependencies === 'object' && Object.keys(dependencies).length > 0;
  });
}

function extensionPackages(source) {
  if (!fs.lstatSync(source).isDirectory()) throw new Error(`Source directory does not exist: ${source}`);
  const realSource = fs.realpathSync(source);
  return {
    realSource,
    packages: fs.readdirSync(realSource, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const directory = path.join(realSource, entry.name);
        const packageFile = path.join(directory, 'package.json');
        if (!fs.existsSync(packageFile)) return null;
        assertRegularMetadata(packageFile);
        const realDirectory = fs.realpathSync(directory);
        if (!isWithin(realDirectory, realSource)) throw new Error(`Extension package is outside source: ${directory}`);
        const packageJson = readJson(packageFile);
        const extensions = packageJson.openclaw?.extensions;
        if (!Array.isArray(extensions) || extensions.length === 0) return null;
        if (!extensions.every((extension) => typeof extension === 'string')) {
          throw new Error(`${packageFile} has an invalid openclaw.extensions entry`);
        }
        return {
          directory: realDirectory,
          extensions,
          hasRuntimeDependencies: hasRuntimeDependencies(packageJson),
          manager: selectPackageManager(realDirectory),
          name: entry.name,
          packageJson,
        };
      })
      .filter(Boolean),
  };
}

function assertNoOverlap(realSource, target, packages) {
  const realTarget = canonicalPath(target);
  if (isWithin(realSource, realTarget) || isWithin(realTarget, realSource)) {
    throw new Error(`Source and target overlap: ${realSource} <-> ${realTarget}`);
  }
  for (const pkg of packages) {
    const pluginTarget = canonicalPath(path.join(realTarget, pkg.name));
    if (isWithin(realSource, pluginTarget) || isWithin(pluginTarget, realSource)) {
      throw new Error(`Plugin target overlaps source: ${pkg.name}`);
    }
  }
  return realTarget;
}

function runPackageManager(directory, manager, args) {
  const commandArgs = [...manager.prefix, ...args];
  const result = spawnSync(manager.command, commandArgs, { cwd: directory, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${manager.command} ${commandArgs.join(' ')} failed in ${directory}${result.stderr ? `: ${result.stderr.trim()}` : ''}`);
  }
}

function assertSafeRuntimeTree(root, realPackage, allowedRoots) {
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink()) {
    let realLink;
    try {
      realLink = fs.realpathSync(root);
    } catch {
      throw new Error(`Runtime symbolic link cannot be resolved: ${root}`);
    }
    if (!isWithin(realLink, realPackage) || !allowedRoots.some((allowed) => isWithin(realLink, allowed))) {
      throw new Error(`Runtime symbolic link points outside package runtime: ${root}`);
    }
    return;
  }
  if (!stat.isDirectory()) return;
  for (const entry of fs.readdirSync(root)) {
    assertSafeRuntimeTree(path.join(root, entry), realPackage, allowedRoots);
  }
}

function assertRuntimeEntry(pkg) {
  const dist = path.join(pkg.directory, 'dist');
  const distStat = fs.lstatSync(dist, { throwIfNoEntry: false });
  if (!distStat?.isDirectory()) throw new Error(`dist directory does not exist: ${pkg.directory}`);
  const realDist = fs.realpathSync(dist);
  if (!isWithin(realDist, pkg.directory)) throw new Error(`dist directory points outside package: ${dist}`);
  const modules = path.join(pkg.directory, 'node_modules');
  const moduleStat = fs.lstatSync(modules, { throwIfNoEntry: false });
  if (pkg.hasRuntimeDependencies && !moduleStat) throw new Error(`Production dependencies are missing node_modules: ${modules}`);
  if (pkg.hasRuntimeDependencies && !moduleStat.isDirectory()) throw new Error(`node_modules is not a directory: ${modules}`);
  const realModules = pkg.hasRuntimeDependencies ? fs.realpathSync(modules) : null;
  if (realModules && !isWithin(realModules, pkg.directory)) throw new Error(`node_modules points outside package: ${modules}`);

  for (const extension of pkg.extensions) {
    const entry = path.resolve(pkg.directory, extension);
    if (!isWithin(entry, dist)) throw new Error(`Declared extension entry is outside dist: ${path.join(pkg.directory, extension)}`);
    if (entry.endsWith('.map')) throw new Error(`A source map cannot be an extension entry: ${entry}`);
    const stat = fs.lstatSync(entry, { throwIfNoEntry: false });
    if (!stat?.isFile()) throw new Error(`Declared extension entry is not a regular file: ${entry}`);
    const realEntry = fs.realpathSync(entry);
    if (!isWithin(realEntry, realDist)) throw new Error(`Declared extension entry resolves outside dist: ${entry}`);
  }

  const roots = [realDist];
  if (realModules) roots.push(realModules);
  assertSafeRuntimeTree(dist, pkg.directory, roots);
  if (pkg.hasRuntimeDependencies) assertSafeRuntimeTree(modules, pkg.directory, roots);
}

function copyRuntimeTree(source, destination, packageRoot, stagedPackage, { omitSourceMaps = false } = {}) {
  const stat = fs.lstatSync(source);
  if (omitSourceMaps && path.basename(source).endsWith('.map') && (stat.isFile() || stat.isSymbolicLink())) return;
  if (stat.isSymbolicLink()) {
    const link = fs.readlinkSync(source);
    if (path.isAbsolute(link)) {
      const stagedTarget = path.join(stagedPackage, path.relative(packageRoot, fs.realpathSync(source)));
      fs.symlinkSync(path.relative(path.dirname(destination), stagedTarget) || '.', destination);
    } else {
      fs.symlinkSync(link, destination);
    }
    return;
  }
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true, mode: stat.mode });
    for (const entry of fs.readdirSync(source)) {
      copyRuntimeTree(path.join(source, entry), path.join(destination, entry), packageRoot, stagedPackage, {
        omitSourceMaps,
      });
    }
    return;
  }
  if (!stat.isFile()) throw new Error(`Runtime tree contains unsupported entry: ${source}`);
  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, stat.mode);
}

function stagePackage(pkg, stagingRoot) {
  const staged = path.join(stagingRoot, pkg.name);
  fs.mkdirSync(staged, { recursive: true });
  const packageFile = path.join(pkg.directory, 'package.json');
  assertRegularMetadata(packageFile);
  fs.copyFileSync(packageFile, path.join(staged, 'package.json'));
  const pluginManifest = path.join(pkg.directory, 'openclaw.plugin.json');
  if (fs.existsSync(pluginManifest)) {
    assertRegularMetadata(pluginManifest);
    fs.copyFileSync(pluginManifest, path.join(staged, 'openclaw.plugin.json'));
  }
  copyRuntimeTree(path.join(pkg.directory, 'dist'), path.join(staged, 'dist'), pkg.directory, staged, {
    omitSourceMaps: true,
  });
  if (pkg.hasRuntimeDependencies) {
    copyRuntimeTree(path.join(pkg.directory, 'node_modules'), path.join(staged, 'node_modules'), pkg.directory, staged, {
      omitSourceMaps: true,
    });
  }
  return staged;
}

function uniqueBackup(target, makeId) {
  let backup;
  do {
    backup = `${target}.backup-${makeId()}`;
  } while (fs.existsSync(backup));
  return backup;
}

export function replacePackage(staged, target, { makeId = randomUUID, rename = fs.renameSync } = {}) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const hadTarget = fs.existsSync(target);
  const backup = hadTarget ? uniqueBackup(target, makeId) : null;
  let ownsBackup = false;
  try {
    if (backup) {
      rename(target, backup);
      ownsBackup = true;
    }
    rename(staged, target);
  } catch (error) {
    if (ownsBackup && !fs.existsSync(target) && fs.existsSync(backup)) rename(backup, target);
    throw error;
  }
}

function withPluginLock(lock, run) {
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  let descriptor;
  try {
    descriptor = fs.openSync(lock, 'wx');
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'EEXIST') {
      throw new Error(`Extension installation lock is already held: ${lock}`);
    }
    throw error;
  }
  try {
    fs.writeFileSync(descriptor, `${process.pid}\n`);
    return run();
  } finally {
    fs.closeSync(descriptor);
    fs.rmSync(lock, { force: true });
  }
}

export async function buildAndInstallLocal({ source, target, mkdtemp = fs.promises.mkdtemp, makeId = randomUUID }) {
  const { realSource, packages } = extensionPackages(source);
  if (packages.length === 0) throw new Error(`No OpenClaw extensions found in ${source}`);
  const realTarget = assertNoOverlap(realSource, target, packages);
  const targetParent = path.dirname(realTarget);
  fs.mkdirSync(targetParent, { recursive: true });
  const stagingRoot = await mkdtemp(path.join(fs.realpathSync(targetParent), '.byclaw-local-extension-'));
  try {
    const staged = packages.map((pkg) => {
      const install = pkg.manager.command === 'npm' ? ['ci'] : ['install', '--frozen-lockfile'];
      const prune = pkg.manager.command === 'npm' ? ['prune', '--omit=dev'] : ['prune', '--prod'];
      runPackageManager(pkg.directory, pkg.manager, install);
      if (pkg.packageJson.scripts?.build) runPackageManager(pkg.directory, pkg.manager, ['run', 'build']);
      runPackageManager(pkg.directory, pkg.manager, prune);
      assertRuntimeEntry(pkg);
      const directory = stagePackage(pkg, stagingRoot);
      assertRuntimeEntry({ ...pkg, directory });
      return { name: pkg.name, directory };
    });
    for (const pkg of staged) {
      const pluginTarget = path.join(realTarget, pkg.name);
      const lock = path.join(realTarget, `.${pkg.name}.install.lock`);
      withPluginLock(lock, () => replacePackage(pkg.directory, pluginTarget, { makeId }));
    }
    return staged.map((pkg) => path.join(realTarget, pkg.name));
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

async function main() {
  const { source, target } = parseArgs(process.argv.slice(2));
  const installed = await buildAndInstallLocal({ source, target });
  console.log(JSON.stringify({ installed }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
