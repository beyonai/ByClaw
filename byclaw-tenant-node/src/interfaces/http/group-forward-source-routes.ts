import type { FastifyInstance } from "fastify";
import type { ForwardSourceAuthorityReader } from "../../application/group-forward-source-authority.js";
import { requireId } from "../../domain/values.js";
/** Mounted behind the app's service authentication, tenant headers and READY hook. Read-only. */
export function forwardSourceRoutes(app: FastifyInstance, reader: ForwardSourceAuthorityReader) {
  app.get<{ Params: { sourceId: string; selectedMessageId: string } }>(
    "/internal/v1/group-chats/:sourceId/forward-sources/:selectedMessageId",
    (req) =>
      reader.readMessage(
        requireId(req.headers["x-actor-user-id"]),
        requireId(req.params.sourceId),
        requireId(req.params.selectedMessageId),
      ),
  );
  app.get<{ Params: { uploadSessionId: string } }>(
    "/internal/v1/forward-upload-sessions/:uploadSessionId",
    (req) =>
      reader.requireUploadSession(
        requireId(req.headers["x-actor-user-id"]),
        requireId(req.params.uploadSessionId),
      ),
  );
}
