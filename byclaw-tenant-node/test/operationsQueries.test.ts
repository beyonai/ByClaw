import { expect, it, vi } from 'vitest';
import OperationsQueries from '../src/application/OperationsQueries.js';

it('所有 SQL 使用配置企业且绑定分页和搜索，不查询正文', async () => {
  const query = vi.fn(async (sql: string, _parameters?: unknown[]) =>
    sql.includes('COUNT(*) AS total')
      ? [{ total: '1' }]
      : [{ id: '9007199254740993', enterpriseId: '10' }],
  );
  const service = new OperationsQueries({ query }, '10');
  const result = await service.groups({
    enterpriseId: '99',
    keyword: '100%_匹配',
    pageNum: 2,
    pageSize: 20,
  });
  expect(result.list[0].id).toBe('9007199254740993');
  expect(result.total).toBe(1);
  expect(
    query.mock.calls.every(
      ([sql, parameters]) => sql.includes('g.enterprise_id=$1') && parameters?.[0] === '10',
    ),
  ).toBe(true);
  expect(query.mock.calls[1][1]).toEqual(['10', '100%_匹配', '', 20, 20]);
  expect(query.mock.calls.map(([sql]) => sql).join(' ')).not.toMatch(
    /session_content|message_content|SELECT \*/i,
  );
});

it('其他企业或不存在的工作组不能读取成员', async () => {
  const query = vi.fn(async () => []);
  const service = new OperationsQueries({ query }, '10');
  await expect(service.members('9007199254740993', { pageNum: 1 })).rejects.toThrow('NOT_FOUND');
  expect(query).toHaveBeenCalledTimes(1);
});

it('关联会话按企业与父工作组分页，只投影资源元信息', async () => {
  const query = vi.fn(async (sql: string, _parameters?: unknown[]) => {
    if (sql.includes('COUNT(*) AS total')) {
      return [{ total: '21' }];
    }
    return [{ id: '9007199254740993', name: '关联会话' }];
  });
  const service = new OperationsQueries({ query }, '10');
  const result = await service.conversations('30', {
    pageNum: 2,
    pageSize: 20,
    enterpriseId: '99',
  });
  expect(result).toMatchObject({ total: 21, totalPages: 2, pageNum: 2 });
  expect(result.list[0].id).toBe('9007199254740993');
  expect(query.mock.calls[2][1]).toEqual(['10', '30', 20, 20]);
  expect(query.mock.calls[2][0]).toContain('child.enterprise_id=$1 AND child.parent_session_id=$2');
  expect(query.mock.calls.map(([sql]) => sql).join(' ')).not.toMatch(
    /session_content|message_content|SELECT \*/i,
  );
});

it('失效工作组和非法分页不能读取关联会话', async () => {
  const query = vi.fn(async () => []);
  const service = new OperationsQueries({ query }, '10');
  await expect(service.conversations('30', { pageSize: 101 })).rejects.toThrow('INVALID_REQUEST');
  expect(query).not.toHaveBeenCalled();
  await expect(service.conversations('30', {})).rejects.toThrow('NOT_FOUND');
  expect(query).toHaveBeenCalledTimes(1);
});

it('非法标识和无界分页在访问数据库前被拒绝', async () => {
  const query = vi.fn(async () => []);
  const service = new OperationsQueries({ query }, '10');
  await expect(service.groups({ pageNum: 1, pageSize: 1000 })).rejects.toThrow('INVALID_REQUEST');
  await expect(service.groups({ pageNum: 1.5 })).rejects.toThrow('INVALID_REQUEST');
  await expect(service.detail('9223372036854775808')).rejects.toThrow('INVALID_ID');
  expect(query).not.toHaveBeenCalled();
});

it('成员查询携带企业、工作组与稳定排序并返回字符串 ID', async () => {
  const query = vi.fn(async (sql: string, _parameters?: unknown[]) => {
    if (sql.includes('COUNT(*) AS total')) {
      return [{ total: '1' }];
    }
    return [{ id: '9007199254740993', type: 'AGENT' }];
  });
  const service = new OperationsQueries({ query }, '10');
  const result = await service.members('30', { pageNum: 3, pageSize: 10 });
  expect(query.mock.calls[2][1]).toEqual(['10', '30', 10, 20]);
  expect(query.mock.calls[2][0]).toContain('m.com_acct_id=$1 AND m.session_id=$2');
  expect(result.list[0].id).toBe('9007199254740993');
});
