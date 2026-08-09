import type {
  AttachmentInspection,
  AttachmentInspectionMode,
  MaterializedAttachment,
} from "../domain/attachment-inspection.js";
import type { CallerPrincipal, RunAttachment } from "../domain/types.js";

/** 传输无关的附件读取边界，由 app 层注入具体实现。 */
export interface AttachmentResolver {
  inspect(input: {
    attachment: RunAttachment;
    principal: CallerPrincipal;
    credential: string;
    mode: AttachmentInspectionMode;
    signal: AbortSignal;
  }): Promise<AttachmentInspection>;
  materialize?(input: {
    attachment: RunAttachment;
    principal: CallerPrincipal;
    credential: string;
    destinationDirectory: string;
    signal: AbortSignal;
  }): Promise<MaterializedAttachment>;
}
