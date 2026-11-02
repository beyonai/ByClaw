import type { IFile } from '@/typescript/file';

export const updateAttachmentByUid = (files: IFile[] | undefined, updated: IFile): IFile[] =>
  (files || []).map((file) => (file.uid === updated.uid ? { ...file, ...updated } : file));
