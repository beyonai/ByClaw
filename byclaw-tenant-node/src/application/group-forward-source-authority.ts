import type { SourceMessage } from "./group-forward-types.js";
/** Internal source read use case; concrete reader accepts the transaction's existing SQL session. */
export interface ForwardSourceAuthorityReader {
  readMessage(
    actor: string,
    sourceSessionId: string,
    selectedMessageId: string,
  ): Promise<SourceMessage>;
  requireUploadSession(actor: string, uploadSessionId: string): Promise<unknown>;
}
