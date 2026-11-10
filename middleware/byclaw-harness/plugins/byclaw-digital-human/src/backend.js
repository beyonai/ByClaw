import { createRedis, RegistryKeys } from '@byclaw/by-framework';

const unavailable = () => new Error('DIGITAL_HUMAN_BACKEND_UNAVAILABLE: 请检查后端地址、Redis 配置及当前用户登录态。');

function endpoint(base) {
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw unavailable();
  url.pathname = `${url.pathname.replace(/\/+$/u, '') || '/byaiService'}/open/api/v1/artifacts`;
  return url.href;
}

/** Same user-code -> user-ID -> live login-token lookup as project-cloud-knowledge.
 * Every client is privately owned by this operation, including Cluster handles. */
export async function resolveArtifactBackend(userCode, signal, { environment = process.env, createClient = createRedis } = {}) {
  signal?.throwIfAborted();
  if (typeof userCode !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(userCode) || userCode.includes('..')) throw unavailable();
  const timeout = AbortSignal.timeout(5000);
  const operationSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let client;
  let onAbort;
  try {
    client = createClient({ lazyConnect: true, connectTimeout: 5000, commandTimeout: 5000,
      maxRetriesPerRequest: 0, retryStrategy: () => null, reconnectOnError: () => false });
    client.on('error', () => {});
    // createRedis returns an ioredis Cluster for cluster deployments. Bound its
    // discovery/reconnect loop too; single-key reads retain the deployed keys.
    if (typeof client.nodes === 'function') {
      client.options.clusterRetryStrategy = () => null;
      client.options.slotsRefreshTimeout = 5000;
    }
    const work = async () => {
      // The framework's standalone client honors lazyConnect; its Cluster
      // starts connecting immediately. Do not call connect() twice on Cluster.
      if (client.status === 'wait' || client.status === undefined) await client.connect();
      else if (client.status !== 'ready') await new Promise((resolve, reject) => {
        client.once('ready', resolve);
        client.once('error', reject);
        client.once('end', () => reject(unavailable()));
      });
      const userId = (await client.get(`SHARE_BFM_USER_CODE_${userCode}`))?.trim();
      if (!userId) throw unavailable();
      const token = (await client.hget(`user:${userId}:login:auth`, 'Beyond-Token'))?.trim();
      if (!token || /[\u0000-\u001f\u007f]/u.test(token)) throw unavailable();
      let base = environment.BYCLAW_DSH_BASE_URL?.trim() || environment.BYAI_SERVICE_BASE_URL?.trim();
      if (!base) {
        const service = environment.BE_DOMAINNAME?.trim() || 'ByaiService';
        const records = await client.hgetall(RegistryKeys.sd_instance_details(service));
        const instances = Object.values(records).flatMap((raw) => {
          try {
            const value = JSON.parse(raw);
            if (typeof value.host !== 'string' || !/^[A-Za-z0-9.:[\]-]+$/u.test(value.host)
              || !Number.isInteger(Number(value.port)) || Number(value.port) < 1 || Number(value.port) > 65535) return [];
            return [value];
          } catch { return []; }
        }).sort((a, b) => (Number(b.weight) || 1) - (Number(a.weight) || 1));
        const instance = instances[0];
        if (!instance) throw unavailable();
        const prefix = String(instance.path_prefix ?? 'byaiService').replace(/^\/+|\/+$/gu, '');
        base = `${instance.protocol || 'http'}://${instance.host}:${instance.port}/${prefix}`;
      }
      return { url: endpoint(base), token, userCode };
    };
    return await Promise.race([work(), new Promise((_, reject) => {
      onAbort = () => reject(operationSignal.reason);
      operationSignal.addEventListener('abort', onAbort, { once: true });
      if (operationSignal.aborted) onAbort();
    })]);
  } catch {
    signal?.throwIfAborted();
    throw unavailable();
  } finally {
    if (onAbort) operationSignal.removeEventListener('abort', onAbort);
    client?.disconnect();
  }
}
