import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function tempCase(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const outputDir = join(root, 'output');
  await chmod(root, 0o700);
  await mkdir(outputDir, { mode: 0o700 });
  return { root, outputDir };
}

export async function executable(root, name, source) {
  const path = join(root, name);
  await writeFile(path, source, { mode: 0o700 });
  await chmod(path, 0o700);
  return path;
}

export function runNode(script, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      env: { ...process.env, ...env },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];

    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      const stdoutText = Buffer.concat(stdout).toString('utf8');
      const stderrText = Buffer.concat(stderr).toString('utf8');
      let json;
      try {
        json = JSON.parse(stdoutText);
      } catch {
        json = undefined;
      }
      resolve({ code, stdout: stdoutText, stderr: stderrText, json });
    });
  });
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function assertPrivateTree(root) {
  assert.equal((await stat(root)).mode & 0o777, 0o700, `${root} mode`);
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      await assertPrivateTree(path);
    } else {
      assert.equal((await stat(path)).mode & 0o777, 0o600, `${path} mode`);
    }
  }
}
