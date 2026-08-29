import type { KeyboardEvent } from 'react';
import { Button, Dropdown, Modal, Tag } from 'antd';
import { DeleteOutlined, EditOutlined, LoginOutlined, MoreOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import type { OperationAccount, OperationIdentifier, OperationPlatformOption } from './types';
import styles from './index.module.less';

export interface OperationAccountCardsProps {
  accounts: OperationAccount[];
  platformOptions: OperationPlatformOption[];
  canEditAccount?: (account: OperationAccount) => boolean;
  loginTarget?: OperationAccount | null;
  loginPreparingAccountId?: OperationIdentifier | null;
  loginConfirming?: boolean;
  deletingAccountId?: OperationIdentifier | null;
  compact?: boolean;
  onAccountClick?: (account: OperationAccount) => void;
  onEditAccount?: (account: OperationAccount) => void;
  onDeleteAccount?: (account: OperationAccount) => void | Promise<void>;
  onLogin?: (account: OperationAccount) => void | Promise<void>;
}

const ACCOUNT_STATUS_COLOR: Record<NonNullable<OperationAccount['loginStatus']>, string> = {
  logged_in: 'success',
  logged_out: 'warning',
  expired: 'warning',
  unknown: 'default',
};

const LOGIN_PLATFORM_CODES = new Set([
  'WeChatAccount',
  'wechat',
  'Xiaohongshu',
  'xiaohongshu',
  'WeChatChannels',
  'video',
  'Douyin',
  'douyin',
  'CustomLink',
]);

const OperationAccountCards = ({
  accounts,
  platformOptions,
  canEditAccount = () => false,
  loginTarget,
  loginPreparingAccountId,
  loginConfirming = false,
  deletingAccountId,
  compact = false,
  onAccountClick,
  onEditAccount,
  onDeleteAccount,
  onLogin,
}: OperationAccountCardsProps) => {
  const intl = useIntl();
  const platformOptionMap = new Map(platformOptions.map((option) => [option.value, option]));
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id: `projectSpace.operation.account.${id}` }, values);

  const handleAccountKeyDown = (event: KeyboardEvent<HTMLElement>, account: OperationAccount) => {
    if (event.target !== event.currentTarget || !onAccountClick || (event.key !== 'Enter' && event.key !== ' ')) {
      return;
    }
    event.preventDefault();
    onAccountClick(account);
  };

  const handleDeleteAccount = (account: OperationAccount) => {
    if (!onDeleteAccount) return;
    Modal.confirm({
      title: t('deleteConfirmTitle'),
      content: t('deleteConfirmContent', { account: account.accountName }),
      okText: t('deleteConfirmOk'),
      cancelText: t('deleteConfirmCancel'),
      okButtonProps: { danger: true },
      onOk: () => onDeleteAccount(account),
    });
  };

  return (
    <>
      {accounts.map((account) => {
        const platform = platformOptionMap.get(account.platformId);
        const platformLabel = platform?.label || account.platformId;
        const accountName =
          account.accountName || (account.platformId === 'CustomLink' ? platformLabel : account.accountName);
        const accountSubtitle =
          account.platformId === 'CustomLink' && account.customUrl ? account.customUrl : account.accountId;
        const status = account.loginStatus || 'unknown';
        const canLogin = LOGIN_PLATFORM_CODES.has(account.platformId);
        const editable = canEditAccount(account);

        return (
          <article
            key={String(account.id)}
            className={`${styles.accountCard} ${compact ? styles.accountCardCompact : ''} ${
              onAccountClick ? styles.accountCardClickable : ''
            }`}
            role={onAccountClick ? 'button' : undefined}
            tabIndex={onAccountClick ? 0 : undefined}
            onClick={() => onAccountClick?.(account)}
            onKeyDown={(event) => handleAccountKeyDown(event, account)}
          >
            <div className={styles.accountCardHeader}>
              <span className={styles.accountPlatformMark}>{platform?.mark || platformLabel.slice(0, 1)}</span>
              <div className={styles.accountCardIdentity}>
                <strong title={accountName}>{accountName}</strong>
                <span title={accountSubtitle}>{accountSubtitle}</span>
              </div>
              <Tag className={styles.accountStatusTag} color={ACCOUNT_STATUS_COLOR[status]}>
                {t(`status.${status}`)}
              </Tag>
            </div>
            {editable && (
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
                    if (key === 'edit') onEditAccount?.(account);
                    if (key === 'delete') handleDeleteAccount(account);
                  },
                }}
              >
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
    </>
  );
};

export default OperationAccountCards;
