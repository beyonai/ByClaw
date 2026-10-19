import { useIntl, getIntl } from '@umijs/max';
import { useEffect, useRef, useState } from 'react';

import type { UserInfo } from '@/models/common/user';

import styles from './UserIdentityBar.module.less';

interface Props {
  userInfo: UserInfo | null | undefined;
}

const getDisplayName = (userInfo: UserInfo) =>
  userInfo.userName || userInfo.userCode || getIntl().formatMessage({ id: 'common.user' });

export default function UserIdentityBar({ userInfo }: Props) {
  const intl = useIntl();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!userInfo) {
      setOpen(false);
    }
  }, [userInfo]);

  if (!userInfo) {
    return null;
  }

  const displayName = getDisplayName(userInfo);
  const organization = userInfo.usersOrganizations?.[0];
  const initial = Array.from(displayName)[0] || intl.formatMessage({ id: 'adapterRecorder.user.initial' });

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  return (
    <div className={styles.identity} data-testid="recorder-user-identity" onKeyDown={handleKeyDown}>
      {open && (
        <div
          className={styles.details}
          id="recorder-user-details"
          role="region"
          aria-label={intl.formatMessage({ id: 'adapterRecorder.user.currentInfo' })}
        >
          <div className={styles.detailsHeading}>{intl.formatMessage({ id: 'adapterRecorder.user.accountInfo' })}</div>
          <dl className={styles.detailsList}>
            {userInfo.userCode && (
              <div className={styles.detailItem}>
                <dt>{intl.formatMessage({ id: 'settings.email.account' })}</dt>
                <dd>{userInfo.userCode}</dd>
              </div>
            )}
            {organization?.orgName && (
              <div className={styles.detailItem}>
                <dt>{intl.formatMessage({ id: 'orgMgr.personalSelect.org' })}</dt>
                <dd>{organization.orgName}</dd>
              </div>
            )}
            {organization?.positionName && (
              <div className={styles.detailItem}>
                <dt>{intl.formatMessage({ id: 'adapterRecorder.user.position' })}</dt>
                <dd>{organization.positionName}</dd>
              </div>
            )}
          </dl>
        </div>
      )}

      <button
        ref={triggerRef}
        className={styles.trigger}
        type="button"
        aria-label={intl.formatMessage({ id: 'adapterRecorder.user.current' }, { v0: displayName })}
        aria-expanded={open}
        aria-controls="recorder-user-details"
        onClick={() => setOpen((visible) => !visible)}
      >
        <span className={styles.avatar} aria-hidden="true">
          {userInfo.avatar ? <img src={userInfo.avatar} alt="" /> : initial}
        </span>
        <span className={styles.name} title={displayName}>
          {displayName}
        </span>
        <span className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} aria-hidden="true">
          ↗
        </span>
      </button>
    </div>
  );
}
