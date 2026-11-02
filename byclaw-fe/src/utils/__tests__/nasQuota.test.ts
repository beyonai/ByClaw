import { getIntl } from '@umijs/max';
import { Modal } from 'antd';
import { formatNasQuota, readNasQuota, showNasQuotaError } from '../nasQuota';
import zh from '../../locales/zh-CN/nasQuota';
import en from '../../locales/en-US/nasQuota';
jest.mock('antd', () => ({ Modal: { error: jest.fn(), confirm: jest.fn() } }));
jest.mock('@umijs/max', () => ({ getIntl: jest.fn(), getLocale: () => 'en-US' }));
const quota = {
  errorType: 'NAS_QUOTA_EXCEEDED',
  quotaBytes: 10 * 1024 ** 3,
  usedBytes: 11 * 1024 ** 3,
  exceededBytes: 1024 ** 3,
};
it('recognizes structured errors and ignores arbitrary text', () => {
  expect(readNasQuota({ data: quota })).toEqual(quota);
  expect(readNasQuota({ msg: 'NAS_QUOTA_EXCEEDED' })).toBeUndefined();
});
it.each([
  ['zh-CN', zh],
  ['en-US', en],
] as const)('formats capacity and overage in %s', (locale, messages) => {
  const text = formatNasQuota(quota, locale, (id, values = {}) => {
    let result = messages[id as keyof typeof messages] as string;
    Object.entries(values).forEach(([key, value]) => {
      result = result.replace(`{${key}}`, String(value));
    });
    return result;
  });
  expect(text).toContain('10 GiB');
  expect(text).toContain('11 GiB');
  expect(text).toContain('1 GiB');
  if (locale === 'en-US') expect(text).not.toMatch(/[\u4e00-\u9fff]/);
});
it('keeps locale keys and interpolation parameters aligned', () => {
  expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
  Object.keys(zh).forEach((key) =>
    expect(zh[key as keyof typeof zh].match(/\{[^}]+\}/g)).toEqual(en[key as keyof typeof en].match(/\{[^}]+\}/g))
  );
});

it('does not open a business quota modal when admission is disabled', () => {
  Object.assign(globalThis, { PERSONAL_STORAGE_ADMISSION_ENABLED: false });
  (getIntl as jest.Mock).mockReturnValue({ formatMessage: ({ id }: { id: string }) => en[id as keyof typeof en] });
  expect(showNasQuotaError({ data: quota })).toBeUndefined();
  expect(Modal.error).not.toHaveBeenCalled();
});

it('deduplicates parallel quota errors into one blocking modal when explicitly enabled', () => {
  Object.assign(globalThis, { PERSONAL_STORAGE_ADMISSION_ENABLED: true });
  (getIntl as jest.Mock).mockReturnValue({ formatMessage: ({ id }: { id: string }) => en[id as keyof typeof en] });
  showNasQuotaError({ data: quota });
  showNasQuotaError({ quota });
  expect(Modal.error).toHaveBeenCalledTimes(1);
  const config = (Modal.error as jest.Mock).mock.calls[0][0];
  expect(config.title).toBe('Drive storage quota exceeded');
  config.afterClose();
});
