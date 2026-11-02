export const OFFICE_VARIANTS = {
  docm: 'docx',
  dotx: 'docx',
  xlsm: 'xlsx',
  xltx: 'xlsx',
  pptm: 'pptx',
  ppsx: 'pptx',
  potx: 'pptx',
} as const;

export type OfficeVariantType = keyof typeof OFFICE_VARIANTS;
export const MAX_OFFICE_EXPANDED_BYTES = 50 * 1024 * 1024;
export const MAX_OFFICE_METADATA_BYTES = 2 * 1024 * 1024;

export const OFFICE_MAIN_PARTS = {
  docx: 'word/document.xml',
  xlsx: 'xl/workbook.xml',
  pptx: 'ppt/presentation.xml',
};
export const OFFICE_MAIN_CONTENT_TYPES: Record<OfficeVariantType | 'docx' | 'xlsx' | 'pptx', string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  docm: 'application/vnd.ms-word.document.macroEnabled.main+xml',
  dotx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.main+xml',
  xltx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
  pptm: 'application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml',
  ppsx: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml',
  potx: 'application/vnd.openxmlformats-officedocument.presentationml.template.main+xml',
};
