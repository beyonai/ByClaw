import { afterEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/interfaces/http/app.js';
import type { HttpServices } from '../src/interfaces/http/app.js';
import { config } from './fixtures.js';

const apps: ReturnType<typeof createApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
});

function setup(ready = true) {
  const operations = {
    groups: vi.fn(async () => ({ list: [], total: 0 })),
    detail: vi.fn(async () => ({ id: '30', enterpriseId: '10' })),
    members: vi.fn(async () => ({ list: [], total: 0 })),
    conversations: vi.fn(async () => ({ list: [], total: 0 })),
  };
  const services = {
    commands: {},
    history: {},
    sessions: {},
    schema: {},
    operations,
    connected: () => true,
    ready: () => ready,
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
  return { app, operations };
}

it('查询不伪造用户身份，仍要求服务令牌、企业、代际和就绪门禁', async () => {
  const headers = {
    'x-enterprise-id': '10',
    'x-tenant-generation': '7',
    'x-byclaw-internal-token': 'fixture-only',
  };
  const url = '/internal/v1/operations/groups/30';
  const { app, operations } = setup();
  expect(
    (await app.inject({ url, headers: { ...headers, 'x-byclaw-internal-token': 'bad' } }))
      .statusCode,
  ).toBe(401);
  expect(
    (await app.inject({ url, headers: { ...headers, 'x-enterprise-id': '11' } })).statusCode,
  ).toBe(403);
  expect(
    (await app.inject({ url, headers: { ...headers, 'x-tenant-generation': '6' } })).statusCode,
  ).toBe(403);
  expect((await setup(false).app.inject({ url, headers })).statusCode).toBe(503);
  expect(operations.detail).not.toHaveBeenCalled();
  expect((await app.inject({ url, headers })).statusCode).toBe(200);
  expect(operations.detail).toHaveBeenCalledExactlyOnceWith('30');
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/internal/v1/operations/groups/query',
        headers,
        payload: {},
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/internal/v1/operations/groups/30/members/query',
        headers,
        payload: {},
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/internal/v1/operations/groups/30/conversations/query',
        headers,
        payload: { pageNum: 2 },
      })
    ).statusCode,
  ).toBe(200);
  expect(operations.conversations).toHaveBeenCalledExactlyOnceWith('30', { pageNum: 2 });
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/internal/v1/operations/groups/30/conversations/query',
        headers: { ...headers, 'x-enterprise-id': '11' },
        payload: {},
      })
    ).statusCode,
  ).toBe(403);
  expect(operations.conversations).toHaveBeenCalledTimes(1);
});
