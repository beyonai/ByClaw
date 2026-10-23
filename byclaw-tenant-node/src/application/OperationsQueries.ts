import type { SqlSession } from './database-ports.js';
import { requireId } from '../domain/values.js';
import { ServiceError } from '../interfaces/contracts/errors.js';

interface PageQuery {
  pageNum: number;
  pageSize: number;
  keyword: string;
  status: string;
}

const groupColumns = `
  g.session_id::text AS "id", g.enterprise_id::text AS "enterpriseId",
  g.session_name AS "name", COALESCE(g.state, 'ACTIVE') AS "status",
  g.creator_id::text AS "creatorId", g.project_id::text AS "projectId",
  g.create_time AS "createdAt", g.update_time AS "updatedAt",
  (SELECT COUNT(*)::integer FROM byai.byai_session_member m
   WHERE m.session_id=g.session_id AND m.com_acct_id=g.enterprise_id
     AND m.mem_obj_type='USER') AS "memberCount",
  (SELECT COUNT(*)::integer FROM byai.byai_session_member m
   WHERE m.session_id=g.session_id AND m.com_acct_id=g.enterprise_id
     AND m.mem_obj_type='AGENT') AS "agentCount"`;

function pageQuery(input: unknown): PageQuery {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ServiceError(400, 'INVALID_REQUEST');
  }
  const fields = input as Record<string, unknown>;
  const pageNum = fields.pageNum ?? 1;
  const pageSize = fields.pageSize ?? 20;
  const keyword = fields.keyword ?? '';
  const status = fields.status ?? '';
  if (
    !Number.isInteger(pageNum) ||
    Number(pageNum) < 1 ||
    Number(pageNum) > 10000 ||
    !Number.isInteger(pageSize) ||
    Number(pageSize) < 1 ||
    Number(pageSize) > 100 ||
    typeof keyword !== 'string' ||
    keyword.length > 128 ||
    typeof status !== 'string' ||
    !['', 'ACTIVE', 'GROUP_DISSOLVED'].includes(status)
  ) {
    throw new ServiceError(400, 'INVALID_REQUEST');
  }
  return { pageNum: Number(pageNum), pageSize: Number(pageSize), keyword: keyword.trim(), status };
}

/** 平台只读投影，企业标识来自 Node 配置，禁止查询消息正文或依赖伪造的用户身份。 */
export default class OperationsQueries {
  constructor(private readonly db: SqlSession, private readonly enterpriseId: string) {
    requireId(enterpriseId);
  }

  async groups(input: unknown) {
    const query = pageQuery(input);
    const parameters = [this.enterpriseId, query.keyword, query.status];
    const where = `g.enterprise_id=$1 AND g.session_type='hs_as'
      AND COALESCE(g.state,'ACTIVE') IN ('ACTIVE','GROUP_DISSOLVED')
      AND POSITION(LOWER($2) IN LOWER(COALESCE(g.session_name,'')))>0
      AND ($3='' OR COALESCE(g.state,'ACTIVE')=$3)`;
    const [count] = await this.db.query(
      `SELECT COUNT(*) AS total FROM byai.byai_session g WHERE ${where}`,
      parameters,
    );
    const list = await this.db.query(
      `SELECT ${groupColumns} FROM byai.byai_session g WHERE ${where}
       ORDER BY g.create_time DESC NULLS LAST,g.session_id DESC LIMIT $4 OFFSET $5`,
      [...parameters, query.pageSize, (query.pageNum - 1) * query.pageSize],
    );
    const total = Number(count?.total ?? 0);
    return {
      list,
      total,
      pageNum: query.pageNum,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  async detail(groupId: unknown) {
    const id = requireId(groupId);
    const [group] = await this.db.query(
      `SELECT ${groupColumns},
       (SELECT COUNT(*)::integer FROM byai.byai_session child
        WHERE child.enterprise_id=g.enterprise_id AND child.parent_session_id=g.session_id
          AND child.session_type='h_as') AS "conversationCount"
       FROM byai.byai_session g WHERE g.enterprise_id=$1 AND g.session_id=$2
         AND g.session_type='hs_as' AND COALESCE(g.state,'ACTIVE') IN ('ACTIVE','GROUP_DISSOLVED')`,
      [this.enterpriseId, id],
    );
    if (!group) {
      throw new ServiceError(404, 'NOT_FOUND');
    }
    return group;
  }

  async members(groupId: unknown, input: unknown) {
    const id = requireId(groupId);
    const query = pageQuery(input);
    await this.detail(id);
    // 每条成员 SQL 重复企业和工作组条件，避免详情校验后出现跨租户读取。
    const parameters = [this.enterpriseId, id];
    const where = `m.com_acct_id=$1 AND m.session_id=$2
      AND m.mem_obj_type IN ('USER','AGENT')
      AND EXISTS(SELECT 1 FROM byai.byai_session g WHERE g.session_id=m.session_id
        AND g.enterprise_id=$1 AND g.session_type='hs_as')`;
    const [count] = await this.db.query(
      `SELECT COUNT(*) AS total FROM byai.byai_session_member m WHERE ${where}`,
      parameters,
    );
    const list = await this.db.query(
      `SELECT m.byai_session_member_id::text AS "id",m.mem_obj_id::text AS "objectId",
       m.mem_obj_type AS "type",m.mem_name AS "name",m.user_role AS "role"
       FROM byai.byai_session_member m WHERE ${where}
       ORDER BY m.byai_session_member_id DESC LIMIT $3 OFFSET $4`,
      [...parameters, query.pageSize, (query.pageNum - 1) * query.pageSize],
    );
    const total = Number(count?.total ?? 0);
    return {
      list,
      total,
      pageNum: query.pageNum,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  /** 关联会话只展示资源元信息，使用与概览计数相同的范围，不读取消息或会话正文。 */
  async conversations(groupId: unknown, input: unknown) {
    const id = requireId(groupId);
    const query = pageQuery(input);
    await this.detail(id);
    const parameters = [this.enterpriseId, id];
    const where = `child.enterprise_id=$1 AND child.parent_session_id=$2
      AND child.session_type='h_as'
      AND EXISTS(SELECT 1 FROM byai.byai_session g WHERE g.session_id=child.parent_session_id
        AND g.enterprise_id=$1 AND g.session_type='hs_as'
        AND COALESCE(g.state,'ACTIVE') IN ('ACTIVE','GROUP_DISSOLVED'))`;
    const [count] = await this.db.query(
      `SELECT COUNT(*) AS total FROM byai.byai_session child WHERE ${where}`,
      parameters,
    );
    const list = await this.db.query(
      `SELECT child.session_id::text AS "id",child.session_name AS "name",
       COALESCE(child.state,'ACTIVE') AS "status",child.creator_id::text AS "creatorId",
       child.project_id::text AS "projectId",child.create_time AS "createdAt",
       child.update_time AS "updatedAt"
       FROM byai.byai_session child WHERE ${where}
       ORDER BY child.create_time DESC NULLS LAST,child.session_id DESC LIMIT $3 OFFSET $4`,
      [...parameters, query.pageSize, (query.pageNum - 1) * query.pageSize],
    );
    const total = Number(count?.total ?? 0);
    return {
      list,
      total,
      pageNum: query.pageNum,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }
}
