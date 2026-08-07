import { App } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { useIntl } from '@umijs/max';
import {
  OperationAccountPanel,
  type OperationAccount,
  type OperationAccountFormValues,
} from '@/layout/sider/components/ProjectSpaceList/operation';
import {
  createOperationAccount,
  deleteOperationAccount,
  listOperationAccounts,
  updateOperationAccount,
} from '@/service/devloop';
import type { ProjectSpace } from '../../types';

interface Props {
  project: ProjectSpace;
  keyword?: string;
  onToolbarChange?: (toolbar: React.ReactNode | null) => void;
}

const normalizeLoginStatus = (account: Record<string, any>): OperationAccount['loginStatus'] => {
  const status = `${account.loginStatus || account.status || ''}`.trim().toLowerCase();
  if (['logged_in', 'online', 'connected'].includes(status) || account.loggedIn === true) return 'logged_in';
  if (['expired', 'invalid'].includes(status)) return 'expired';
  if (['logged_out', 'offline', 'disconnected'].includes(status) || account.loggedIn === false) return 'logged_out';
  return 'unknown';
};

// 账号接口存在新旧字段并行返回的情况，大详情在数据入口统一转换为账号卡片结构。
const normalizeAccounts = (source: unknown): OperationAccount[] => {
  if (!Array.isArray(source)) return [];

  return source
    .filter((item): item is Record<string, any> => !!item && typeof item === 'object')
    .map((item, index) => ({
      id: item.id ?? item.operationAccountId ?? item.accountPkId ?? item.accountId ?? `operation-account-${index}`,
      platformId: `${item.platformId ?? item.platformCode ?? item.platform ?? item.channelId ?? ''}`,
      accountName: item.accountName || item.name || '',
      accountId: `${item.accountCode ?? item.platformAccountId ?? item.platformAccountCode ?? item.accountId ?? ''}`,
      avatar: item.avatar,
      loginStatus: normalizeLoginStatus(item),
      metrics: item.metrics,
      canEdit: item.canEdit,
    }))
    .filter((item) => item.platformId && item.accountName);
};

const ProjectAccounts: React.FC<Props> = ({ project, keyword = '', onToolbarChange }) => {
  const { message } = App.useApp();
  const intl = useIntl();
  const [accounts, setAccounts] = useState<OperationAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingAccountId, setDeletingAccountId] = useState<string | number | null>(null);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listOperationAccounts(Number(project.projectId));
      setAccounts(normalizeAccounts(result));
    } finally {
      setLoading(false);
    }
  }, [project.projectId]);

  useEffect(() => {
    void fetchAccounts();
  }, [fetchAccounts]);

  const handleSave = useCallback(
    async (values: OperationAccountFormValues, account?: OperationAccount | null) => {
      setSaving(true);
      try {
        const payload = {
          projectId: Number(project.projectId),
          platformCode: values.platformId,
          accountCode: values.accountId,
          accountName: values.accountName,
        };
        if (account) {
          await updateOperationAccount({ ...payload, accountId: account.id });
        } else {
          await createOperationAccount(payload);
        }
        await fetchAccounts();
        message.success(intl.formatMessage({ id: 'projectSpace.operation.account.saveSuccess' }));
      } finally {
        setSaving(false);
      }
    },
    [fetchAccounts, intl, message, project.projectId]
  );

  const handleDelete = useCallback(
    async (account: OperationAccount) => {
      setDeletingAccountId(account.id);
      try {
        await deleteOperationAccount(account.id);
        await fetchAccounts();
        message.success(intl.formatMessage({ id: 'projectSpace.operation.account.deleteSuccess' }));
      } finally {
        setDeletingAccountId(null);
      }
    },
    [fetchAccounts, intl, message]
  );

  return (
    <OperationAccountPanel
      accounts={accounts.filter((account) =>
        `${account.accountName} ${account.accountId}`.toLowerCase().includes(keyword.trim().toLowerCase())
      )}
      compact
      toolbarPlacement="external"
      onToolbarChange={onToolbarChange}
      loading={loading}
      savingAccount={saving}
      deletingAccountId={deletingAccountId}
      onRefresh={fetchAccounts}
      onSaveAccount={handleSave}
      onDeleteAccount={handleDelete}
    />
  );
};

export default ProjectAccounts;
