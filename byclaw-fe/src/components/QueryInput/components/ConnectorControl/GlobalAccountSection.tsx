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
import { createGlobalOperationAccount, listGlobalOperationAccounts } from '@/service/devloop';

interface GlobalAccountSectionProps {
  onToolbarChange?: (toolbar: ReactNode | null) => void;
}

const GlobalAccountSection = ({ onToolbarChange }: GlobalAccountSectionProps) => {
  const intl = useIntl();
  const [accounts, setAccounts] = useState<OperationAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
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
    async (values: OperationAccountFormValues) => {
      setSaving(true);
      try {
        await createGlobalOperationAccount(buildGlobalOperationAccountPayload(values));
        await loadAccounts();
        message.success(intl.formatMessage({ id: 'projectSpace.operation.account.saveSuccess' }));
      } finally {
        setSaving(false);
      }
    },
    [intl, loadAccounts]
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
      allowAccountEditing={false}
      onToolbarChange={onToolbarChange}
      loading={loading}
      savingAccount={saving}
      loginTarget={loginTarget}
      loginPreparingAccountId={loginPreparingAccountId}
      loginConfirming={loginConfirming}
      onRefresh={loadAccounts}
      onSaveAccount={handleSave}
      onLogin={handleLogin}
      onConfirmLogin={handleConfirmLogin}
      onCancelLogin={closeRemoteDesktop}
    />
  );
};

export default GlobalAccountSection;
