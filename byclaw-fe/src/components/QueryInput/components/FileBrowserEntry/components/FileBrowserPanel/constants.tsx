import {
  getPreviewMimeType,
  isPreviewableName,
  resolvePreviewType,
  VIDEO_PREVIEW_TYPES,
} from '@/components/Preview/formats';

import {
  FileExcelOutlined,
  FileImageOutlined,
  FileMarkdownOutlined,
  FileOutlined,
  FilePdfOutlined,
  FilePptOutlined,
  FileTextOutlined,
  FileWordOutlined,
  FileZipOutlined,
  FolderOutlined,
  PlayCircleOutlined,
  SoundOutlined,
} from '@ant-design/icons';
import React from 'react';

const EXT_ICON_MAP: Record<string, React.ReactNode> = {
  pdf: <FilePdfOutlined style={{ color: '#ff4d4f' }} />,
  doc: <FileWordOutlined style={{ color: '#1677ff' }} />,
  docx: <FileWordOutlined style={{ color: '#1677ff' }} />,
  xls: <FileExcelOutlined style={{ color: '#52c41a' }} />,
  xlsx: <FileExcelOutlined style={{ color: '#52c41a' }} />,
  csv: <FileExcelOutlined style={{ color: '#52c41a' }} />,
  ppt: <FilePptOutlined style={{ color: '#fa8c16' }} />,
  pptx: <FilePptOutlined style={{ color: '#fa8c16' }} />,
  md: <FileMarkdownOutlined />,
  txt: <FileTextOutlined />,
  log: <FileTextOutlined />,
  json: <FileTextOutlined style={{ color: '#faad14' }} />,
  png: <FileImageOutlined style={{ color: '#13c2c2' }} />,
  jpg: <FileImageOutlined style={{ color: '#13c2c2' }} />,
  jpeg: <FileImageOutlined style={{ color: '#13c2c2' }} />,
  gif: <FileImageOutlined style={{ color: '#13c2c2' }} />,
  svg: <FileImageOutlined style={{ color: '#13c2c2' }} />,
  webp: <FileImageOutlined style={{ color: '#13c2c2' }} />,
  bmp: <FileImageOutlined style={{ color: '#13c2c2' }} />,
  mp4: <PlayCircleOutlined style={{ color: '#722ed1' }} />,
  avi: <PlayCircleOutlined style={{ color: '#722ed1' }} />,
  mov: <PlayCircleOutlined style={{ color: '#722ed1' }} />,
  mkv: <PlayCircleOutlined style={{ color: '#722ed1' }} />,
  mp3: <SoundOutlined style={{ color: '#eb2f96' }} />,
  wav: <SoundOutlined style={{ color: '#eb2f96' }} />,
  flac: <SoundOutlined style={{ color: '#eb2f96' }} />,
  zip: <FileZipOutlined style={{ color: '#8c8c8c' }} />,
  rar: <FileZipOutlined style={{ color: '#8c8c8c' }} />,
  '7z': <FileZipOutlined style={{ color: '#8c8c8c' }} />,
  tar: <FileZipOutlined style={{ color: '#8c8c8c' }} />,
  gz: <FileZipOutlined style={{ color: '#8c8c8c' }} />,
  html: <FileTextOutlined style={{ color: '#fa541c' }} />,
  xml: <FileTextOutlined style={{ color: '#fa541c' }} />,
};

export function getFileIcon(name: string, isDir: boolean): React.ReactNode {
  if (isDir) return <FolderOutlined style={{ color: '#faad14' }} />;
  const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() || '' : '';
  return EXT_ICON_MAP[ext] || <FileOutlined />;
}

// 保留现有导出供调用方复用，格式定义集中在共享预览层。
export { CODE_TEXT_EXTENSIONS } from '@/components/Preview/formats';

export const isPreviewable = isPreviewableName;

export function isVideo(name: string): boolean {
  return VIDEO_PREVIEW_TYPES.includes(resolvePreviewType(undefined, name));
}

export function formatFileSize(bytes?: number): string {
  if (bytes === undefined || bytes === null) return '-';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0);
  return `${size} ${units[i]}`;
}

export const getMimeType = getPreviewMimeType;
