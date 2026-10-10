// 预览入口与渲染器共用格式清单，避免列表允许打开但内容区没有对应渲染分支。
export const CODE_TEXT_EXTENSIONS = [
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'java',
  'kt',
  'kts',
  'py',
  'go',
  'rs',
  'c',
  'h',
  'cpp',
  'cc',
  'hpp',
  'cs',
  'php',
  'rb',
  'swift',
  'scala',
  'sh',
  'bash',
  'zsh',
  'sql',
  'vue',
  'css',
  'less',
  'scss',
  'yaml',
  'yml',
  'toml',
  'ini',
  'properties',
  'conf',
  'gradle',
  'dockerfile',
  'xml',
];

export const IMAGE_PREVIEW_TYPES = ['image', 'jpg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico', 'avif', 'apng'];
export const VIDEO_PREVIEW_TYPES = ['video', 'mp4', 'webm', 'mov', 'm4v', 'ogv', 'avi', 'mkv'];
export const AUDIO_PREVIEW_TYPES = ['audio', 'mp3', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'flac'];
export const OFFICE_PREVIEW_TYPES = ['pptx', 'docx', 'xlsx', 'xls'];
export const TEXT_PREVIEW_TYPES = ['txt', 'log', 'json', 'jsonl', 'ndjson', 'csv', 'tsv', ...CODE_TEXT_EXTENSIONS];
export const HTML_PREVIEW_TYPES = ['html', 'h5'];

const TYPE_ALIASES: Record<string, string> = { jpeg: 'jpg', htm: 'html', markdown: 'md', text: 'txt', img: 'image' };

export const PREVIEWABLE_TYPES = [
  'md',
  'pdf',
  ...HTML_PREVIEW_TYPES,
  ...IMAGE_PREVIEW_TYPES,
  ...VIDEO_PREVIEW_TYPES,
  ...AUDIO_PREVIEW_TYPES,
  ...OFFICE_PREVIEW_TYPES,
  ...TEXT_PREVIEW_TYPES,
  ...Object.keys(TYPE_ALIASES),
];

export const PREVIEW_MIME_TYPES: Record<string, string> = {
  ...Object.fromEntries(TEXT_PREVIEW_TYPES.map((ext) => [ext, 'text/plain'])),
  md: 'text/markdown',
  pdf: 'application/pdf',
  json: 'application/json',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  html: 'text/html',
  h5: 'text/html',
  jpg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  bmp: 'image/bmp',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  avif: 'image/avif',
  apng: 'image/apng',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4v: 'video/mp4',
  ogv: 'video/ogg',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // 已知二进制 MIME 供下载及类型识别使用，不代表已具备在线解码器。
  doc: 'application/msword',
  ppt: 'application/vnd.ms-powerpoint',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  heic: 'image/heic',
  heif: 'image/heif',
};

export function getPreviewExtension(name: string): string {
  const fileName = name.split(/[\\/]/).pop() || '';
  return fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() || '' : '';
}

const normalizeType = (type: string) => TYPE_ALIASES[type] || type;

/** 兼容扩展名、MIME 和 image/audio/video 分类；具体扩展名决定渲染分支及 Blob MIME。 */
export function resolvePreviewType(type?: string, title?: string, mimeType?: string): string {
  const value = normalizeType((type || '').trim().toLowerCase().replace(/^\./, '').split(';')[0]);
  const extension = normalizeType(getPreviewExtension(title || ''));
  const mime = (mimeType || value).toLowerCase().split(';')[0];
  const mimeExtension = Object.keys(PREVIEW_MIME_TYPES).find((ext) => PREVIEW_MIME_TYPES[ext] === mime);
  if (['image', 'audio', 'video', 'file', ''].includes(value) || value.includes('/')) {
    if (PREVIEWABLE_TYPES.includes(extension)) return extension;
    return mimeExtension || extension || value || 'txt';
  }
  return normalizeType(value);
}

export function isPreviewableName(name: string): boolean {
  return PREVIEWABLE_TYPES.includes(normalizeType(getPreviewExtension(name)));
}

export function getPreviewMimeType(name: string): string {
  return PREVIEW_MIME_TYPES[normalizeType(getPreviewExtension(name))] || '';
}
