import type { FastifyInstance } from 'fastify';
import type OperationsQueries from '../../application/OperationsQueries.js';

/** 复用 internal 鉴权、企业/代际校验与 ready 门禁，仅注册只读操作。 */
export default function operationsRoutes(app: FastifyInstance, operations: OperationsQueries) {
  app.post('/internal/v1/operations/groups/query', async request =>
    operations.groups(request.body),
  );
  app.get<{ Params: { id: string } }>('/internal/v1/operations/groups/:id', async request =>
    operations.detail(request.params.id),
  );
  app.post<{ Params: { id: string } }>(
    '/internal/v1/operations/groups/:id/members/query',
    async request => operations.members(request.params.id, request.body),
  );
  app.post<{ Params: { id: string } }>(
    '/internal/v1/operations/groups/:id/conversations/query',
    async request => operations.conversations(request.params.id, request.body),
  );
}
