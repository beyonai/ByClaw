import { callDomainServiceByMultipart } from '@/service/file';
import { trim } from 'lodash';
import { message } from 'antd';

export const spliceOrigin = (fileUrl: string) => {
  if (fileUrl.startsWith('/')) {
    return `${window.location.origin}${fileUrl}`;
  }

  return fileUrl;
};

export const getFileUrl = (fileUrl: string) => {
  let myFileUrl: string = fileUrl;
  if (myFileUrl && !myFileUrl.startsWith('http') && !myFileUrl.startsWith('blob')) {
    myFileUrl = trim(myFileUrl, '/');
    if (myFileUrl.startsWith('byaiService')) {
      myFileUrl = `/${myFileUrl}`;
    } else {
      myFileUrl = `/byaiService/${myFileUrl}`;
    }
  }
  return myFileUrl;
};

export const downloadFile = (res: { file?: Blob; fileName: string; fileUrl?: string }) => {
  const { file, fileName, fileUrl } = res;

  let url = '';

  if (fileUrl) {
    url = getFileUrl(fileUrl);
  } else if (file) {
    url = window.URL.createObjectURL(file);
  }

  if (!url) {
    return;
  }

  const a = document.createElement('a');
  a.href = url;
  try {
    a.download = decodeURIComponent(fileName);
  } catch (e) {
    a.download = fileName;
    console.log('error decode fileName:', e);
  }
  a.click();
  a.remove();
};

/**
 * file download by text
 */
export const fileDownload = ({ text, type, filename }: { text: string; type: string; filename: string }) => {
  // 导出为文件
  const blob = new Blob([`\uFEFF${text}`], { type: `${type};charset=utf-8;` });

  // 创建下载链接
  const downloadLink = document.createElement('a');
  downloadLink.href = window.URL.createObjectURL(blob);
  downloadLink.download = filename;

  // 添加链接到页面并触发下载
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body?.removeChild(downloadLink);
};

export const fileToBase64 = (file: File) => {
  return new Promise<any>((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
  });
};

export function formatBytes(bytes?: number, decimals: number = 2, binary: boolean = true): string {
  if (!bytes) return '0 B';

  const base = binary ? 1024 : 1000;
  const units = binary ? ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'] : ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

  const i = Math.floor(Math.log(bytes) / Math.log(base));
  // prettier-ignore
  const value = parseFloat((bytes / (base ** i)).toFixed(decimals));

  return `${value} ${units[i]}`;
}

export const compressImgFileAndUpload = async ({
  file,
}: {
  file: File;
  maxW?: number;
  maxH?: number;
  maxSize?: number;
  expiredTime?: Date;
  shareId?: string;
}) => {
  const formData = new FormData();
  formData.append('param', JSON.stringify({ domainService: 'uploadDatasetLogo' }));
  formData.append('file', file);
  try {
    const data = await callDomainServiceByMultipart(formData);
    if (data) {
      if (data.fileUrl) {
        return {
          datasetLogosId: data.fileId,
          datasetLogosUrl: data.fileUrl,
        };
      }
      message.info('上传成功');
    }
    return data;
  } catch (error: any) {
    message.error(error || '上传失败，请稍后重试');
    throw error;
  }
};

export function isBase64(str: string) {
  if (str === '' || str.trim() === '') {
    return false;
  }
  try {
    return btoa(atob(str)) === str;
  } catch (err) {
    return false;
  }
}

export function getFileTypeByName(fileName: string) {
  if (!fileName) return 'file';

  // 获取文件扩展名（转换为小写）
  const extension = fileName.split('.').pop()?.toLowerCase();

  if (!extension) return 'file';

  // 图片类型
  const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff', 'tif', 'heic', 'heif'];
  if (imageExtensions.includes(extension)) {
    return 'image';
  }

  // 视频类型
  const videoExtensions = ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv', 'm4v', '3gp', 'ogv', 'mts', 'm2ts'];
  if (videoExtensions.includes(extension)) {
    return 'video';
  }

  // 音频类型
  const audioExtensions = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a', 'opus', 'aiff', 'au', 'ra'];
  if (audioExtensions.includes(extension)) {
    return 'audio';
  }

  // 其他类型
  return 'file';
}

/**
 * 验证文件是否符合antd Upload的accept规则
 * 支持格式：
 * - MIME类型：image/png, text/plain
 * - MIME类型通配符：image/*, text/*
 * - 文件扩展名：.png, .pdf, .doc
 * - 混合格式：image/*,.pdf,.doc
 * @param file 要验证的文件
 * @param accept accept字符串，支持逗号分隔的多个值
 * @returns 是否符合accept规则
 */
export function validateAccept(file: File, accept?: string): boolean {
  if (!accept) {
    return true;
  }

  const fileType = file.type.toLowerCase();
  const fileName = file.name.toLowerCase();

  // 获取文件扩展名（包含点号）
  const getFileExtension = (name: string): string => {
    const lastDotIndex = name.lastIndexOf('.');
    return lastDotIndex >= 0 ? name.substring(lastDotIndex) : '';
  };

  const fileExtension = getFileExtension(fileName);

  // 分割accept字符串，支持逗号分隔的多个值
  const acceptTypes = accept
    .split(',')
    .map((type) => type.trim())
    .filter((type) => type.length > 0);

  // 检查每个accept类型
  for (const acceptType of acceptTypes) {
    const acceptTypeLower = acceptType.toLowerCase();

    // 1. 检查MIME类型通配符（如 image/*）
    if (acceptTypeLower.includes('/*')) {
      const [mainType] = acceptTypeLower.split('/');
      const [fileMainType] = fileType.split('/');
      if (mainType === fileMainType) {
        return true;
      }
    } else if (acceptTypeLower.includes('/')) {
      // 2. 检查完整MIME类型（如 image/png）
      if (fileType === acceptTypeLower) {
        return true;
      }
    } else if (acceptTypeLower.startsWith('.')) {
      // 3. 检查文件扩展名（如 .png, .pdf）
      if (fileExtension === acceptTypeLower) {
        return true;
      }
    } else if (fileExtension === `.${acceptTypeLower}`) {
      // 4. 如果没有点号，也尝试作为扩展名匹配（兼容性处理）
      return true;
    }
  }

  return false;
}
