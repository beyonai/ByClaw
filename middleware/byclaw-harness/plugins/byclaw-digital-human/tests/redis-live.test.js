import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { setTimeout } from 'node:timers/promises';
import { createRedis, RegistryKeys } from '@byclaw/by-framework';
import { resolveArtifactBackend } from '../src/backend.js';

// Explicitly opt into a preloaded, disposable Redis image; never pull an image
// or connect this test to a deployed Redis instance.
const image = process.env.DIGITAL_HUMAN_REDIS_TEST_IMAGE;
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

async function availablePorts() {
  for (let attempt = 0; attempt < 50; attempt++) {
    const base = 17000 + Math.floor(Math.random() * 2000);
    const servers = [];
    try {
      for (let i = 0; i < 4; i++) {
        const server = createServer();
        servers.push(server);
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(base + i, '127.0.0.1', resolve); });
      }
      return Array.from({ length: 4 }, (_, i) => base + i);
    } catch {
      // Try another local range; Redis ports stay private to this test container.
    } finally { for (const server of servers) if (server.listening) await new Promise(resolve => server.close(resolve)); }
  }
  throw new Error('No free disposable Redis ports');
}

test('real Redis standalone and three-master Cluster resolve current user auth and service discovery', { skip: !image, timeout: 60000 }, async (t) => {
  const ports = await availablePorts();
  const name = `digital-human-redis-test-${randomUUID()}`;
  const [standalone, ...cluster] = ports;
  const commands = ports.map((port) => `redis-server --port ${port} --bind 0.0.0.0 --protected-mode no --save '' --appendonly no --daemonize yes${port === standalone ? '' : ` --cluster-enabled yes --cluster-config-file /tmp/nodes-${port}.conf --cluster-announce-ip 127.0.0.1 --cluster-announce-port ${port} --cluster-node-timeout 1000`}`);
  t.after(() => docker('rm', '-f', name));
  docker('run', '--pull=never', '--rm', '-d', '--name', name,
    ...ports.flatMap(port => ['-p', `127.0.0.1:${port}:${port}`]), image, 'sh', '-c', `${commands.join(' && ')} && exec tail -f /dev/null`);
  for (const port of ports) {
    for (let attempt = 0; ; attempt++) {
      try { assert.equal(docker('exec', name, 'redis-cli', '-p', String(port), 'PING'), 'PONG'); break; }
      catch (error) { if (attempt === 50) throw error; await setTimeout(100); }
    }
  }
  docker('exec', name, 'redis-cli', '--cluster', 'create', ...cluster.map(port => `127.0.0.1:${port}`), '--cluster-replicas', '0', '--cluster-yes');
  const previous = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('REDIS_')));
  t.after(() => {
    for (const key of Object.keys(process.env)) if (key.startsWith('REDIS_')) delete process.env[key];
    Object.assign(process.env, previous);
  });
  for (const mode of ['standalone', 'cluster']) {
    for (const key of Object.keys(process.env)) if (key.startsWith('REDIS_')) delete process.env[key];
    Object.assign(process.env, { REDIS_HOST: '127.0.0.1', REDIS_PORT: String(standalone), REDIS_MODE: mode,
      REDIS_KEY_SCHEMA_VERSION: mode === 'cluster' ? 'v2' : 'v1',
      ...(mode === 'cluster' ? { REDIS_CLUSTER_HOST: cluster.map(port => `127.0.0.1:${port}`).join(',') } : {}) });
    const seed = createRedis({ lazyConnect: true });
    try {
      if (seed.status === 'wait') await seed.connect();
      else if (seed.status !== 'ready') await new Promise((resolve, reject) => { seed.once('ready', resolve); seed.once('error', reject); });
      await seed.set('SHARE_BFM_USER_CODE_alice', '1');
      await seed.set('SHARE_BFM_USER_CODE_bob', '2');
      await seed.hset('user:1:login:auth', 'Beyond-Token', 'alice-login');
      await seed.hset('user:2:login:auth', 'Beyond-Token', 'bob-login');
      await seed.hset(RegistryKeys.sd_instance_details('ByaiService'), 'fixture', JSON.stringify({ host: 'backend.internal', port: 8080, protocol: 'http', path_prefix: 'byaiService' }));
      const options = { environment: {} };
      assert.equal((await resolveArtifactBackend('alice', undefined, options)).token, 'alice-login', mode);
      assert.equal((await resolveArtifactBackend('bob', undefined, options)).token, 'bob-login', mode);
      await seed.hset('user:1:login:auth', 'Beyond-Token', 'rotated-login');
      const result = await resolveArtifactBackend('alice', undefined, options);
      assert.equal(result.token, 'rotated-login', mode);
      assert.equal(result.url, 'http://backend.internal:8080/byaiService/open/api/v1/artifacts');
      await seed.hdel('user:1:login:auth', 'Beyond-Token');
      await assert.rejects(resolveArtifactBackend('alice', undefined, options), /DIGITAL_HUMAN_BACKEND_UNAVAILABLE/);
      assert.equal(await seed.ping(), 'PONG', 'Resolver must not close another owner connection');
      t.diagnostic(`${mode}: live auth lookup, user isolation, token rotation, missing login, service discovery and connection ownership passed`);
    } finally { seed.disconnect(); }
  }
});
