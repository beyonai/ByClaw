const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// This prepare script keeps `pnpm install` working when `byclaw-fe` is
// installed from its own subdirectory. In that case Husky may not be able to
// locate the repository's `.git` directory or a root-level `.husky` folder,
// which would otherwise make the install fail with ELIFECYCLE.
//
// Behavior:
// 1. If the current directory is not inside a Git repository, skip Husky.
// 2. If the repository does not define a root `.husky` directory, skip Husky.
// 3. Only install Husky hooks when both conditions above are satisfied.
const projectRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(projectRoot, '..');
const huskyDir = path.join(repoRoot, '.husky');
const huskyRuntimeDir = path.join(huskyDir, '_');
const huskyRuntimeScript = path.join(huskyRuntimeDir, 'husky.sh');
const huskySourceScript = path.join(projectRoot, 'node_modules', 'husky', 'husky.sh');

function hasGitRepository() {
  const result = spawnSync('git', ['rev-parse', '--git-dir'], {
    cwd: projectRoot,
    stdio: 'ignore',
  });

  return result.status === 0;
}

if (!hasGitRepository()) {
  console.log('husky - skip install, Git repository not detected');
  process.exit(0);
}

if (!fs.existsSync(huskyDir)) {
  console.log(`husky - skip install, hooks directory not found at ${huskyDir}`);
  process.exit(0);
}

if (!fs.existsSync(huskySourceScript)) {
  console.log(`husky - skip install, runtime script not found at ${huskySourceScript}`);
  process.exit(0);
}

fs.mkdirSync(huskyRuntimeDir, { recursive: true });
fs.writeFileSync(path.join(huskyRuntimeDir, '.gitignore'), '*\n');
fs.copyFileSync(huskySourceScript, huskyRuntimeScript);

// Keep the Git hooks path pinned to the repository root so commits made from
// either the repo root or the frontend subdirectory resolve the same hooks.
const configResult = spawnSync('git', ['config', 'core.hooksPath', huskyDir], {
  cwd: projectRoot,
  stdio: 'inherit',
});

if (configResult.status !== 0) {
  process.exit(configResult.status || 1);
}

console.log('husky - runtime installed at repo root');
