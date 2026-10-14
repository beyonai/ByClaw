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

/**
 * 文件大小由后端负责校验，前端不做大小拦截。
 * 保留该函数是为了兼容现有上传流程及配置接口。
 */
export function isUploadFileSizeExceeded(config: Partial<IAgentFileUploadConf> | null | undefined, fileSize: number) {
  void config;
  void fileSize;
  return false;
}
