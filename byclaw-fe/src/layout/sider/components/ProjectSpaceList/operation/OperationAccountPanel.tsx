import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Dropdown, Empty, Modal, Select, Segmented, Spin, Tag } from 'antd';
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  EditOutlined,
  LoginOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
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
  // 由详情页“新增账号”菜单触发时，账号面板打开后自动显示新增表单。
  openCreateModal?: boolean;
  onCreateModalOpened?: () => void;
  onRefresh?: () => void | Promise<void>;
  // 项目大详情使用紧凑模式，标题说明和筛选栏收拢到同一行；小详情继续使用完整面板布局。
  compact?: boolean;
  toolbarPlacement?: 'inline' | 'external';
  onToolbarChange?: (toolbar: React.ReactNode | null) => void;
  onRefreshToolbarChange?: (toolbar: React.ReactNode | null) => void;
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
  openCreateModal = false,
  onCreateModalOpened,
  onRefresh,
  compact = false,
  toolbarPlacement = 'inline',
  onToolbarChange,
  onRefreshToolbarChange,
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
  // 没有管理权限或没有保存回调时，隐藏新增和编辑入口，防止出现不可完成的操作。
  const canSaveAccount = canManage && !!onSaveAccount;
  const openAddAccountModal = useCallback(() => {
    if (!canSaveAccount) return;
    setEditingAccount(null);
    setAccountFormOpen(true);
  }, [canSaveAccount]);

  useEffect(() => {
    if (!onToolbarChange || toolbarPlacement !== 'external') return;
    // 大详情把账号筛选和新增账号提升到页面顶部，刷新按钮单独放到最右侧。
    onToolbarChange(
      <div className={styles.accountPanelActions}>
        <Select
          className={styles.accountCompactFilter}
          value={activePlatform}
          options={filterOptions}
          onChange={(value) => setActivePlatform(String(value))}
        />
        {canSaveAccount && (
          // 大详情页的新增账号按钮与需求 Tab 的新增需求按钮使用统一的次级按钮样式。
          <Button icon={<PlusOutlined />} onClick={openAddAccountModal}>
            {t('add')}
          </Button>
        )}
      </div>
    );
    onRefreshToolbarChange?.(
      onRefresh ? (
        <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void onRefresh()}>
          {intl.formatMessage({ id: 'projectSpace.detail.common.refresh' })}
        </Button>
      ) : null
    );
    return () => {
      onToolbarChange(null);
      onRefreshToolbarChange?.(null);
    };
  }, [
    activePlatform,
    canSaveAccount,
    filterOptions,
    intl,
    loading,
    onRefresh,
    onRefreshToolbarChange,
    onToolbarChange,
    openAddAccountModal,
    t,
    toolbarPlacement,
  ]);

  useEffect(() => {
    // 后端刷新平台列表后，若当前筛选平台已失效则回退到全部账号。
    if (activePlatform === 'all') return;
    if (!availablePlatformOptions.some((option) => option.value === activePlatform)) {
      setActivePlatform('all');
    }
  }, [activePlatform, availablePlatformOptions]);

  useEffect(() => {
    if (!openCreateModal || !canSaveAccount) return;
    openAddAccountModal();
    // 通知父容器消费本次请求，避免账号面板后续普通刷新时重复打开新增表单。
    onCreateModalOpened?.();
  }, [canSaveAccount, onCreateModalOpened, openAddAccountModal, openCreateModal]);

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

  return (
    <div
      className={`${styles.accountPanel} ${compact ? styles.accountPanelCompact : ''} ${
        toolbarPlacement === 'external' ? styles.accountPanelCompactExternal : ''
      }`}
    >
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
        {toolbarPlacement === 'inline' && (
          <div className={styles.accountPanelActions}>
            {compact && (
              <Select
                className={styles.accountCompactFilter}
                value={activePlatform}
                options={filterOptions}
                onChange={(value) => setActivePlatform(String(value))}
              />
            )}
            {onRefresh && (
              <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void onRefresh()}>
                {intl.formatMessage({ id: 'projectSpace.detail.common.refresh' })}
              </Button>
            )}
            {canSaveAccount && (
              <Button type="primary" icon={<PlusOutlined />} onClick={openAddAccountModal}>
                {t('add')}
              </Button>
            )}
          </div>
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
              const canEditAccount = canSaveAccount && account.canEdit !== false;
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
                    <Tag className={styles.accountStatusTag} color={ACCOUNT_STATUS_COLOR[status]}>
                      {t(`status.${status}`)}
                    </Tag>
                  </div>
                  {canEditAccount && (
                    <Dropdown
                      trigger={['hover']}
                      menu={{
                        items: [
                          { key: 'edit', icon: <EditOutlined />, label: t('edit') },
                          ...(onDeleteAccount
                            ? [{ key: 'delete', danger: true, icon: <DeleteOutlined />, label: t('delete') }]
                            : []),
                        ],
                        onClick: ({ key, domEvent }) => {
                          domEvent.stopPropagation();
                          if (key === 'edit') openEditAccountModal(account);
                          if (key === 'delete') handleDeleteAccount(account);
                        },
                      }}
                    >
                      {/* 编辑和删除收进悬停菜单，避免常驻按钮挤占账号信息区域。 */}
                      <Button
                        type="text"
                        size="small"
                        className={styles.accountCardMoreAction}
                        icon={<MoreOutlined />}
                        loading={`${deletingAccountId ?? ''}` === `${account.id}`}
                        aria-label="账号操作"
                        onClick={(event) => event.stopPropagation()}
                      />
                    </Dropdown>
                  )}
                  <div className={styles.accountPlatformName}>{platformLabel}</div>
                  {/* 当前版本暂不展示账号指标和近 30 天统计，仅保留账号操作按钮。 */}
                  <div className={styles.accountCardFooter}>
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
