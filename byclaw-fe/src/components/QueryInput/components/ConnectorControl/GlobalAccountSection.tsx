import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { message } from 'antd';
import { useIntl } from '@umijs/max';
import {
  buildGlobalOperationAccountPayload,
  normalizeOperationAccounts,
  OperationAccountPanel,
  useOperationAccountLogin,
  type OperationAccount,
  type OperationAccountFormValues,
} from '@/layout/sider/components/ProjectSpaceList/operation';
import {
  createGlobalOperationAccount,
  deleteOperationAccount,
  listGlobalOperationAccounts,
  updateOperationAccount,
} from '@/service/devloop';

interface GlobalAccountSectionProps {
  onToolbarChange?: (toolbar: ReactNode | null) => void;
}

const GlobalAccountSection = ({ onToolbarChange }: GlobalAccountSectionProps) => {
  const intl = useIntl();
  const [accounts, setAccounts] = useState<OperationAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingAccountId, setDeletingAccountId] = useState<OperationAccount['id'] | null>(null);
  const loadGenerationRef = useRef(0);

  const loadAccounts = useCallback(async () => {
    const requestGeneration = ++loadGenerationRef.current;
    setLoading(true);
    try {
      const result = await listGlobalOperationAccounts();
      if (loadGenerationRef.current !== requestGeneration) return;
      setAccounts(normalizeOperationAccounts(result));
    } catch {
      if (loadGenerationRef.current !== requestGeneration) return;
      message.error(intl.formatMessage({ id: 'connector.accounts.loadFailed' }));
    } finally {
      if (loadGenerationRef.current === requestGeneration) {
        setLoading(false);
      }
    }
  }, [intl]);

  useEffect(() => {
    void loadAccounts();
    return () => {
      loadGenerationRef.current += 1;
    };
  }, [loadAccounts]);

  const { loginTarget, loginPreparingAccountId, loginConfirming, handleLogin, handleConfirmLogin, closeRemoteDesktop } =
    useOperationAccountLogin(loadAccounts);

  useEffect(() => closeRemoteDesktop, [closeRemoteDesktop]);

  const handleSave = useCallback(
    async (values: OperationAccountFormValues, account?: OperationAccount | null) => {
      setSaving(true);
      try {
        const payload = buildGlobalOperationAccountPayload(values);
        if (account) {
          await updateOperationAccount({ ...payload, accountId: account.id });
        } else {
          const result: any = await createGlobalOperationAccount(payload);
          // 新增账号保存成功后，沿用账号卡片的登录链路，自动打开右侧远程桌面。
          const createdAccountId = result?.accountId ?? result?.data?.accountId ?? result?.id ?? result?.data?.id;
          if (createdAccountId !== undefined && createdAccountId !== null) {
            await handleLogin({
              id: createdAccountId,
              platformId: values.platformId,
              accountName: values.accountName,
              accountId: values.accountId,
              customUrl: values.customUrl,
            });
          }
        }
        await loadAccounts();
        message.success(intl.formatMessage({ id: 'projectSpace.operation.account.saveSuccess' }));
      } finally {
        setSaving(false);
      }
    },
    [handleLogin, intl, loadAccounts]
  );

  const handleDelete = useCallback(
    async (account: OperationAccount) => {
      setDeletingAccountId(account.id);
      try {
        await deleteOperationAccount(account.id);
        if (`${loginTarget?.id ?? ''}` === `${account.id}`) closeRemoteDesktop();
        await loadAccounts();
        message.success(intl.formatMessage({ id: 'projectSpace.operation.account.deleteSuccess' }));
      } catch {
        // 请求层已统一提示错误；Drawer 保留当前账号列表并恢复卡片操作状态。
      } finally {
        setDeletingAccountId(null);
      }
    },
    [closeRemoteDesktop, intl, loadAccounts, loginTarget?.id]
  );

  return (
    <OperationAccountPanel
      accounts={accounts}
      fixedCreatePlatformId="CustomLink"
      compact
      cardsOnly
      drawerCardLayout
      toolbarPlacement="external"
      showPlatformFilter={false}
      allowAccountEditing
      onToolbarChange={onToolbarChange}
      loading={loading}
      savingAccount={saving}
      deletingAccountId={deletingAccountId}
      loginTarget={loginTarget}
      loginPreparingAccountId={loginPreparingAccountId}
      loginConfirming={loginConfirming}
      onRefresh={loadAccounts}
      onDeleteAccount={handleDelete}
      onSaveAccount={handleSave}
      onLogin={handleLogin}
      onConfirmLogin={handleConfirmLogin}
      onCancelLogin={closeRemoteDesktop}
    />
  );
};

export default GlobalAccountSection;
