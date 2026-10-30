import { getIntl, getLocale } from '@umijs/max';
import { Modal } from 'antd';
import { isPersonalStorageAdmissionEnabled } from './personalStorageAdmission';

export interface NasQuotaDetails {
  errorType: 'NAS_QUOTA_EXCEEDED';
  quotaBytes?: number;
  usedBytes?: number;
  requestedBytes?: number;
  exceededBytes?: number;
  actualRejection?: boolean;
}

type FormatMessage = (id: string, values?: Record<string, string>) => string;
type UpgradeHandler = (quota: NasQuotaDetails) => void | Promise<void>;
let upgradeHandler: UpgradeHandler | undefined;
let modalOpen = false;

/** SaaS integration registers its own authorized upgrade/order flow. */
export const registerNasQuotaUpgradeHandler = (handler: UpgradeHandler) => {
  upgradeHandler = handler;
  return () => {
    if (upgradeHandler === handler) upgradeHandler = undefined;
  };
};

export const readNasQuota = (value: unknown): NasQuotaDetails | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const candidate = record.errorType === 'NAS_QUOTA_EXCEEDED' ? record : record.quota ?? record.data;
  if (!candidate || typeof candidate !== 'object') return undefined;
  const quota = candidate as NasQuotaDetails;
  return quota.errorType === 'NAS_QUOTA_EXCEEDED' ? quota : undefined;
};

export const formatNasQuota = (quota: NasQuotaDetails, locale: string, t: FormatMessage): string => {
  const bytes = (value: unknown) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return t('nasQuota.unknown');
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
    const index = value === 0 ? 0 : Math.min(5, Math.floor(Math.log(value) / Math.log(1024)));
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value / 1024 ** index)} ${
      units[index]
    }`;
  };
  const summary = t('nasQuota.summary', { quota: bytes(quota.quotaBytes), used: bytes(quota.usedBytes) });
  let overage = t('nasQuota.unknownOverage');
  if (typeof quota.exceededBytes === 'number' && quota.exceededBytes > 0) {
    overage = t(quota.requestedBytes ? 'nasQuota.projected' : 'nasQuota.overage', {
      exceeded: bytes(quota.exceededBytes),
    });
  } else if (typeof quota.usedBytes === 'number' && quota.usedBytes === quota.quotaBytes) {
    overage = t('nasQuota.full');
  }
  return `${summary} ${overage} ${t('nasQuota.action')}`;
};

/** HTTP and SSE/WebSocket share one modal. Parallel failures never stack dialogs. */
export const showNasQuotaError = (value: unknown): string | undefined => {
  // Let the caller's normal error path retain actual HTTP/filesystem failures.
  if (!isPersonalStorageAdmissionEnabled()) return undefined;
  const quota = readNasQuota(value);
  if (!quota) return undefined;
  const t: FormatMessage = (id, values) => getIntl().formatMessage({ id }, values);
  const content = formatNasQuota(quota, getLocale(), t);
  if (!modalOpen) {
    modalOpen = true;
    const handler = upgradeHandler;
    const config = {
      title: t('nasQuota.title'),
      content,
      afterClose: () => {
        modalOpen = false;
      },
      okText: t(handler ? 'nasQuota.upgrade' : 'nasQuota.close'),
    };
    if (handler) {
      Modal.confirm({ ...config, cancelText: t('nasQuota.cancel'), onOk: () => handler(quota) });
    } else {
      Modal.error(config);
    }
  }
  return content;
};
