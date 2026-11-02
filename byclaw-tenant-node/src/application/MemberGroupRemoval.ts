import { createHash } from 'node:crypto';
import { ServiceError } from '../interfaces/contracts/errors.js';
import { requireId } from '../domain/values.js';
import { lockSessions } from '../infrastructure/persistence/session-locks.js';
import type { ConnectionManager } from './connection-manager.js';
import type { SqlSession } from './database-ports.js';

type Transfer = { sessionId: string; userId: string; name: string };

/** 服务间企业移除适配；身份和可接任成员由 BE 校验，Node 原子交接并退群，保留业务数据。 */
export default class MemberGroupRemoval {
  constructor(
    private readonly connection: ConnectionManager,
    private readonly enterpriseId: string,
  ) {}

  async snapshot(input: unknown) {
    const { userId } = this.request(input);
    return this.connection.write((db) => this.readSnapshot(db, userId));
  }

  async apply(input: unknown) {
    const request = this.request(input);
    const { userId, expectedRevision, transfers } = request;
    if (typeof expectedRevision !== 'string' || !Array.isArray(transfers)) {
      throw new ServiceError(400, 'INVALID_REQUEST');
    }
    const targets: Transfer[] = transfers.map((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new ServiceError(400, 'INVALID_REQUEST');
      }
      const target = value as Record<string, unknown>;
      if (typeof target.name !== 'string' || target.name.length > 255) {
        throw new ServiceError(400, 'INVALID_REQUEST');
      }
      return {
        sessionId: requireId(target.sessionId),
        userId: requireId(target.userId),
        name: target.name,
      };
    });
    return this.connection.write(async (db) => {
      const initial = await this.readSnapshot(db, userId);
      await lockSessions(
        db,
        initial.rows.map((row) => String(row.sessionId)),
      );
      const current = await this.readSnapshot(db, userId);
      if (current.revision !== expectedRevision) {
        throw new ServiceError(409, 'REVISION_CONFLICT');
      }
      const owned = current.rows.filter((row) => row.userId === userId && row.role === 'OWNER');
      if (
        targets.length !== owned.length ||
        new Set(targets.map((target) => target.sessionId)).size !== owned.length
      ) {
        throw new ServiceError(409, 'REVISION_CONFLICT');
      }
      // 按工作组顺序完成交接；任意失败使全部群变更回滚，不留下无群主工作组。
      for (const owner of owned) {
        const target = targets.find((candidate) => candidate.sessionId === owner.sessionId);
        if (!target || target.userId === userId) {
          throw new ServiceError(400, 'INVALID_REQUEST');
        }
        const existing = current.rows.find(
          (row) => row.sessionId === owner.sessionId && row.userId === target.userId,
        );
        if (!existing) {
          throw new ServiceError(409, 'REVISION_CONFLICT');
        }
        await db.query(
          `UPDATE byai.byai_session_member SET user_role='OWNER'
           WHERE byai_session_member_id=$1 AND com_acct_id=$2`,
          [existing.memberId, this.enterpriseId],
        );
      }
      await db.query(
        `DELETE FROM byai.byai_session_member m WHERE m.com_acct_id=$1
         AND m.mem_obj_type='USER' AND m.mem_obj_id=$2
         AND m.session_id=ANY($3::bigint[])
         AND EXISTS (SELECT 1 FROM byai.byai_session g WHERE g.session_id=m.session_id
           AND g.enterprise_id=$1 AND g.session_type='hs_as' AND COALESCE(g.state,'ACTIVE')='ACTIVE')`,
        [this.enterpriseId, userId, [...new Set(current.rows.map((row) => String(row.sessionId)))]],
      );
      // 只处理已锁定且已确认的工作组；并发新增的身份触发重载，不能直接删掉新群主。
      if ((await this.readSnapshot(db, userId)).rows.length > 0) {
        throw new ServiceError(409, 'REVISION_CONFLICT');
      }
      return { completed: true };
    });
  }

  private request(input: unknown) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new ServiceError(400, 'INVALID_REQUEST');
    }
    const request = input as Record<string, unknown>;
    return {
      userId: requireId(request.userId),
      expectedRevision: request.expectedRevision,
      transfers: request.transfers,
    };
  }

  private async readSnapshot(db: SqlSession, userId: string) {
    const rows = await db.query(
      `SELECT g.session_id::text AS "sessionId", g.session_name AS "groupName",
       m.byai_session_member_id::text AS "memberId", m.mem_obj_id::text AS "userId",
       m.user_role AS role, m.mem_name AS name,
       CAST(EXTRACT(EPOCH FROM m.create_time) * 1000 AS BIGINT)::text AS "joinedAt",
       (SELECT e.ext_param_value FROM byai.byai_session_ext e WHERE e.session_id=g.session_id
         AND e.ext_param_code='group_admin_since_' || m.byai_session_member_id LIMIT 1) AS "adminSince"
       FROM byai.byai_session g JOIN byai.byai_session_member m ON m.session_id=g.session_id
       WHERE g.enterprise_id=$1 AND g.session_type='hs_as' AND COALESCE(g.state,'ACTIVE')='ACTIVE'
         AND m.com_acct_id=$1 AND m.mem_obj_type='USER'
         AND EXISTS (SELECT 1 FROM byai.byai_session_member target WHERE target.session_id=g.session_id
           AND target.com_acct_id=$1 AND target.mem_obj_type='USER' AND target.mem_obj_id=$2)
       ORDER BY g.session_id,m.byai_session_member_id`,
      [this.enterpriseId, userId],
    );
    return { rows, revision: createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
  }
}
