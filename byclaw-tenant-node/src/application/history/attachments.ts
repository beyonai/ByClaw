import type { Row } from "./contracts.js";
import { arrayJson, objectJson, recalled } from "./message-format.js";

/** 时间线和文件列表共用附件投影，上传路径不能在展示转换时丢失。 */
export function messageAttachments(source: Row): Row[] {
  if (recalled(source)) return [];
  const resources = objectJson(source.relatedResources);
  const meta = objectJson(source.metadata);
  return [
    ...arrayJson(resources.files)
      .filter((f) => f && f.fileId && f.fileName)
      .map((f) => ({
        fileId: f.fileId,
        fileName: f.fileName,
        filePath: f.filePath,
        fileUrl: f.fileUrl,
        mediaType: f.fileType,
      })),
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
