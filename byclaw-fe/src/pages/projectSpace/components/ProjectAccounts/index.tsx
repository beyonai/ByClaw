import { App } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { useIntl } from '@umijs/max';
import {
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
      customUrl: item.customUrl || undefined,
    }))
    .filter((item) => item.platformId && item.accountName);
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
      setAccounts(normalizeAccounts(result));
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
        const isCustomLink = values.platformId === 'CustomLink';
        // 自定义链接平台不填账号名称和标识，后端按平台补默认值，只需提交登录地址。
        const payload = {
          projectId: Number(project.projectId),
          platformCode: values.platformId,
          accountCode: isCustomLink ? '' : values.accountId,
          accountName: isCustomLink ? '' : values.accountName,
          ...(isCustomLink ? { customUrl: values.customUrl || '' } : {}),
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
