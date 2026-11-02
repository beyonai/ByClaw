import type { FastifyInstance } from 'fastify';
import type MemberGroupRemoval from '../../application/MemberGroupRemoval.js';

/** 固定内部服务路径，沿用企业、代际及写入门禁，不接受浏览器身份。 */
export default function memberGroupRemovalRoutes(
  app: FastifyInstance,
  removal: MemberGroupRemoval,
) {
  app.post('/internal/v1/member-group-removal/snapshot', async (request) =>
    removal.snapshot(request.body),
  );
  app.post('/internal/v1/member-group-removal/apply', async (request) =>
    removal.apply(request.body),
  );
}
