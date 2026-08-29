import { App } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { useIntl } from '@umijs/max';
import {
  normalizeOperationAccounts,
  OperationAccountPanel,
  useOperationAccountLogin,
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
  onRefreshToolbarChange?: (toolbar: React.ReactNode | null) => void;
}

// 账号接口存在新旧字段并行返回的情况，大详情在数据入口统一转换为账号卡片结构。
export const normalizeAccounts = normalizeOperationAccounts;

export const buildOperationAccountPayload = (projectId: number, values: OperationAccountFormValues) => {
  const isCustomLink = values.platformId === 'CustomLink';
  return {
    projectId,
    platformCode: values.platformId,
    accountCode: isCustomLink ? '' : values.accountId,
    accountName: values.accountName,
    ...(isCustomLink ? { customUrl: values.customUrl || '' } : {}),
  };
};

const ProjectAccounts: React.FC<Props> = ({ project, keyword = '', onToolbarChange, onRefreshToolbarChange }) => {
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
      setAccounts(normalizeOperationAccounts(result));
    } finally {
      setLoading(false);
    }
  }, [project.projectId]);

  useEffect(() => {
    void fetchAccounts();
  }, [fetchAccounts]);

  // 账号登录复用大详情的沙箱远程桌面链路，登录完成后刷新卡片状态。
  const { loginTarget, loginPreparingAccountId, loginConfirming, handleLogin, handleConfirmLogin, closeRemoteDesktop } =
    useOperationAccountLogin(fetchAccounts);

  // 离开账号页时收起远程桌面，避免遗留遮罩层覆盖其他页签。
  useEffect(() => closeRemoteDesktop, [closeRemoteDesktop]);

  const handleSave = useCallback(
    async (values: OperationAccountFormValues, account?: OperationAccount | null) => {
      setSaving(true);
      try {
        const payload = buildOperationAccountPayload(Number(project.projectId), values);
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
        // 删除正在登录的账号时先收起远程桌面，避免继续操作已失效账号。
        if (`${loginTarget?.id ?? ''}` === `${account.id}`) closeRemoteDesktop();
        await fetchAccounts();
        message.success(intl.formatMessage({ id: 'projectSpace.operation.account.deleteSuccess' }));
      } finally {
        setDeletingAccountId(null);
      }
    },
    [closeRemoteDesktop, fetchAccounts, intl, loginTarget?.id, message]
  );

  return (
    <OperationAccountPanel
      accounts={accounts.filter((account) =>
        `${account.accountName} ${account.accountId}`.toLowerCase().includes(keyword.trim().toLowerCase())
      )}
      compact
      toolbarPlacement="external"
      onToolbarChange={onToolbarChange}
      onRefreshToolbarChange={onRefreshToolbarChange}
      loading={loading}
      savingAccount={saving}
      deletingAccountId={deletingAccountId}
      loginTarget={loginTarget}
      loginPreparingAccountId={loginPreparingAccountId}
      loginConfirming={loginConfirming}
      onRefresh={fetchAccounts}
      onSaveAccount={handleSave}
      onDeleteAccount={handleDelete}
      onLogin={handleLogin}
      onConfirmLogin={handleConfirmLogin}
      onCancelLogin={closeRemoteDesktop}
    />
  );
};

export default ProjectAccounts;
