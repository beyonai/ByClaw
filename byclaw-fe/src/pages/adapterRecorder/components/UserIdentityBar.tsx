import { useEffect, useRef, useState } from 'react';

import type { UserInfo } from '@/models/common/user';

import styles from './UserIdentityBar.module.less';

interface Props {
  userInfo: UserInfo | null | undefined;
}

const getDisplayName = (userInfo: UserInfo) => userInfo.userName || userInfo.userCode || '用户';

export default function UserIdentityBar({ userInfo }: Props) {
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
  const initial = Array.from(displayName)[0] || '用';

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  return (
    <div className={styles.identity} data-testid="recorder-user-identity" onKeyDown={handleKeyDown}>
      {open && (
        <div className={styles.details} id="recorder-user-details" role="region" aria-label="当前用户信息">
          <div className={styles.detailsHeading}>账户信息</div>
          <dl className={styles.detailsList}>
            {userInfo.userCode && (
              <div className={styles.detailItem}>
                <dt>账号</dt>
                <dd>{userInfo.userCode}</dd>
              </div>
            )}
            {organization?.orgName && (
              <div className={styles.detailItem}>
                <dt>组织</dt>
                <dd>{organization.orgName}</dd>
              </div>
            )}
            {organization?.positionName && (
              <div className={styles.detailItem}>
                <dt>职位</dt>
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
        aria-label={`当前用户：${displayName}`}
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
