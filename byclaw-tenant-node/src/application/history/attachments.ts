import type { Row } from "./contracts.js";
import { arrayJson, objectJson, recalled } from "./message-format.js";

/** 文件列表只投影消息的 related_resources，保留上传文件的预览字段。 */
export function relatedResourceAttachments(source: Row): Row[] {
  if (recalled(source)) return [];
  const resources = objectJson(source.relatedResources);
  return arrayJson(resources.files)
    .filter((f) => f && f.fileId && f.fileName)
    .map((f) => ({
      fileId: f.fileId,
      fileName: f.fileName,
      filePath: f.filePath,
      fileUrl: f.fileUrl,
      mediaType: f.fileType,
    }));
}

/** 时间线同时展示上传附件和已发布的任务结果文件。 */
export function messageAttachments(source: Row): Row[] {
  if (recalled(source)) return [];
  const meta = objectJson(source.metadata);
  return [
    ...relatedResourceAttachments(source),
    ...(meta.scene === "GROUP_CHAT" && meta.kind === "TASK_RESULT"
      ? arrayJson(meta.files)
          .filter((f) => f && f.fileName && f.filePath)
          .map((f) => ({
            fileId: f.fileId,
            fileName: f.fileName,
            filePath: f.filePath,
            cloudResourceId: f.cloudResourceId,
          }))
      : []),
  ];
}
