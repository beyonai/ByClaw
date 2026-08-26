import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
function delegate(childScript, argv) {
  const result = spawnSync(process.execPath, [path.join(SCRIPT_DIR, childScript), ...argv], {
    stdio: ['inherit', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) {
    if (!result.stdout && !result.stderr) process.stderr.write(`${childScript} 执行失败: ${result.error.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (result.status !== 0) process.exitCode = result.status || 1;
}

export function delegatePlatformCommand(command, argv) {
  if (command === 'enterprise') {
    delegate('enterprise-collection.mjs', argv.slice(1));
    return true;
  }
  return false;
}
