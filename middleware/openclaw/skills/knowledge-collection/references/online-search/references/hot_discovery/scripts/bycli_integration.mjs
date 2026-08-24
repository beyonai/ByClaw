import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';

const BYCLI_TIMEOUT_MS = 60_000;
const LIST_TIMEOUT_MS = 120_000;
const START_CHROME_SCRIPT = '/usr/local/bin/start-chrome.sh';

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

async function defaultFileExists(path) {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function deriveExecutionProfile(meta = {}) {
  const needsBrowser = meta.browser !== false
    || ['cookie', 'intercept', 'ui'].includes(String(meta.strategy || '').toLowerCase());
  return { needsBrowser, transport: needsBrowser ? 'browser' : 'direct' };
}

export function isDaemonHealthy(result) {
  if (!result || result.code !== 0) return false;
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  return /daemon\s*[:=]?\s*running/i.test(output)
    && /extension\s*[:=]?\s*connected/i.test(output);
}

function userAction(kind, message) {
  return { kind, message };
}

export function createBycliIntegration({ run = runCommand, fileExists = defaultFileExists } = {}) {
  const invoke = (cmd, args, timeoutMs) => run(cmd, args, timeoutMs);
  const doctorAndStatus = async () => {
    const doctor = await invoke('bycli', ['doctor'], BYCLI_TIMEOUT_MS);
    // byCLI 生命周期契约：无论 doctor 成败，紧接着读取 daemon 状态。
    const status = await invoke('bycli', ['daemon', 'status'], BYCLI_TIMEOUT_MS);
    return { doctor, status, healthy: doctor.code === 0 && isDaemonHealthy(status) };
  };

  return {
    async loadRuntime({ baselineVersion } = {}) {
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
        compatibility: {
          baselineVersion: baselineVersion || null,
          currentVersion,
          status: !currentVersion ? 'version_unavailable'
            : (baselineVersion && currentVersion !== baselineVersion ? 'version_drift' : 'compatible'),
          ...(versionResult.code !== 0 ? { versionExitCode: versionResult.code } : {}),
        },
      };
    },

    async ensureBridge() {
      const initial = await doctorAndStatus();
      if (initial.healthy) return { ok: true, attempts: 1 };

      const browserStatus = await invoke(
        'openclaw', ['browser', '--browser-profile', 'openclaw', 'status'], BYCLI_TIMEOUT_MS,
      );
      const browserOutput = `${browserStatus.stdout || ''}\n${browserStatus.stderr || ''}`;
      if (browserStatus.code !== 0 || /not running|stopped|not found/i.test(browserOutput)) {
        if (await fileExists(START_CHROME_SCRIPT)) {
          await invoke(START_CHROME_SCRIPT, [], BYCLI_TIMEOUT_MS);
        } else {
          await invoke('openclaw', ['browser', '--browser-profile', 'openclaw', 'start'], BYCLI_TIMEOUT_MS);
        }
      }

      const afterColdStart = await doctorAndStatus();
      if (afterColdStart.healthy) return { ok: true, attempts: 2 };

      await invoke('bycli', ['daemon', 'restart'], BYCLI_TIMEOUT_MS);
      const afterRestart = await invoke('bycli', ['daemon', 'status'], BYCLI_TIMEOUT_MS);
      if (isDaemonHealthy(afterRestart)) return { ok: true, attempts: 3 };

      return {
        ok: false,
        attempts: 3,
        requiresUserAction: userAction(
          'bridge_unavailable',
          'byCLI daemon 或 Chrome Extension 未连接；请检查 Chrome 与 byCLI 扩展后重试。',
        ),
        lastResult: afterRestart,
      };
    },

    invoke,
  };
}
