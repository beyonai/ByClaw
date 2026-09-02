import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildAndInstallLocal, replacePackage } from './build-and-install-local.mjs';

const scriptPath = new URL('./build-and-install-local.mjs', import.meta.url);

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'byclaw-local-packager-'));
  const source = path.join(root, 'source');
  const target = path.join(root, 'target');
  const bin = path.join(root, 'bin');
  const log = path.join(root, 'npm.log');
  const plugin = path.join(source, 'example-plugin');

  writeJson(path.join(plugin, 'package.json'), {
    name: 'example-plugin',
    scripts: { build: 'fake build' },
    dependencies: { runtime: '1.0.0' },
    devDependencies: { 'dev-only': '1.0.0' },
    openclaw: { extensions: ['./dist/index.js'] },
  });
  writeJson(path.join(plugin, 'package-lock.json'), { lockfileVersion: 3, name: 'example-plugin' });
  fs.writeFileSync(path.join(plugin, 'openclaw.plugin.json'), '{"id":"example-plugin"}\n');
  writeJson(path.join(source, 'shared', 'package.json'), {
    name: '@byclaw/shared',
    main: 'src/index.ts',
  });
  fs.mkdirSync(path.join(source, 'shared', 'src'), { recursive: true });
  fs.writeFileSync(path.join(source, 'shared', 'src', 'internal.ts'), 'export const shared = true;\n');
  fs.mkdirSync(path.join(target, 'example-plugin'), { recursive: true });
  fs.writeFileSync(path.join(target, 'example-plugin', 'old.txt'), 'keep as backup\n');
  fs.mkdirSync(path.join(target, 'unrelated-extension'), { recursive: true });
  fs.writeFileSync(path.join(target, 'unrelated-extension', 'keep.txt'), 'unrelated\n');

  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(
    path.join(bin, 'npm'),
    `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
fs.appendFileSync(process.env.PACKAGER_NPM_LOG, \`${'${path.basename(process.cwd())}'}:${'${args.join(" ")}'}\\n\`);
if (args[0] === 'ci') {
  fs.mkdirSync(path.join(process.cwd(), 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), 'node_modules', 'runtime.js'), 'runtime');
  fs.writeFileSync(path.join(process.cwd(), 'node_modules', 'dev-only.js'), 'dev');
  if (process.env.PACKAGER_EXTERNAL_RUNTIME_LINK) {
    fs.rmSync(path.join(process.cwd(), 'node_modules', 'runtime.js'));
    fs.symlinkSync(process.env.PACKAGER_EXTERNAL_RUNTIME_LINK, path.join(process.cwd(), 'node_modules', 'runtime.js'));
  }
  if (process.env.PACKAGER_BROKEN_RUNTIME_LINK) {
    fs.rmSync(path.join(process.cwd(), 'node_modules', 'runtime.js'));
    fs.symlinkSync('missing-runtime.js', path.join(process.cwd(), 'node_modules', 'runtime.js'));
  }
  if (process.env.PACKAGER_NODE_MODULE_MAPS) {
    fs.writeFileSync(path.join(process.cwd(), 'node_modules', 'runtime.js.map'), '{"version":3}');
    fs.mkdirSync(path.join(process.cwd(), 'node_modules', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(process.cwd(), 'node_modules', 'nested', 'helper.js'), 'export {};');
    fs.writeFileSync(path.join(process.cwd(), 'node_modules', 'nested', 'helper.js.map'), '{"version":3}');
    fs.writeFileSync(path.join(process.cwd(), 'node_modules', 'schema.map.json'), '{}');
    fs.symlinkSync('runtime.js', path.join(process.cwd(), 'node_modules', 'linked.map'));
    if (process.env.PACKAGER_NODE_MODULE_DIRECT_ALIAS) {
      fs.symlinkSync('runtime.js.map', path.join(process.cwd(), 'node_modules', 'alias.js'));
    }
    if (process.env.PACKAGER_NODE_MODULE_CHAINED_ALIAS) {
      fs.symlinkSync('linked.map', path.join(process.cwd(), 'node_modules', 'alias.js'));
    }
  }
}
if (args[0] === 'run' && args[1] === 'build') {
  if (process.env.PACKAGER_FAIL_BUILD_FOR === path.basename(process.cwd())) process.exit(23);
  if (process.env.PACKAGER_MISSING_ENTRY_FOR === path.basename(process.cwd())) process.exit(0);
  fs.mkdirSync(path.join(process.cwd(), 'dist'), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), 'dist', 'index.js'), 'export default {};');
  fs.writeFileSync(path.join(process.cwd(), 'dist', 'index.js.map'), '{"version":3}');
  fs.mkdirSync(path.join(process.cwd(), 'dist', 'chunks'), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), 'dist', 'chunks', 'helper.js'), 'export {};');
  fs.writeFileSync(path.join(process.cwd(), 'dist', 'chunks', 'helper.js.map'), '{"version":3}');
  fs.writeFileSync(path.join(process.cwd(), 'dist', 'schema.map.json'), '{}');
  fs.rmSync(path.join(process.cwd(), 'dist', 'linked.map'), { force: true });
  fs.symlinkSync('index.js', path.join(process.cwd(), 'dist', 'linked.map'));
  fs.rmSync(path.join(process.cwd(), 'dist', 'alias.js'), { force: true });
  if (process.env.PACKAGER_DIRECT_MAP_ALIAS) {
    fs.symlinkSync('index.js.map', path.join(process.cwd(), 'dist', 'alias.js'));
  }
  if (process.env.PACKAGER_CHAINED_MAP_ALIAS) {
    fs.symlinkSync('linked.map', path.join(process.cwd(), 'dist', 'alias.js'));
  }
}
if (args[0] === 'prune') fs.rmSync(path.join(process.cwd(), 'node_modules', 'dev-only.js'), { force: true });
`,
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(bin, 'corepack'),
    `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
if (args[0] !== 'pnpm') process.exit(22);
const pnpmArgs = args.slice(1);
fs.appendFileSync(process.env.PACKAGER_NPM_LOG, \`${'${path.basename(process.cwd())}'}:corepack ${'${args.join(" ")}'}\\n\`);
if (pnpmArgs[0] === 'install') {
  fs.mkdirSync(path.join(process.cwd(), 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), 'node_modules', 'runtime.js'), 'runtime');
  fs.writeFileSync(path.join(process.cwd(), 'node_modules', 'dev-only.js'), 'dev');
}
if (pnpmArgs[0] === 'run' && pnpmArgs[1] === 'build') {
  if (process.env.PACKAGER_FAIL_PNPM_FOR === path.basename(process.cwd())) process.exit(23);
  fs.mkdirSync(path.join(process.cwd(), 'dist'), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), 'dist', 'index.js'), 'export default {};');
}
if (pnpmArgs[0] === 'prune') fs.rmSync(path.join(process.cwd(), 'node_modules', 'dev-only.js'), { force: true });
if (pnpmArgs[0] === 'prune' && process.env.PACKAGER_PNPM_PRUNE_DANGLING_DEV) {
  fs.mkdirSync(path.join(process.cwd(), 'node_modules', '.pnpm'), { recursive: true });
  fs.symlinkSync(path.join(process.cwd(), 'missing-dev-package'), path.join(process.cwd(), 'node_modules', '.pnpm', 'dev-package'));
}
`,
    { mode: 0o755 },
  );

  return { bin, log, plugin, root, source, target };
}

