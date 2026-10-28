import { describe, expect, it, vi } from 'vitest';
import MemberGroupRemoval from '../src/application/MemberGroupRemoval.js';
import type { ConnectionManager } from '../src/application/connection-manager.js';
import type { SqlSession } from '../src/application/database-ports.js';

function fixture() {
  const rows = [
    {
      sessionId: '101',
      groupName: '研究组',
      memberId: '201',
      userId: '9',
      role: 'OWNER',
      name: '原群主',
    },
    {
      sessionId: '101',
      groupName: '研究组',
      memberId: '202',
      userId: '8',
      role: 'ADMIN',
      name: '接任人',
    },
  ];
  const committed: string[] = [];
  let removed = false;
  let pending: string[] = [];
  const lock = vi.fn(async () => {});
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith('SELECT')) {
      return removed ? [] : rows;
    }
    if (sql.startsWith('DELETE')) {
      removed = true;
    }
    pending.push(sql);
    return [];
  });
  const connection = {
    write: async <Result>(work: (db: SqlSession) => Promise<Result>) => {
      pending = [];
      const beforeRemoval = removed;
      try {
        const result = await work({ query, lock });
        committed.push(...pending);
        return result;
      } catch (error) {
        removed = beforeRemoval;
        throw error;
      }
    },
  } as unknown as ConnectionManager;
  return { rows, committed, lock, query, service: new MemberGroupRemoval(connection, '42') };
}

describe('企业成员移除时工作组交接', () => {
  it('同一事务先交接再退群，保留工作组、任务和文件', async () => {
    const { service, committed, lock } = fixture();
    const plan = await service.snapshot({ userId: '9' });
    await expect(
      service.apply({
        userId: '9',
        expectedRevision: plan.revision,
        transfers: [{ sessionId: '101', userId: '8', name: '接任人' }],
      }),
    ).resolves.toEqual({ completed: true });
    expect(lock).toHaveBeenCalledWith('session:101');
    expect(committed).toHaveLength(2);
    expect(committed[0]).toMatch(/SET user_role='OWNER'/);
    expect(committed[1]).toMatch(/^DELETE FROM byai.byai_session_member/);
  });

  it('接任人不在群内时拒绝交接，不新增成员或解散工作组', async () => {
    const { service, committed } = fixture();
    const plan = await service.snapshot({ userId: '9' });
    await expect(
      service.apply({
        userId: '9',
        expectedRevision: plan.revision,
        transfers: [{ sessionId: '101', userId: '7', name: '所有者' }],
      }),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(committed).toEqual([]);
  });

  it('无群主职责无需交接，但仍移除普通群成员关系', async () => {
    const { service, rows, committed } = fixture();
    rows[0] = { ...rows[0], role: 'MEMBER' };
    const plan = await service.snapshot({ userId: '9' });
    await service.apply({ userId: '9', expectedRevision: plan.revision, transfers: [] });
    expect(committed).toHaveLength(1);
    expect(committed[0]).toMatch(/^DELETE FROM byai.byai_session_member/);
  });

  it('预览后角色变化或漏掉交接时不提交任何变更', async () => {
    const { service, rows, committed } = fixture();
    const plan = await service.snapshot({ userId: '9' });
    await expect(
      service.apply({ userId: '9', expectedRevision: plan.revision, transfers: [] }),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    rows[1] = { ...rows[1], role: 'MEMBER' };
    await expect(
      service.apply({
        userId: '9',
        expectedRevision: plan.revision,
        transfers: [{ sessionId: '101', userId: '8', name: '接任人' }],
      }),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(committed).toEqual([]);
  });

  it('禁止把群主转回被移除成员，失败事务不留下修改', async () => {
    const { service, committed } = fixture();
    const plan = await service.snapshot({ userId: '9' });
    await expect(
      service.apply({
        userId: '9',
        expectedRevision: plan.revision,
        transfers: [{ sessionId: '101', userId: '9', name: '原群主' }],
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(committed).toEqual([]);
  });
});
