import { spawn } from 'node:child_process';

// No shell and no raw diagnostics escape this module's caller.
export function runProcess(bin, args, {
  timeoutMs = 150_000, maxOutputBytes = 16 * 1024 * 1024, monitor,
} = {}) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let stdout = '';
    let stderr = '';
    let bytes = 0;
    let failure;
    let checking = false;
    const stop = (reason) => {
      failure ||= reason;
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch { /* Child may have already exited. */ }
    };
    const timer = setTimeout(() => stop('UPSTREAM_UNAVAILABLE'), timeoutMs);
    const watcher = monitor && setInterval(async () => {
      if (checking || failure) return;
      checking = true;
      try { await monitor(); } catch { stop('DOWNLOAD_LIMIT'); }
      finally { checking = false; }
    }, 25);
    const collect = (key) => (chunk) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > maxOutputBytes) return stop('OUTPUT_LIMIT');
      if (key === 'stdout') stdout += chunk.toString();
      else stderr += chunk.toString();
    };
    // Preserve UTF-8 across pipe chunks (mail bodies commonly contain CJK text).
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', collect('stdout'));
    child.stderr.on('data', collect('stderr'));
    child.on('error', () => { failure ||= 'UPSTREAM_UNAVAILABLE'; });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (watcher) clearInterval(watcher);
      resolve({ code, stdout: failure ? '' : stdout, stderr: failure ? '' : stderr, failure });
    });
  });
}
