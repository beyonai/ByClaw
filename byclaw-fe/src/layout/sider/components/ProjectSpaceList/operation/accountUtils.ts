import { getIntl } from '@umijs/max';
import type { OperationAccount, OperationAccountFormValues } from './types';

const normalizeLoginStatus = (account: Record<string, any>): OperationAccount['loginStatus'] => {
  const status = `${account.loginStatus || account.status || ''}`.trim().toLowerCase();
  if (['logged_in', 'online', 'connected'].includes(status) || account.loggedIn === true) return 'logged_in';
  if (['expired', 'invalid'].includes(status)) return 'expired';
  if (['logged_out', 'offline', 'disconnected'].includes(status) || account.loggedIn === false) return 'logged_out';
  return 'unknown';
};

export const normalizeOperationAccounts = (source: unknown): OperationAccount[] => {
  if (!Array.isArray(source)) return [];

  return source
    .filter((item): item is Record<string, any> => !!item && typeof item === 'object')
    .map((item, index) => ({
      id: item.id ?? item.operationAccountId ?? item.accountPkId ?? item.accountId ?? `operation-account-${index}`,
      platformId: `${item.platformId ?? item.platformCode ?? item.platform ?? item.channelId ?? ''}`,
      accountName:
        item.accountName ||
        item.name ||
        (`${item.platformId ?? item.platformCode ?? item.platform ?? item.channelId ?? ''}` === 'CustomLink'
          ? getIntl().formatMessage({ id: 'projectSpace.operation.accountForm.field.customUrl' })
          : ''),
      accountId: `${item.accountCode ?? item.platformAccountId ?? item.platformAccountCode ?? item.accountId ?? ''}`,
      avatar: item.avatar,
      loginStatus: normalizeLoginStatus(item),
      metrics: item.metrics,
      canEdit: item.canEdit,
      customUrl: item.customUrl || undefined,
    }))
    .filter((item) => item.platformId && item.accountName);
};

export const buildGlobalOperationAccountPayload = (values: OperationAccountFormValues) => {
  const isCustomLink = values.platformId === 'CustomLink';
  return {
    platformCode: values.platformId,
    accountCode: isCustomLink ? '' : values.accountId,
    accountName: values.accountName,
    ...(isCustomLink ? { customUrl: values.customUrl || '' } : {}),
  };
};

/**
 * 账号登录需要远程桌面时要拉起的沙箱规格：常驻 DSH 宿主上的用户，浏览器在其工具沙箱里（BE 返回其规格）；
 * 其他用户沿用默认的 openclaw 沙箱。
 */
export const browserSandboxServiceKey = (browserServiceKey: string | null | undefined): string =>
  browserServiceKey || 'openclaw';
