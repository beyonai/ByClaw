import type { IAgentFileUploadConf } from '@/hooks/useAgentUploadFileConfig';

/** 显式关闭或附件已满时隐藏入口；兼容缺省开关及零值表示不限数量的旧参数。 */
export function isUploadFileButtonVisible(config?: Partial<IAgentFileUploadConf> | null, fileCount = 0): boolean {
  if (config?.enabled === false) return false;

  const maxFileCount = config?.maxFileCount ?? 0;
  return !(maxFileCount > 0 && fileCount >= maxFileCount);
}

/** 数量为 0 或未配置时不限；恰好达到上限仍允许上传。 */
export function isUploadFileCountExceeded(config: Partial<IAgentFileUploadConf> | null | undefined, fileCount: number) {
  const maxFileCount = config?.maxFileCount ?? 0;
  return maxFileCount > 0 && fileCount > maxFileCount;
}

/** 与后端统一按 1024 * 1024 字节换算，大小为 0 或未配置时不限。 */
export function isUploadFileSizeExceeded(config: Partial<IAgentFileUploadConf> | null | undefined, fileSize: number) {
  const maxFileSize = config?.maxFileSize ?? 0;
  return maxFileSize > 0 && fileSize > Number(maxFileSize) * 1024 * 1024;
}
