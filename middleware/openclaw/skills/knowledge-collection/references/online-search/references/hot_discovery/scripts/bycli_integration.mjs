import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BYCLI_TIMEOUT_MS = 30_000;
const LIST_TIMEOUT_MS = 60_000;
const BRIDGE_TIMEOUT_MS = 60_000;
const DEFAULT_BRIDGE_SCRIPT = '/app/skills/bycli/scripts/bridge-bootstrap.mjs';
const LOCAL_BRIDGE_SCRIPT = fileURLToPath(new URL(
  '../../../../../../bycli/scripts/bridge-bootstrap.mjs',
  import.meta.url,
));

export function runCommand(cmd, args, timeoutMs = BYCLI_TIMEOUT_MS) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const timedOut = Boolean(err && (err.killed || err.code === 'ETIMEDOUT'));
        resolve({
          code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
          rawErrorCode: err?.code ?? null,
          stdout: stdout || '',
          stderr: stderr || '',
          killed: Boolean(err && err.killed),
          timedOut,
        });
      });
  });
}

export function deriveExecutionProfile(meta = {}) {
  const needsBrowser = meta.browser !== false
    || ['cookie', 'intercept', 'ui'].includes(String(meta.strategy || '').toLowerCase());
  return { needsBrowser, transport: needsBrowser ? 'browser' : 'direct' };
}

function userAction(kind, message) {
  return { kind, message };
}

export function createBycliIntegration({
  run = runCommand,
  environment = process.env,
  fileExists = existsSync,
  containerBridgeScript = DEFAULT_BRIDGE_SCRIPT,
  localBridgeScript = LOCAL_BRIDGE_SCRIPT,
  bridgeScript = environment.BYCLI_BRIDGE_BOOTSTRAP_SCRIPT
    || (fileExists(containerBridgeScript) ? containerBridgeScript : localBridgeScript),
} = {}) {
  const invoke = (cmd, args, timeoutMs) => run(cmd, args, timeoutMs);

  return {
    async loadRuntime() {
      const versionResult = await invoke('bycli', ['--version'], BYCLI_TIMEOUT_MS);
      const currentVersion = versionResult.code === 0 ? versionResult.stdout.trim() || null : null;
      const list = await invoke('bycli', ['list', '-f', 'json'], LIST_TIMEOUT_MS);
      if (list.code !== 0) {
        throw new Error(`bycli list 失败 (exit ${list.code}): ${list.stderr.slice(0, 300)}`);
      }
      let rows;
      try {
        rows = JSON.parse(list.stdout);
      } catch (error) {
        throw new Error(`bycli list 输出不是合法 JSON: ${error.message}`);
      }
      if (!Array.isArray(rows)) throw new Error('bycli list 输出不是数组');
      return {
        catalog: new Map(rows.map((command) => [`${command.site}/${command.name}`, command])),
        version: currentVersion,
        ...(versionResult.code !== 0 ? { versionExitCode: versionResult.code } : {}),
      };
    },

    async ensureBridge() {
      const result = await invoke(
        process.execPath,
        [bridgeScript, '--format', 'json'],
        BRIDGE_TIMEOUT_MS,
      );
      let bridge;
      try {
        bridge = JSON.parse(result.stdout || '');
      } catch {
        bridge = {
          ok: false,
          code: 'BRIDGE_UNAVAILABLE',
          reason: result.timedOut ? 'BRIDGE_COMMAND_TIMEOUT' : 'BRIDGE_OUTPUT_INVALID',
        };
      }
      if (bridge?.ok === true && bridge.code === 'BRIDGE_READY') {
        return { ok: true, attempts: bridge.checks || 1, bridge };
      }
      const busy = bridge?.code === 'BRIDGE_RECOVERY_BUSY';
      return {
        ok: false,
        attempts: bridge?.checks || 0,
        requiresUserAction: userAction(
          busy ? 'bridge_recovery_busy' : 'bridge_unavailable',
          busy
            ? '另一任务正在恢复 byCLI 浏览器桥接；请稍后重新发起。'
            : 'byCLI daemon 或 Chrome Extension 未连接；请检查托管 Chrome 与 byCLI 扩展后重试。',
        ),
        bridge,
      };
    },

    invoke,
  };
}
