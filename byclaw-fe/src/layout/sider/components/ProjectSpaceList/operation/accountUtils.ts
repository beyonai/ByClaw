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
          ? '自定义链接'
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
