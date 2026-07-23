import fs from 'fs';
import path from 'path';

/**
 * 在 Umi 配置阶段加载 monorepo 根目录与 byclaw-fe 目录下的 .env，
 * 仅当对应 key 在 process.env 中尚未设置时才写入（shell / CI 已导出的变量优先）。
 */
export function loadMonorepoEnvForUmi(): void {
  // 先 byclaw-fe/.env 再仓库根 .env：本地覆盖共享默认值；已在 process.env 中的（如 shell export）一律不覆盖
  const candidates = [
    path.join(__dirname, '../.env'),
    path.join(__dirname, '../../.env'),
  ];

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) {
      continue;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }
      const eq = line.indexOf('=');
      if (eq <= 0) {
        continue;
      }
      const key = line.slice(0, eq).trim();
      if (!key) {
        continue;
      }
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      // HOST is reserved by Webpack Dev Server / Umi for binding address and HMR WebSocket,
      // so we never set process.env.HOST. But its value is also the remote backend host, which
      // the file-remote dev proxy needs when BE runs locally without the NFS mount. Stash it
      // under a non-reserved key so the proxy can target the remote server.
      if (key === 'HOST') {
        if (process.env.BYCLAW_REMOTE_BE_HOST === undefined) {
          process.env.BYCLAW_REMOTE_BE_HOST = val;
        }
        continue;
      }
      if (process.env[key] !== undefined) {
        continue;
      }
      process.env[key] = val;
    }
  }
}
