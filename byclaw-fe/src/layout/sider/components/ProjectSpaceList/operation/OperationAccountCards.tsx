import type { KeyboardEvent } from 'react';
import { Button, Dropdown, Modal, Tag } from 'antd';
import { DeleteOutlined, EditOutlined, LinkOutlined, LoginOutlined, MoreOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import AntdIcon from '@/components/AntdIcon';
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
  drawerCompact?: boolean;
  onAccountClick?: (account: OperationAccount) => void;
  onEditAccount?: (account: OperationAccount) => void;
  onDeleteAccount?: (account: OperationAccount) => void | Promise<void>;
  onLogin?: (account: OperationAccount) => void | Promise<void>;
  onConfirmLogin?: () => void | Promise<void>;
  onCancelLogin?: () => void;
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

/**
 * 平台标识优先使用平台图标，避免自定义链接和微信公众号都退化成一个汉字首字。
 * 账号接口若返回头像则仍优先展示账号头像，平台图标作为无头像时的兜底。
 */
const renderAccountPlatformMark = (
  account: OperationAccount,
  platform: OperationPlatformOption | undefined,
  platformLabel: string
) => {
  if (account.avatar) {
    return <img src={account.avatar} alt="" />;
  }

  if (account.platformId === 'WeChatAccount' || account.platformId === 'wechat') {
    return <AntdIcon type="icon-qiyeweixin" style={{ fontSize: 20, color: '#07c160' }} />;
  }

  if (account.platformId === 'CustomLink') {
    return <LinkOutlined style={{ fontSize: 20, color: '#246bfe' }} />;
  }

  return platform?.mark || platformLabel.slice(0, 1);
};

const OperationAccountCards = ({
  accounts,
  platformOptions,
  canEditAccount = () => false,
  loginTarget,
  loginPreparingAccountId,
  loginConfirming = false,
  deletingAccountId,
  compact = false,
  drawerCompact = false,
  onAccountClick,
  onEditAccount,
  onDeleteAccount,
  onLogin,
  onConfirmLogin,
  onCancelLogin,
}: OperationAccountCardsProps) => {
  const intl = useIntl();
  const platformOptionMap = new Map(platformOptions.map((option) => [option.value, option]));
  const t = (id: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id: `projectSpace.operation.account.${id}` }, values);
  const loginT = (id: string) => intl.formatMessage({ id: `projectSpace.operation.accountLogin.${id}` });

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
        const isLoginTarget = !!loginTarget && String(loginTarget.id) === String(account.id);
        const canLogin = LOGIN_PLATFORM_CODES.has(account.platformId);
        const editable = canEditAccount(account);
        const loginActions = (
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
        );
        const inlineLoginFooter = (
          <div className={`${styles.accountCardFooter} ${styles.accountCardLoginFooter}`}>
            <span className={styles.accountCardLoginHint} title={loginT('inlineHint')}>
              {loginT('inlineHint')}
            </span>
            <div className={styles.accountCardLoginActions}>
              <Button
                size="small"
                disabled={loginConfirming}
                onClick={(event) => {
                  event.stopPropagation();
                  onCancelLogin?.();
                }}
              >
                {loginT('cancel')}
              </Button>
              <Button
                type="primary"
                size="small"
                loading={loginConfirming}
                onClick={(event) => {
                  event.stopPropagation();
                  void Promise.resolve(onConfirmLogin?.()).catch(() => undefined);
                }}
              >
                {loginT('inlineComplete')}
              </Button>
            </div>
          </div>
        );

        return (
          <article
            key={String(account.id)}
            className={`${styles.accountCard} ${compact ? styles.accountCardCompact : ''} ${
              drawerCompact ? styles.accountCardDrawerCompact : ''
            } ${isLoginTarget ? styles.accountCardLoginActive : ''} ${
              onAccountClick ? styles.accountCardClickable : ''
            }`}
            aria-live={isLoginTarget ? 'polite' : undefined}
            role={onAccountClick ? 'button' : undefined}
            tabIndex={onAccountClick ? 0 : undefined}
            onClick={() => onAccountClick?.(account)}
            onKeyDown={(event) => handleAccountKeyDown(event, account)}
          >
            <div className={styles.accountCardHeader}>
              <span className={styles.accountPlatformMark}>
                {renderAccountPlatformMark(account, platform, platformLabel)}
              </span>
              <div className={styles.accountCardIdentity}>
                <strong title={accountName}>{accountName}</strong>
                <span title={accountSubtitle}>{accountSubtitle}</span>
              </div>
              <div className={styles.accountCardHeaderActions}>
                <Tag
                  className={styles.accountStatusTag}
                  color={isLoginTarget ? 'processing' : ACCOUNT_STATUS_COLOR[status]}
                >
                  {t(`status.${isLoginTarget ? 'logging_in' : status}`)}
                </Tag>
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
                      className={`${styles.accountCardMoreAction} ${
                        drawerCompact ? styles.accountCardMoreActionDrawer : ''
                      }`}
                      icon={<MoreOutlined />}
                      loading={`${deletingAccountId ?? ''}` === `${account.id}`}
                      aria-label="账号操作"
                      onClick={(event) => event.stopPropagation()}
                    />
                  </Dropdown>
                )}
              </div>
            </div>
            {isLoginTarget ? (
              drawerCompact ? (
                inlineLoginFooter
              ) : (
                <>
                  <div className={styles.accountPlatformName}>{platformLabel}</div>
                  {inlineLoginFooter}
                </>
              )
            ) : drawerCompact ? (
              <div className={styles.accountCardFooter}>
                <div className={styles.accountPlatformName}>{platformLabel}</div>
                {loginActions}
              </div>
            ) : (
              <>
                <div className={styles.accountPlatformName}>{platformLabel}</div>
                <div className={styles.accountCardFooter}>{loginActions}</div>
              </>
            )}
          </article>
        );
      })}
    </>
  );
};

export default OperationAccountCards;
