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
// 需要专用解码器的图片不能直接交给原生 img。
export const RAW_PREVIEW_TYPES = [
  'raw',
  'dng',
  'cr2',
  'cr3',
  'nef',
  'nrw',
  'arw',
  'srf',
  'sr2',
  'raf',
  'rw2',
  'orf',
  'pef',
  'srw',
];
export const DECODED_IMAGE_PREVIEW_TYPES = ['heic', 'heif', 'tif', 'tiff', 'jxl', ...RAW_PREVIEW_TYPES];
export const ARCHIVE_PREVIEW_TYPES = ['zip'];
export const DOCUMENT_DATA_PREVIEW_TYPES = ['rtf', 'ods'];
export const EBOOK_PREVIEW_TYPES = ['epub'];
export const DATABASE_PREVIEW_TYPES = ['sqlite', 'sqlite3', 'db'];
export const VIDEO_PREVIEW_TYPES = ['video', 'mp4', 'webm', 'mov', 'm4v', 'ogv', 'avi', 'mkv'];
export const AUDIO_PREVIEW_TYPES = ['audio', 'mp3', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'flac'];
export const LEGACY_OFFICE_PREVIEW_TYPES = ['doc', 'ppt'];
export const OFFICE_PREVIEW_TYPES = ['pptx', 'docx', 'xlsx', 'xls', ...LEGACY_OFFICE_PREVIEW_TYPES];
export const DELIMITED_PREVIEW_TYPES = ['csv', 'tsv'];
export const TEXT_PREVIEW_TYPES = ['txt', 'log', 'json', 'jsonl', 'ndjson', 'csv', 'tsv', ...CODE_TEXT_EXTENSIONS];
export const HTML_PREVIEW_TYPES = ['html', 'h5'];

const TYPE_ALIASES: Record<string, string> = {
  jpeg: 'jpg',
  jfif: 'jpg',
  jpe: 'jpg',
  jif: 'jpg',
  pjp: 'jpg',
  pjpeg: 'jpg',
  // 部分相机使用 HIF 扩展名保存 HEIF 照片，复用同一解码器。
  hif: 'heif',
  htm: 'html',
  markdown: 'md',
  text: 'txt',
  img: 'image',
};

export const PREVIEWABLE_TYPES = [
  'md',
  'pdf',
  ...HTML_PREVIEW_TYPES,
  ...IMAGE_PREVIEW_TYPES,
  ...DECODED_IMAGE_PREVIEW_TYPES,
  ...ARCHIVE_PREVIEW_TYPES,
  ...DOCUMENT_DATA_PREVIEW_TYPES,
  ...EBOOK_PREVIEW_TYPES,
  ...DATABASE_PREVIEW_TYPES,
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
  doc: 'application/msword',
  ppt: 'application/vnd.ms-powerpoint',
  zip: 'application/zip',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  heic: 'image/heic',
  heif: 'image/heif',
  jxl: 'image/jxl',
  rtf: 'application/rtf',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  epub: 'application/epub+zip',
  sqlite: 'application/vnd.sqlite3',
  sqlite3: 'application/vnd.sqlite3',
  db: 'application/vnd.sqlite3',
  raw: 'image/x-raw',
  dng: 'image/x-adobe-dng',
  cr2: 'image/x-canon-cr2',
  cr3: 'image/x-canon-cr3',
  nef: 'image/x-nikon-nef',
  nrw: 'image/x-nikon-nrw',
  arw: 'image/x-sony-arw',
  srf: 'image/x-sony-srf',
  sr2: 'image/x-sony-sr2',
  raf: 'image/x-fuji-raf',
  rw2: 'image/x-panasonic-rw2',
  orf: 'image/x-olympus-orf',
  pef: 'image/x-pentax-pef',
  srw: 'image/x-samsung-srw',
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
  const rawMime = (mimeType || value).toLowerCase().split(';')[0];
  const mimeAliases: Record<string, string> = {
    'text/rtf': 'application/rtf',
    'application/x-sqlite3': 'application/vnd.sqlite3',
  };
  const mime = mimeAliases[rawMime] || rawMime;
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
