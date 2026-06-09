export const fileIconMap: Record<string, string> = {
  ppt: 'icon-PPT',
  pptx: 'icon-PPT',
  excel: 'icon-Excel',
  xlsx: 'icon-Excel',
  text: 'icon-jishiben',
  txt: 'icon-jishiben',
  md: 'icon-jishiben',
  word: 'icon-Word',
  doc: 'icon-Word',
  docx: 'icon-Word',
  paper: 'icon-PDF',
  pdf: 'icon-PDF',
  table: 'icon-Excel',
  record: 'icon-jishiben',
  ocr: 'icon-jishiben',
  file: 'icon-jishiben',
  image: 'icon-Image',
  png: 'icon-Image',
  jpg: 'icon-Image',
  jpeg: 'icon-Image',
  gif: 'icon-Image',
  webp: 'icon-Image',
  bmp: 'icon-Image',
  tiff: 'icon-Image',
  ico: 'icon-Image',
  svg: 'icon-Image',
  folder: 'icon-wenjianjia',
  chat: 'icon-wenjianjia',
  other: 'icon-wenjianjia',
};

export const getKnowledgeFileIconType = (
  fileName?: string,
  options?: {
    isDirectory?: boolean;
    directoryIconType?: string;
    defaultIconType?: string;
  }
) => {
  const { isDirectory = false, directoryIconType = 'wenjianjia', defaultIconType = 'jishiben' } = options || {};

  if (isDirectory) {
    return directoryIconType;
  }

  const normalizedFileName = String(fileName || '').toLowerCase();
  const ext = normalizedFileName.split('.').pop();

  switch (ext) {
    case 'doc':
    case 'docx':
      return 'Word';
    case 'pdf':
      return 'PDF';
    case 'xls':
    case 'xlsx':
      return 'Excel';
    case 'txt':
      return 'jishiben';
    case 'ppt':
    case 'pptx':
      return 'PPT';
    case 'md':
      return 'markdown';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'bmp':
    case 'svg':
      return 'Image';
    default:
      return defaultIconType;
  }
};
