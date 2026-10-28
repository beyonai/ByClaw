import { afterEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/interfaces/http/app.js';
import type { HttpServices } from '../src/interfaces/http/app.js';
import { config } from './fixtures.js';

const apps: ReturnType<typeof createApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

it('企业移除仅接受可信服务和本租户代际，额度耗尽不阻止权限管理', async () => {
  const removal = {
    snapshot: vi.fn(async () => ({ rows: [], revision: 'a'.repeat(64) })),
    apply: vi.fn(async () => ({ completed: true })),
  };
  const execution = vi.fn(async () => {
    throw new Error('execution disabled');
  });
  const services = {
    commands: {},
    history: {},
    sessions: {},
    schema: {},
    memberGroupRemoval: removal,
    requireExecution: execution,
    connected: () => true,
    ready: () => true,
    provisioned: () => true,
    schemaState: () => ({}),
    health: () => ({}),
  } as unknown as HttpServices;
  const app = createApp(
    { ...config, transport: 'http', internalToken: 'fixture-only' },
    services,
    undefined,
    { logger: false },
  );
  apps.push(app);
  const headers = {
    'x-enterprise-id': '10',
    'x-tenant-generation': '7',
    'x-byclaw-internal-token': 'fixture-only',
  };
  const url = '/internal/v1/member-group-removal/apply';
  expect(
    (
      await app.inject({
        method: 'POST',
        url,
        payload: {},
        headers: { ...headers, 'x-byclaw-internal-token': 'bad' },
      })
    ).statusCode,
  ).toBe(401);
  expect(
    (
      await app.inject({
        method: 'POST',
        url,
        payload: {},
        headers: { ...headers, 'x-enterprise-id': '11' },
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await app.inject({
        method: 'POST',
        url,
        payload: {},
        headers: { ...headers, 'x-tenant-generation': '6' },
      })
    ).statusCode,
  ).toBe(403);
  expect(removal.apply).not.toHaveBeenCalled();
  expect((await app.inject({ method: 'POST', url, payload: {}, headers })).statusCode).toBe(200);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/internal/v1/member-group-removal/snapshot',
        payload: {},
        headers,
      })
    ).statusCode,
  ).toBe(200);
  expect(execution).not.toHaveBeenCalled();
  expect(removal.apply).toHaveBeenCalledTimes(1);
});
