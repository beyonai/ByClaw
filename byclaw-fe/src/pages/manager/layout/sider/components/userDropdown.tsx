import React, { useMemo, useCallback } from 'react';
import { Dropdown } from 'antd';
import { useSelector, history, useIntl } from '@umijs/max';
import { globalLogout } from '@/service/common/request';

import { getRuntimeActualUrl } from '@/utils';

import styles from '../index.module.less';

export default function UserDropdown() {
  const intl = useIntl();

  const { userInfo } = useSelector(({ user }) => ({ userInfo: user.userInfo }));

  const displayName = userInfo?.userName;

  const handleDropdownClick = useCallback(
    ({ key }: { key: string }) => {
      switch (key) {
        case 'openBeyond':
          window.location.href = `${window.location.origin}${getRuntimeActualUrl('/')}`;
          break;
        case 'logout':
          globalLogout(true);
          break;
        default:
          break;
      }
    },
    [history]
  );

  const dropdownItems = useMemo(() => {
    const items = [];

    if (displayName) {
      items.push({
        key: 'openBeyond',
        label: intl.formatMessage({ id: 'manager.header.superAssistant' }),
      });
      items.push({
        key: 'logout',
        label: intl.formatMessage({ id: 'manager.logout' }),
      });
    } else {
      items.push({
        key: 'login',
        label: intl.formatMessage({ id: 'manager.login' }),
      });
    }

    return items;
  }, [displayName, intl]);

  return (
    <>
      <Dropdown
        menu={{
          items: dropdownItems,
          onClick: handleDropdownClick,
        }}
      >
        <div className="ub ub-ac gap4 pointer">
          <div className={styles.userName}>{displayName?.[0]}</div>{' '}
          <div className="ellipsis ub-f1" style={{ fontSize: 13 }}>
            {displayName}
          </div>
        </div>
      </Dropdown>
    </>
  );
}
