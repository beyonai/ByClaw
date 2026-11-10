export const UPLOAD_CONFIG_CODE = 'DIG_EMPLOYEE_FILE_UPLOAD_CONFIG';
export interface UploadPolicyFields {
  resumableMaxFileSizeMB: number;
  resumableChunkSizeMB: number;
}

function parseUploadConfig(source: string) {
  const value = JSON.parse(source || '{}');
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Upload config must be a JSON object');
  return value;
}

export function getUploadPolicyFields(source: string): UploadPolicyFields {
  const value = parseUploadConfig(source);
  const fields = {
    resumableMaxFileSizeMB: value.resumableMaxFileSizeMB === undefined ? 4096 : value.resumableMaxFileSizeMB,
    resumableChunkSizeMB: value.resumableChunkSizeMB === undefined ? 4 : value.resumableChunkSizeMB,
  };
  if (
    !Number.isSafeInteger(fields.resumableMaxFileSizeMB) ||
    fields.resumableMaxFileSizeMB < 1 ||
    fields.resumableMaxFileSizeMB > 8796093022207 ||
    !Number.isSafeInteger(fields.resumableChunkSizeMB) ||
    fields.resumableChunkSizeMB < 1 ||
    fields.resumableChunkSizeMB > 16
  )
    throw new Error('Invalid resumable upload policy');
  return fields;
}

export function mergeUploadPolicyFields(source: string, fields: UploadPolicyFields) {
  const value = { ...parseUploadConfig(source), ...fields };
  getUploadPolicyFields(JSON.stringify(value));
  return JSON.stringify(value, null, 2);
}