function runPackager(fixture, extraEnv = {}) {
  return runPackagerAt(fixture, fixture.source, fixture.target, extraEnv);
}

function runPackagerAt(fixture, source, target, extraEnv = {}) {
  const result = spawnSync(process.execPath, [scriptPath.pathname, '--source', source, '--target', target], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...extraEnv,
      PACKAGER_NPM_LOG: fixture.log,
      PATH: `${fixture.bin}${path.delimiter}${process.env.PATH}`,
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim());
  return result.stdout;
}

function cleanup(fixture) {
  fs.rmSync(fixture.root, { recursive: true, force: true });
}

function usePnpmLock(fixture) {
  fs.rmSync(path.join(fixture.plugin, 'package-lock.json'));
  fs.writeFileSync(path.join(fixture.plugin, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
}

async function withPackagerEnv(fixture, run, extraEnv = {}) {
  const previousPath = process.env.PATH;
  const previousLog = process.env.PACKAGER_NPM_LOG;
  const extra = Object.entries(extraEnv).map(([key, value]) => [key, process.env[key]]);
  process.env.PATH = `${fixture.bin}${path.delimiter}${previousPath}`;
  process.env.PACKAGER_NPM_LOG = fixture.log;
  Object.assign(process.env, extraEnv);
  try {
    return await run();
  } finally {
    process.env.PATH = previousPath;
    if (previousLog === undefined) delete process.env.PACKAGER_NPM_LOG;
    else process.env.PACKAGER_NPM_LOG = previousLog;
    for (const [key, value] of extra) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('installs only extension runtime artifacts and retains the prior extension as a backup', (t) => {
  const fixture = createFixture();
  t.after(() => cleanup(fixture));

  runPackager(fixture);

  const installed = path.join(fixture.target, 'example-plugin');
  const log = fs.readFileSync(fixture.log, 'utf8').trim().split('\n');
  assert.deepEqual(log, ['example-plugin:ci', 'example-plugin:run build', 'example-plugin:prune --omit=dev']);
  assert.equal(readPackageName(path.join(installed, 'package.json')), 'example-plugin');
  assert.equal(fs.readFileSync(path.join(installed, 'openclaw.plugin.json'), 'utf8'), '{"id":"example-plugin"}\n');
  assert.equal(fs.readFileSync(path.join(installed, 'dist', 'index.js'), 'utf8'), 'export default {};');
  assert.equal(fs.readFileSync(path.join(installed, 'node_modules', 'runtime.js'), 'utf8'), 'runtime');
  assert.equal(fs.existsSync(path.join(installed, 'node_modules', 'dev-only.js')), false);
  assert.equal(fs.existsSync(path.join(installed, 'src')), false);
  assert.equal(fs.existsSync(path.join(fixture.target, 'shared')), false);
  assert.equal(fs.readFileSync(path.join(fixture.target, 'unrelated-extension', 'keep.txt'), 'utf8'), 'unrelated\n');

  const backups = fs.readdirSync(fixture.target).filter((name) => name.startsWith('example-plugin.backup-'));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(fixture.target, backups[0], 'old.txt'), 'utf8'), 'keep as backup\n');
});

function readPackageName(packageFile) {
  return JSON.parse(fs.readFileSync(packageFile, 'utf8')).name;
}

test('does not change an installed extension when its build fails', (t) => {
  const fixture = createFixture();
  t.after(() => cleanup(fixture));

  assert.throws(
    () => runPackager(fixture, { PACKAGER_FAIL_BUILD_FOR: 'example-plugin' }),
    /npm run build failed/,
  );

  assert.equal(fs.readFileSync(path.join(fixture.target, 'example-plugin', 'old.txt'), 'utf8'), 'keep as backup\n');
  assert.equal(fs.readdirSync(fixture.target).some((name) => name.startsWith('example-plugin.backup-')), false);
});

test('omits recursive source maps while preserving non-map runtime files', (t) => {
  const fixture = createFixture();
  t.after(() => cleanup(fixture));

  runPackager(fixture);

  const dist = path.join(fixture.target, 'example-plugin', 'dist');
  const stagedFiles = fs.readdirSync(dist, { recursive: true });
  assert.equal(stagedFiles.some((name) => name.endsWith('.map')), false);
  assert.equal(fs.readFileSync(path.join(dist, 'index.js'), 'utf8'), 'export default {};');
  assert.equal(fs.readFileSync(path.join(dist, 'chunks', 'helper.js'), 'utf8'), 'export {};');
  assert.equal(fs.readFileSync(path.join(dist, 'schema.map.json'), 'utf8'), '{}');
});

test('rejects a source map declared as the plugin entry before replacing the target', (t) => {
  const fixture = createFixture();
  t.after(() => cleanup(fixture));
  const packageFile = path.join(fixture.plugin, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  packageJson.openclaw.extensions = ['./dist/index.js.map'];
  writeJson(packageFile, packageJson);

  assert.throws(() => runPackager(fixture), /source map cannot be an extension entry/);
  assert.equal(fs.readFileSync(path.join(fixture.target, 'example-plugin', 'old.txt'), 'utf8'), 'keep as backup\n');
});

test('rejects a retained runtime alias whose direct target source map is omitted', (t) => {
  const fixture = createFixture();
  t.after(() => cleanup(fixture));

  assert.throws(() => runPackager(fixture, { PACKAGER_DIRECT_MAP_ALIAS: '1' }), /cannot be resolved/);
  assert.equal(fs.readFileSync(path.join(fixture.target, 'example-plugin', 'old.txt'), 'utf8'), 'keep as backup\n');
});

test('rejects a retained runtime alias whose chain crosses an omitted map link', (t) => {
  const fixture = createFixture();
  t.after(() => cleanup(fixture));

  assert.throws(() => runPackager(fixture, { PACKAGER_CHAINED_MAP_ALIAS: '1' }), /cannot be resolved/);
  assert.equal(fs.readFileSync(path.join(fixture.target, 'example-plugin', 'old.txt'), 'utf8'), 'keep as backup\n');
});

test('uses corepack pnpm commands for a pnpm lockfile and prunes development artifacts', (t) => {
  const fixture = createFixture();
  t.after(() => cleanup(fixture));
  usePnpmLock(fixture);

  runPackager(fixture);

  assert.deepEqual(fs.readFileSync(fixture.log, 'utf8').trim().split('\n'), [
    'example-plugin:corepack pnpm install --frozen-lockfile',
    'example-plugin:corepack pnpm run build',
    'example-plugin:corepack pnpm prune --prod',
  ]);
  assert.equal(fs.existsSync(path.join(fixture.target, 'example-plugin', 'node_modules', 'dev-only.js')), false);
});

test('uses npm ci when npm-shrinkwrap is the deterministic lockfile', (t) => {
  const fixture = createFixture();
  t.after(() => cleanup(fixture));
  fs.renameSync(path.join(fixture.plugin, 'package-lock.json'), path.join(fixture.plugin, 'npm-shrinkwrap.json'));

  runPackager(fixture);

  assert.deepEqual(fs.readFileSync(fixture.log, 'utf8').trim().split('\n'), [
    'example-plugin:ci',
    'example-plugin:run build',
    'example-plugin:prune --omit=dev',
  ]);
});

test('keeps the target intact when a pnpm command fails', (t) => {
  const fixture = createFixture();
  t.after(() => cleanup(fixture));
  usePnpmLock(fixture);

  assert.throws(() => runPackager(fixture, { PACKAGER_FAIL_PNPM_FOR: 'example-plugin' }), /corepack pnpm run build failed/);
  assert.equal(fs.readFileSync(path.join(fixture.target, 'example-plugin', 'old.txt'), 'utf8'), 'keep as backup\n');
});

test('rejects packages without a deterministic lockfile before npm can run', (t) => {
  const fixture = createFixture();
  t.after(() => cleanup(fixture));
  fs.rmSync(path.join(fixture.plugin, 'package-lock.json'));

  assert.throws(() => runPackager(fixture), /deterministic lockfile/);
  assert.equal(fs.readFileSync(path.join(fixture.target, 'example-plugin', 'old.txt'), 'utf8'), 'keep as backup\n');
  assert.equal(fs.existsSync(fixture.log), false);
});

test('skips pnpm node_modules entirely when the package has no production dependencies', (t) => {
  const fixture = createFixture();
  t.after(() => cleanup(fixture));
  usePnpmLock(fixture);
  const packageFile = path.join(fixture.plugin, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  delete packageJson.dependencies;
  writeJson(packageFile, packageJson);

  runPackager(fixture, { PACKAGER_PNPM_PRUNE_DANGLING_DEV: '1' });

  assert.equal(fs.existsSync(path.join(fixture.target, 'example-plugin', 'node_modules')), false);
  assert.equal(fs.existsSync(path.join(fixture.target, 'example-plugin', 'dist', 'index.js')), true);
});

test('does not replace an installed extension when the declared entry is missing after build', (t) => {
  const fixture = createFixture();
  t.after(() => cleanup(fixture));

  assert.throws(
    () => runPackager(fixture, { PACKAGER_MISSING_ENTRY_FOR: 'example-plugin' }),
    /does not exist/,
  );

  assert.equal(fs.readFileSync(path.join(fixture.target, 'example-plugin', 'old.txt'), 'utf8'), 'keep as backup\n');
  assert.equal(fs.readdirSync(fixture.target).some((name) => name.startsWith('example-plugin.backup-')), false);
});

test('rejects a target equal to or ancestral to the source before npm can alter either tree', (t) => {
  const fixture = createFixture();
  t.after(() => cleanup(fixture));
  const originalPackage = fs.readFileSync(path.join(fixture.plugin, 'package.json'), 'utf8');
  const originalTarget = fs.readFileSync(path.join(fixture.target, 'example-plugin', 'old.txt'), 'utf8');

  assert.throws(() => runPackagerAt(fixture, fixture.source, fixture.source), /overlap/);
  assert.throws(() => runPackagerAt(fixture, fixture.source, fixture.root), /overlap/);
  assert.throws(() => runPackagerAt(fixture, fixture.source, path.join(fixture.source, 'target')), /overlap/);

  assert.equal(fs.readFileSync(path.join(fixture.plugin, 'package.json'), 'utf8'), originalPackage);
  assert.equal(fs.readFileSync(path.join(fixture.target, 'example-plugin', 'old.txt'), 'utf8'), originalTarget);
  assert.equal(fs.existsSync(fixture.log), false);
});

test('rejects directory entries and external entry symlinks without replacing the target', (t) => {
  const fixture = createFixture();
  t.after(() => cleanup(fixture));
  const packageFile = path.join(fixture.plugin, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  packageJson.openclaw.extensions = ['./dist'];
  writeJson(packageFile, packageJson);

  assert.throws(() => runPackager(fixture), /regular file/);
  assert.equal(fs.readFileSync(path.join(fixture.target, 'example-plugin', 'old.txt'), 'utf8'), 'keep as backup\n');
});

test('rejects an external runtime symlink but preserves an internal runtime symlink', (t) => {
  const external = createFixture();
  t.after(() => cleanup(external));
  const outside = path.join(external.root, 'outside.js');
  fs.writeFileSync(outside, 'outside');
  fs.mkdirSync(path.join(external.plugin, 'dist'), { recursive: true });
  fs.symlinkSync(outside, path.join(external.plugin, 'dist', 'linked.js'));
  const packageJson = JSON.parse(fs.readFileSync(path.join(external.plugin, 'package.json'), 'utf8'));
  packageJson.openclaw.extensions = ['./dist/linked.js'];
  writeJson(path.join(external.plugin, 'package.json'), packageJson);

  assert.throws(() => runPackager(external), /symbolic link|regular file|outside/);
  assert.equal(fs.readFileSync(path.join(external.target, 'example-plugin', 'old.txt'), 'utf8'), 'keep as backup\n');

  const internal = createFixture();
  t.after(() => cleanup(internal));
  fs.mkdirSync(path.join(internal.plugin, 'dist'), { recursive: true });
  fs.symlinkSync('index.js', path.join(internal.plugin, 'dist', 'linked.js'));

  runPackager(internal);
  const linked = path.join(internal.target, 'example-plugin', 'dist', 'linked.js');
  assert.equal(fs.lstatSync(linked).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(linked, 'utf8'), 'export default {};');
});

test('rejects an external symlink nested in production node_modules', (t) => {
  const fixture = createFixture();
  t.after(() => cleanup(fixture));
  const outside = path.join(fixture.root, 'outside-runtime.js');
  fs.writeFileSync(outside, 'outside');

  assert.throws(
    () => runPackager(fixture, { PACKAGER_EXTERNAL_RUNTIME_LINK: outside }),
    /symbolic link points outside/,
  );
  assert.equal(fs.readFileSync(path.join(fixture.target, 'example-plugin', 'old.txt'), 'utf8'), 'keep as backup\n');
});

test('rejects a broken runtime symlink when production dependencies require node_modules', (t) => {
  const fixture = createFixture();
  t.after(() => cleanup(fixture));

  assert.throws(() => runPackager(fixture, { PACKAGER_BROKEN_RUNTIME_LINK: '1' }), /symbolic link cannot be resolved/);
  assert.equal(fs.readFileSync(path.join(fixture.target, 'example-plugin', 'old.txt'), 'utf8'), 'keep as backup\n');
});

test('omits direct, nested, and linked source maps from production node_modules', (t) => {
  const fixture = createFixture();
  t.after(() => cleanup(fixture));

  runPackager(fixture, { PACKAGER_NODE_MODULE_MAPS: '1' });

  const modules = path.join(fixture.target, 'example-plugin', 'node_modules');
  const stagedFiles = fs.readdirSync(modules, { recursive: true });
  assert.equal(stagedFiles.some((name) => name.endsWith('.map')), false);
  assert.equal(fs.readFileSync(path.join(modules, 'runtime.js'), 'utf8'), 'runtime');
  assert.equal(fs.readFileSync(path.join(modules, 'nested', 'helper.js'), 'utf8'), 'export {};');
  assert.equal(fs.readFileSync(path.join(modules, 'schema.map.json'), 'utf8'), '{}');
});

test('rejects a production dependency alias whose direct target map is omitted', (t) => {
  const fixture = createFixture();
  t.after(() => cleanup(fixture));

  assert.throws(
    () => runPackager(fixture, { PACKAGER_NODE_MODULE_DIRECT_ALIAS: '1', PACKAGER_NODE_MODULE_MAPS: '1' }),
    /cannot be resolved/,
  );
  assert.equal(fs.readFileSync(path.join(fixture.target, 'example-plugin', 'old.txt'), 'utf8'), 'keep as backup\n');
});

test('rejects a production dependency alias whose chain crosses an omitted map link', (t) => {
  const fixture = createFixture();
  t.after(() => cleanup(fixture));

  assert.throws(
    () => runPackager(fixture, { PACKAGER_NODE_MODULE_CHAINED_ALIAS: '1', PACKAGER_NODE_MODULE_MAPS: '1' }),
    /cannot be resolved/,
  );
  assert.equal(fs.readFileSync(path.join(fixture.target, 'example-plugin', 'old.txt'), 'utf8'), 'keep as backup\n');
});

test('rewrites an absolute internal runtime symlink to the staged package', (t) => {
  const fixture = createFixture();
  t.after(() => cleanup(fixture));
  const sourceDist = path.join(fixture.plugin, 'dist');
  fs.mkdirSync(sourceDist, { recursive: true });
  fs.writeFileSync(path.join(sourceDist, 'index.js'), 'source placeholder');
  fs.symlinkSync(path.join(sourceDist, 'index.js'), path.join(sourceDist, 'absolute-link.js'));

  runPackager(fixture);

  const installed = path.join(fixture.target, 'example-plugin');
  const link = path.join(installed, 'dist', 'absolute-link.js');
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(link, 'utf8'), 'export default {};');
  assert.equal(fs.realpathSync(link).startsWith(`${fs.realpathSync(path.dirname(link))}${path.sep}`), true);
});

test('rejects every metadata symlink before replacing the installed extension', (t) => {
  for (const targetType of ['internal', 'external']) {
    const fixture = createFixture();
    t.after(() => cleanup(fixture));
    const manifest = path.join(fixture.plugin, 'openclaw.plugin.json');
    const metadataTarget =
      targetType === 'internal' ? path.join(fixture.plugin, 'metadata.json') : path.join(fixture.root, 'metadata.json');
    fs.writeFileSync(metadataTarget, '{"id":"linked"}\n');
    fs.rmSync(manifest);
    fs.symlinkSync(metadataTarget, manifest);

    assert.throws(() => runPackager(fixture), /metadata must be a regular file/);
    assert.equal(fs.readFileSync(path.join(fixture.target, 'example-plugin', 'old.txt'), 'utf8'), 'keep as backup\n');
  }
});

test('rejects a symlinked package manifest before npm runs', (t) => {
  const fixture = createFixture();
  t.after(() => cleanup(fixture));
  const manifest = path.join(fixture.plugin, 'package.json');
  const metadataTarget = path.join(fixture.root, 'package.json');
  fs.renameSync(manifest, metadataTarget);
  fs.symlinkSync(metadataTarget, manifest);

  assert.throws(() => runPackager(fixture), /metadata must be a regular file/);
  assert.equal(fs.readFileSync(path.join(fixture.target, 'example-plugin', 'old.txt'), 'utf8'), 'keep as backup\n');
  assert.equal(fs.existsSync(fixture.log), false);
});

test('does not replace a target while its extension lock is owned by another installer', (t) => {
  const fixture = createFixture();
  t.after(() => cleanup(fixture));
  const lock = path.join(fixture.target, '.example-plugin.install.lock');
  fs.writeFileSync(lock, 'another installer');

  assert.throws(() => runPackager(fixture), /lock/);
  assert.equal(fs.readFileSync(path.join(fixture.target, 'example-plugin', 'old.txt'), 'utf8'), 'keep as backup\n');
  fs.rmSync(lock);
  runPackager(fixture);
  assert.equal(fs.existsSync(lock), false);
});

test('stages beside the target so the final rename stays on the target filesystem', async (t) => {
  const fixture = createFixture();
  t.after(() => cleanup(fixture));
  const prefixes = [];

  await withPackagerEnv(fixture, () =>
    buildAndInstallLocal({
      source: fixture.source,
      target: fixture.target,
      mkdtemp: async (prefix) => {
        prefixes.push(prefix);
        return fs.mkdtempSync(prefix);
      },
    }),
  );

  assert.deepEqual(prefixes, [path.join(fs.realpathSync(path.dirname(fixture.target)), '.byclaw-local-extension-')]);
  assert.equal(fs.readdirSync(path.dirname(fixture.target)).some((name) => name.startsWith('.byclaw-local-extension-')), false);
});

test('uses unique backups even when time is fixed', async (t) => {
  const fixture = createFixture();
  t.after(() => cleanup(fixture));
  const originalNow = Date.now;
  Date.now = () => 1700000000000;
  try {
    await withPackagerEnv(fixture, () => buildAndInstallLocal({ source: fixture.source, target: fixture.target }));
    await withPackagerEnv(fixture, () => buildAndInstallLocal({ source: fixture.source, target: fixture.target }));
  } finally {
    Date.now = originalNow;
  }

  const backups = fs.readdirSync(fixture.target).filter((name) => name.startsWith('example-plugin.backup-'));
  assert.equal(backups.length, 2);
  assert.notEqual(backups[0], backups[1]);
  assert.equal(backups.some((name) => name.endsWith('1700000000000')), false);
});

test('restores only its owned backup when the staged rename fails', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'byclaw-local-rename-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'extension');
  const staged = path.join(root, 'staged');
  fs.mkdirSync(target);
  fs.mkdirSync(staged);
  fs.writeFileSync(path.join(target, 'old.txt'), 'old');
  fs.writeFileSync(path.join(staged, 'new.txt'), 'new');

  assert.throws(
    () =>
      replacePackage(staged, target, {
        makeId: () => 'owned-backup',
        rename: (from, to) => {
          if (from === staged && to === target) throw new Error('staged rename failed');
          fs.renameSync(from, to);
        },
      }),
    /staged rename failed/,
  );

  assert.equal(fs.readFileSync(path.join(target, 'old.txt'), 'utf8'), 'old');
  assert.equal(fs.existsSync(`${target}.backup-owned-backup`), false);
});
