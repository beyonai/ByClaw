export type OpenDocumentType = 'odt' | 'odp';
export interface OpenDocumentPage {
  name: string;
  html: string;
}
export interface OpenDocumentContent {
  pages: OpenDocumentPage[];
  omitted: boolean;
}

export const MAX_ODF_XML_BYTES = 8 * 1024 * 1024;
export const MAX_ODF_HTML = 2 * 1024 * 1024;
export const MAX_ODF_PAGES = 200;
export const MAX_ODF_NODES = 20000;
export const MAX_ODF_IMAGES = 50;
export const MAX_ODF_IMAGE_BYTES = 2 * 1024 * 1024;
