export const MAX_EML_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_EML_ATTACHMENTS = 100;
export const MAX_EML_HEADERS_BYTES = 256 * 1024;
export interface EmlAttachment {
  id: number;
  name: string;
  mime: string;
  contentId?: string;
  buffer: ArrayBuffer;
  unavailable?: boolean;
}
export interface EmlContent {
  subject: string;
  from: string;
  to: string;
  cc: string;
  date: string;
  text: string;
  html: string;
  rtf?: ArrayBuffer;
  bodyUnavailable?: boolean;
  attachments: EmlAttachment[];
}
