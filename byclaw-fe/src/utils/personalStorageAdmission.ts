/** Build-time business gate; disabled deployments still surface real storage/API errors. */
declare const PERSONAL_STORAGE_ADMISSION_ENABLED: boolean;

export function isPersonalStorageAdmissionEnabled(): boolean {
  return typeof PERSONAL_STORAGE_ADMISSION_ENABLED !== 'undefined' && PERSONAL_STORAGE_ADMISSION_ENABLED === true;
}
