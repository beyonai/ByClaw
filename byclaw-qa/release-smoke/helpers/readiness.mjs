import { setTimeout as delay } from 'node:timers/promises';
import { appUrl } from '../config.mjs';

export async function waitReady(config, fetchImpl = fetch, wait = delay) {
  const deadline = Date.now() + config.readyTimeoutMs;
  let reason = '服务尚未就绪';
  while (Date.now() < deadline) {
    try {
      const remaining = Math.max(1, Math.min(10000, deadline - Date.now()));
      const get = (url) => fetchImpl(url, { signal: AbortSignal.timeout(remaining), headers: { 'Cache-Control': 'no-cache' } });
      const [portal, health, metadata] = await Promise.all([
        get(config.baseUrl), get(new URL('/byaiService/actuator/health', config.baseUrl).href),
        get(appUrl(config, `build-info.json?smoke=${Date.now()}`)),
      ]);
      if (!portal.ok || !health.ok) { reason = '页面或后端健康检查未通过'; }
      else {
        const healthData = await health.json();
        let info = {};
        try { if (metadata.ok) info = await metadata.json(); } catch { /* Old builds may lack metadata. */ }
        const actual = typeof info.version === 'string' ? info.version : '';
        if (healthData.status !== 'UP') reason = '后端健康状态不是 UP';
        else if (config.expectedVersion && actual !== config.expectedVersion) reason = '目标环境尚未部署指定版本';
        else return { actualVersion: actual || '未提供版本元数据', commit: String(info.commitFull || info.commit || '') };
      }
    } catch { reason = '无法访问目标环境或读取健康状态'; }
    await wait(Math.min(3000, Math.max(0, deadline - Date.now())));
  }
  throw new Error(`等待服务就绪超时：${reason}`);
}
