import { DomainError } from "../../domain/errors.js";
import { canonical } from "../../domain/json.js";
import { validId } from "../../domain/values.js";
import type { SqlRow } from "../../application/database-ports.js";

/** 同版本的并发上传可补充不同源文件，已登记的文件引用不能被较早的检查点覆盖。 */
export function mergePrivateUploads(pending: SqlRow, updates: Record<string, any>) {
  const sources: string[] = JSON.parse(pending.sourceFilesJson);
  const saved = JSON.parse(pending.uploadedFilesJson ?? "{}");
  for (const [source, files] of Object.entries(updates)) {
    const index = sources.indexOf(source);
    // 对群公开的云盘路径只含成果版本，防止从附件链接获得私聊会话 ID。
    const directory = `/group-task-results/private/${pending.pendingPublicationId}/${index}/`;
    if (
      index < 0 ||
      !Array.isArray(files) ||
      files.length === 0 ||
      files.length > 100 ||
      files.some(
        (file) =>
          !file ||
          typeof file.fileName !== "string" ||
          !file.fileName ||
          (file.fileId != null &&
            !validId(
              typeof file.fileId === "number" && Number.isSafeInteger(file.fileId)
                ? String(file.fileId)
                : file.fileId,
            )) ||
          typeof file.filePath !== "string" ||
          !file.filePath.startsWith(directory) ||
          file.filePath.includes("..") ||
          file.filePath.includes("\\") ||
          file.filePath.split("/").at(-1) !== file.fileName,
      )
    )
      throw new DomainError("INVALID_PUBLICATION_FILES");
    if (Object.hasOwn(saved, source) && canonical(saved[source]) !== canonical(files))
      throw new DomainError("INVALID_PUBLICATION_FILES");
    saved[source] = files;
  }
  return saved;
}

/** 文件身份由已完成的逐源上传检查点和 BE 的当前云盘授权共同确定。 */
export function verifyPrivatePublicationFiles(pending: SqlRow, authorized: Record<string, any>[]) {
  const sources: string[] = JSON.parse(pending.sourceFilesJson);
  const uploaded = JSON.parse(pending.uploadedFilesJson ?? "{}");
  const expected = sources.flatMap((source) => {
    const entries = uploaded[source];
    if (!Array.isArray(entries) || entries.length === 0)
      throw new DomainError("INVALID_PUBLICATION_FILES");
    return entries;
  });
  if (
    authorized.length !== expected.length ||
    authorized.some(
      (file, index) =>
        !pending.cloudResourceId ||
        file.cloudResourceId !== pending.cloudResourceId ||
        String(file.fileId ?? "") !== String(expected[index]?.fileId ?? "") ||
        file.fileName !== expected[index]?.fileName ||
        file.filePath !== expected[index]?.filePath,
    )
  ) {
    throw new DomainError("INVALID_PUBLICATION_FILES");
  }
}
