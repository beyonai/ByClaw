const fileIconTypeGroups: Record<string, string[]> = {
  PPT: ['ppt', 'pptx'],
  Excel: ['excel', 'xls', 'xlsx', 'csv', 'table'],
  jishiben: ['text', 'txt', 'record', 'ocr', 'file'],
  markdown: ['md', 'markdown'],
  Word: ['word', 'doc', 'docx'],
  PDF: ['paper', 'pdf'],
  Image: ['image', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'ico', 'svg'],
  html: ['html', 'htm'],
  json: ['json'],
  sql1: ['sql'],
  java: ['java'],
  shipin: ['mp4', 'avi', 'mov', 'mkv', 'webm'],
  yinpin: ['mp3', 'wav', 'flac'],
  'a-Data-fileshujuwenjian': ['zip', 'rar', '7z', 'tar', 'gz', 'other'],
  'a-Codedaima': ['js', 'ts', 'jsx', 'tsx', 'py', 'c', 'cpp', 'go', 'rs', 'rb', 'sh'],
  wenjianjialanse: ['folder', 'chat'],
};

const fileIconTypeMap = Object.entries(fileIconTypeGroups).reduce<Record<string, string>>((map, [iconType, keys]) => {
  keys.forEach((key) => {
    map[key] = iconType;
  });
  return map;
}, {});

export const getFileIconType = (
  fileName?: string,
  options?: {
    isDirectory?: boolean;
    directoryIconType?: string;
    defaultIconType?: string;
  }
) => {
  const {
    isDirectory = false,
    directoryIconType = 'wenjianjialanse',
    defaultIconType = 'a-Data-fileshujuwenjian',
  } = options || {};

  if (isDirectory) {
    return directoryIconType;
  }

  const normalizedFileName = String(fileName || '').toLowerCase();
  const ext = normalizedFileName.includes('.') ? normalizedFileName.split('.').pop() : normalizedFileName;

  return (ext && fileIconTypeMap[ext]) || defaultIconType;
};
