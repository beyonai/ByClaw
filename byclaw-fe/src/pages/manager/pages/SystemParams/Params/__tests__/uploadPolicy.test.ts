import { getUploadPolicyFields, mergeUploadPolicyFields } from '../uploadPolicy';

it('fills backward-compatible defaults while preserving other upload settings', () => {
  const original = '{"enabled":false,"maxFileSize":512,"maxFileCount":3,"custom":{"keep":true}}';
  expect(getUploadPolicyFields(original)).toEqual({ resumableMaxFileSizeMB: 4096, resumableChunkSizeMB: 4 });
  const payload = JSON.parse(
    mergeUploadPolicyFields(original, { resumableMaxFileSizeMB: 8192, resumableChunkSizeMB: 8 })
  );
  expect(payload).toEqual({
    enabled: false,
    maxFileSize: 512,
    maxFileCount: 3,
    custom: { keep: true },
    resumableMaxFileSizeMB: 8192,
    resumableChunkSizeMB: 8,
  });
});

it.each([0, -1, 1.5, 17])('rejects invalid chunk policy %s before producing a save payload', (value) => {
  expect(() => mergeUploadPolicyFields('{}', { resumableMaxFileSizeMB: 4096, resumableChunkSizeMB: value })).toThrow();
});
