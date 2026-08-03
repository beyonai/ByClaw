import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Empty, Modal, Segmented, Spin, Tag } from 'antd';
import { ArrowLeftOutlined, DeleteOutlined, EditOutlined, LoginOutlined, PlusOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import OperationAccountFormModal from './OperationAccountFormModal';
import type {
  OperationAccount,
  OperationAccountFormValues,
  OperationIdentifier,
  OperationPlatformOption,
} from './types';
import styles from './index.module.less';

// 账号管理大面板只负责展示与交互，读取、保存、登录及权限判断全部由项目详情容器传入。
export interface OperationAccountPanelProps {
  accounts?: OperationAccount[];
  platformOptions?: OperationPlatformOption[];
  loading?: boolean;
  savingAccount?: boolean;
  canManage?: boolean;
  loginTarget?: OperationAccount | null;
  loginPreparingAccountId?: OperationIdentifier | null;
  loginConfirming?: boolean;
  deletingAccountId?: OperationIdentifier | null;
  onBack?: () => void;
  onAccountClick?: (account: OperationAccount) => void;
  onLogin?: (account: OperationAccount) => void | Promise<void>;
  onConfirmLogin?: () => void | Promise<void>;
  onCancelLogin?: () => void;
  onDeleteAccount?: (account: OperationAccount) => void | Promise<void>;
  onSaveAccount?: (values: OperationAccountFormValues, account?: OperationAccount | null) => void | Promise<void>;
}

// 登录状态使用固定颜色，避免接口中不同平台的状态文案直接影响视觉语义。
const ACCOUNT_STATUS_COLOR: Record<NonNullable<OperationAccount['loginStatus']>, string> = {
  logged_in: 'success',
  logged_out: 'default',
  expired: 'warning',
  unknown: 'default',
};

const OperationAccountPanel: React.FC<OperationAccountPanelProps> = ({
  accounts = [],
  platformOptions,
  loading = false,
  savingAccount = false,
  canManage = true,
  loginTarget,
  loginPreparingAccountId,
  loginConfirming = false,
  deletingAccountId,
  onBack,
  onAccountClick,
  onLogin,
  onConfirmLogin,
  onCancelLogin,
  onDeleteAccount,
  onSaveAccount,
}) => {
  const intl = useIntl();
  const [activePlatform, setActivePlatform] = useState('all');
  const [accountFormOpen, setAccountFormOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<OperationAccount | null>(null);
  const t = useCallback(
    (id: string, values?: Record<string, string | number>) =>
      intl.formatMessage({ id: `projectSpace.operation.account.${id}` }, values),
    [intl]
  );
  const platformT = useCallback(
    (id: string) => intl.formatMessage({ id: `projectSpace.operation.platform.${id}` }),
    [intl]
  );
  const loginT = useCallback(
    (id: string, values?: Record<string, string | number>) =>
      intl.formatMessage({ id: `projectSpace.operation.accountLogin.${id}` }, values),
    [intl]
  );
  // 账号接口未配置平台字典时沿用产品支持的平台，后端下发时优先使用后端数据。
  const defaultPlatformOptions = useMemo<OperationPlatformOption[]>(
    () => [
      // 平台编码统一使用 OPERATION_CHANNEL 静态参数值，避免账号筛选与任务表单出现不同编码。
      { value: 'WeChatAccount', label: platformT('wechat') },
      { value: 'Xiaohongshu', label: platformT('xiaohongshu') },
      { value: 'WeChatChannels', label: platformT('video') },
      { value: 'Douyin', label: platformT('douyin') },
    ],
    [platformT]
  );
  const availablePlatformOptions = platformOptions?.length ? platformOptions : defaultPlatformOptions;
  const platformOptionMap = useMemo(
    () => new Map(availablePlatformOptions.map((option) => [option.value, option])),
    [availablePlatformOptions]
  );
  const filterOptions = useMemo(
    () => [
      { value: 'all', label: platformT('all') },
      ...availablePlatformOptions.map((option) => ({ value: option.value, label: option.label })),
    ],
    [availablePlatformOptions, platformT]
  );
  const filteredAccounts = useMemo(
    () => (activePlatform === 'all' ? accounts : accounts.filter((account) => account.platformId === activePlatform)),
    [accounts, activePlatform]
  );
  const loggedInCount = useMemo(
    () => accounts.filter((account) => account.loginStatus === 'logged_in').length,
    [accounts]
  );
  const platformCount = useMemo(() => new Set(accounts.map((account) => account.platformId)).size, [accounts]);
  // 没有管理权限或没有保存回调时，隐藏新增和编辑入口，防止出现不可完成的操作。
  const canSaveAccount = canManage && !!onSaveAccount;

  useEffect(() => {
    // 后端刷新平台列表后，若当前筛选平台已失效则回退到全部账号。
    if (activePlatform === 'all') return;
    if (!availablePlatformOptions.some((option) => option.value === activePlatform)) {
      setActivePlatform('all');
    }
  }, [activePlatform, availablePlatformOptions]);

  const openAddAccountModal = useCallback(() => {
    if (!canSaveAccount) return;
    setEditingAccount(null);
    setAccountFormOpen(true);
  }, [canSaveAccount]);

  const openEditAccountModal = useCallback(
    (account: OperationAccount) => {
      if (!canSaveAccount || account.canEdit === false) return;
      setEditingAccount(account);
      setAccountFormOpen(true);
    },
    [canSaveAccount]
  );

  const handleSaveAccount = useCallback(
    async (values: OperationAccountFormValues, account?: OperationAccount | null) => {
      if (!onSaveAccount) return;
      await onSaveAccount(values, account);
      // 父组件保存成功后再关闭弹窗，接口失败时保留表单供用户修改后重试。
      setAccountFormOpen(false);
      setEditingAccount(null);
    },
    [onSaveAccount]
  );

  const handleAccountKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>, account: OperationAccount) => {
      if (event.target !== event.currentTarget || !onAccountClick || (event.key !== 'Enter' && event.key !== ' ')) {
        return;
      }
      event.preventDefault();
      onAccountClick(account);
    },
    [onAccountClick]
  );

  const handleDeleteAccount = useCallback(
    (account: OperationAccount) => {
      if (!onDeleteAccount) return;
      Modal.confirm({
        title: t('deleteConfirmTitle'),
        content: t('deleteConfirmContent', { account: account.accountName }),
        okText: t('deleteConfirmOk'),
        cancelText: t('deleteConfirmCancel'),
        okButtonProps: { danger: true },
        onOk: () => onDeleteAccount(account),
      });
    },
    [onDeleteAccount, t]
  );

  const renderMetric = (value?: string | number) =>
    value === undefined || value === null || value === '' ? '-' : value;

  return (
    <div className={styles.accountPanel}>
      <header className={styles.accountPanelHeader}>
        <div className={styles.accountPanelHeading}>
          {onBack && (
            <Button
              className={styles.operationBackButton}
              type="text"
              icon={<ArrowLeftOutlined />}
              aria-label={t('back')}
              onClick={onBack}
            />
          )}
          <div>
            <h2>{t('title')}</h2>
            <p>{t('description')}</p>
          </div>
        </div>
        {canSaveAccount && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openAddAccountModal}>
            {t('add')}
          </Button>
        )}
      </header>

      {loginTarget && (
        <section className={styles.accountLoginNotice} aria-live="polite">
          <div className={styles.accountLoginNoticeContent}>
            <strong>{loginT('remoteTitle', { account: loginTarget.accountName })}</strong>
            <span>{loginT('remoteHint')}</span>
          </div>
          <div className={styles.accountLoginNoticeActions}>
            <Button disabled={loginConfirming} onClick={onCancelLogin}>
              {loginT('cancel')}
            </Button>
            <Button type="primary" loading={loginConfirming} onClick={() => void onConfirmLogin?.()}>
              {loginT('complete')}
            </Button>
          </div>
        </section>
      )}

      <section className={styles.accountStats} aria-label={t('statistics')}>
        <div className={styles.accountStatItem}>
          <strong>{accounts.length}</strong>
          <span>{t('stat.total')}</span>
        </div>
        <div className={styles.accountStatItem}>
          <strong>{loggedInCount}</strong>
          <span>{t('stat.loggedIn')}</span>
        </div>
        <div className={styles.accountStatItem}>
          <strong>{platformCount}</strong>
          <span>{t('stat.platforms')}</span>
        </div>
      </section>

      <div className={styles.accountFilterRow}>
        <Segmented
          className={styles.accountPlatformFilter}
          value={activePlatform}
          options={filterOptions}
          onChange={(value) => setActivePlatform(String(value))}
        />
        <span className={styles.accountFilterCount}>{t('resultCount', { count: filteredAccounts.length })}</span>
      </div>

      <Spin spinning={loading} wrapperClassName={styles.accountPanelSpin}>
        {filteredAccounts.length === 0 ? (
          <div className={styles.accountEmpty}>
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('empty')} />
          </div>
        ) : (
          <div className={styles.accountGrid}>
            {filteredAccounts.map((account) => {
              const platform = platformOptionMap.get(account.platformId);
              const platformLabel = platform?.label || account.platformId;
              const status = account.loginStatus || 'unknown';
              // 当前支持的四个运营平台均通过 UI Agent 浏览器登录，历史短编码继续兼容。
              const canLogin = [
                'WeChatAccount',
                'wechat',
                'Xiaohongshu',
                'xiaohongshu',
                'WeChatChannels',
                'video',
                'Douyin',
                'douyin',
              ].includes(account.platformId);
              return (
                <article
                  key={String(account.id)}
                  className={`${styles.accountCard} ${onAccountClick ? styles.accountCardClickable : ''}`}
                  role={onAccountClick ? 'button' : undefined}
                  tabIndex={onAccountClick ? 0 : undefined}
                  onClick={() => onAccountClick?.(account)}
                  onKeyDown={(event) => handleAccountKeyDown(event, account)}
                >
                  <div className={styles.accountCardHeader}>
                    <span className={styles.accountPlatformMark}>{platform?.mark || platformLabel.slice(0, 1)}</span>
                    <div className={styles.accountCardIdentity}>
                      <strong title={account.accountName}>{account.accountName}</strong>
                      <span title={account.accountId}>{account.accountId}</span>
                    </div>
                    <Tag color={ACCOUNT_STATUS_COLOR[status]}>{t(`status.${status}`)}</Tag>
                  </div>
                  <div className={styles.accountPlatformName}>{platformLabel}</div>
                  <div className={styles.accountMetricGrid}>
                    <div>
                      <strong>{renderMetric(account.metrics?.followers)}</strong>
                      <span>{t('metric.followers')}</span>
                    </div>
                    <div>
                      <strong>{renderMetric(account.metrics?.works)}</strong>
                      <span>{t('metric.works')}</span>
                    </div>
                    <div>
                      <strong>{renderMetric(account.metrics?.views)}</strong>
                      <span>{t('metric.views')}</span>
                    </div>
                    <div>
                      <strong>{renderMetric(account.metrics?.followerGrowth)}</strong>
                      <span>{t('metric.growth')}</span>
                    </div>
                  </div>
                  <div className={styles.accountCardFooter}>
                    <span>{t('recentData')}</span>
                    <div className={styles.accountCardActions}>
                      {onLogin && canLogin && (
                        <Button
                          type="link"
                          size="small"
                          icon={<LoginOutlined />}
                          loading={`${loginPreparingAccountId ?? ''}` === `${account.id}`}
                          disabled={
                            !!loginTarget ||
                            loginConfirming ||
                            (loginPreparingAccountId !== undefined &&
                              loginPreparingAccountId !== null &&
                              `${loginPreparingAccountId}` !== `${account.id}`)
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            // 登录失败由统一请求层提示，卡片侧消费 reject，避免事件回调产生未处理 Promise。
                            void Promise.resolve(onLogin(account)).catch(() => undefined);
                          }}
                        >
                          {t(status === 'logged_in' ? 'relogin' : 'login')}
                        </Button>
                      )}
                      {canSaveAccount && account.canEdit !== false && (
                        <Button
                          type="link"
                          size="small"
                          icon={<EditOutlined />}
                          onClick={(event) => {
                            event.stopPropagation();
                            openEditAccountModal(account);
                          }}
                        >
                          {t('edit')}
                        </Button>
                      )}
                      {canSaveAccount && onDeleteAccount && account.canEdit !== false && (
                        <Button
                          danger
                          type="link"
                          size="small"
                          icon={<DeleteOutlined />}
                          loading={`${deletingAccountId ?? ''}` === `${account.id}`}
                          disabled={deletingAccountId !== undefined && deletingAccountId !== null}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleDeleteAccount(account);
                          }}
                        >
                          {t('delete')}
                        </Button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Spin>

      <OperationAccountFormModal
        open={accountFormOpen}
        account={editingAccount}
        platformOptions={availablePlatformOptions}
        loading={savingAccount}
        onCancel={() => {
          setAccountFormOpen(false);
          setEditingAccount(null);
        }}
        onSubmit={handleSaveAccount}
      />
    </div>
  );
};

export default OperationAccountPanel;
