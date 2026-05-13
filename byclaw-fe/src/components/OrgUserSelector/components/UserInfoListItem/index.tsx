import React from 'react';
import { getDisplayUserNameInChat } from '@/utils/chat';
import { useIntl } from '@umijs/max';
import classNames from 'classnames';
import styles from './index.module.less';
import { UserItem } from '../../types';

interface Props {
  user: UserItem;
  disableChat?: boolean;
  onSelect?: (user: UserItem) => any;
  mentionRealEmployee?: false | ((user: UserItem) => any);
  onChatSuccess?: (sessionId: string) => any;
}

export default function UserInfoListItem(props: Props) {
  const { user, onSelect, mentionRealEmployee } = props;

  const intl = useIntl();

  return (
    <div
      className={classNames(styles.item)}
      onClick={() => onSelect?.(user)}
    >
      <div className={styles.icon}>{getDisplayUserNameInChat(user.userName)}</div>
      <div className={styles.info}>
        <div className={styles.name}>{user.userName}</div>
        <div className={styles.userPath} title={user.pathName}>
          {user.pathName}
        </div>
      </div>
      {!!mentionRealEmployee && (
        <div
          className={styles.action}
          onClick={(e) => {
            e.stopPropagation();
            mentionRealEmployee(user);
          }}
        >
          @{intl.formatMessage({ id: 'orgUserSelector.mentionSelf' })}
        </div>
      )}
    </div>
  );
}
