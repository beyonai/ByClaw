import type { IFile } from '@/typescript/file';
import { updateAttachmentByUid } from '../utils/attachmentUpload';

test('progress and failure patches preserve sibling attachments and their upload states', () => {
  const files: IFile[] = [
    { uid: 'a', fileType: 'file', status: 'uploading', uploadProgress: 20 },
    { uid: 'b', fileType: 'file', status: 'done', uploadProgress: 100 },
  ];
  const updated = updateAttachmentByUid(files, { uid: 'a', fileType: 'file', status: 'uploading', uploadProgress: 40 });
  expect(updated[0].status).toBe('uploading');
  expect(updated[0].uploadProgress).toBe(40);
  expect(updated[1]).toBe(files[1]);
  expect(
    updateAttachmentByUid(updated, { uid: 'a', fileType: 'file', status: 'error', uploadError: 'lost connection' })[0]
      .status
  ).toBe('error');
  expect(updateAttachmentByUid(files, { uid: 'removed', fileType: 'file', status: 'done' })).toEqual(files);
});
