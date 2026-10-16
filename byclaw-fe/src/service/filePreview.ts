import { POST } from '@/service/common/request';

export const MAX_LEGACY_PREVIEW_SIZE = 20 * 1024 * 1024;

/** 只转换已取得的文件副本，不改变存储文件或原文件下载地址。 */
export function convertLegacyOfficePreview(file: Blob, fileName: string, controller: AbortController) {
  const formData = new FormData();
  formData.append('file', file, fileName);
  return POST<{ file: Blob; fileName: string }>('/byaiService/file-preview/legacy-office', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    responseType: 'blob',
    cancelToken: controller,
    timeout: 120000,
    responseCfg: { hideErrorTips: true },
  });
}
