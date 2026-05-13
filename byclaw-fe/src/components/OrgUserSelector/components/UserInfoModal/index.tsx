import React, { useCallback, useState } from 'react';
import { Spin, Popover, Divider } from 'antd';
import classNames from 'classnames';
import { useIntl } from '@umijs/max';

import { getUserSuas } from '@/service/search';
import { getDisplayUserNameInChat } from '@/utils/chat';

import styles from './index.module.less';

// 用户类型
type UserItem = Partial<{
  userName: string;
  userCode: string;
  orgId: number;
  orgName: string;
  pathName?: string;
}> & {
  userId: string;
};

type IProps = {
  children: React.ReactNode;
  user: UserItem;
  disable?: boolean;
  // disableChat?: boolean;
};

function UserInfoModal(props: IProps) {
  const { children, user, disable } = props;

  const intl = useIntl();

  const [popover, setPopover] = useState<{
    visible: boolean;
    content: any;
    loading: boolean;
    targetUserId: string | null;
  }>({
    visible: false,
    content: null,
    loading: false,
    targetUserId: null,
  });

  // 获取人员详情接口
  const fetchUserDetails = useCallback(async (userId: string) => {
    setPopover((prev) => ({ ...prev, visible: true, loading: true, targetUserId: userId }));
    try {
      const response = await getUserSuas({ userId });
      setPopover((prev) => ({ ...prev, content: response, loading: false }));
    } catch {
      setPopover((prev) => ({
        ...prev,
        content: { error: intl.formatMessage({ id: 'orgUserSelector.getUserDetailsFailed' }) },
        loading: false,
      }));
    }
  }, []);

  const handleIconClick = (e: React.MouseEvent, userId: string) => {
    e.stopPropagation(); // 阻止事件冒泡，避免触发外层点击
    fetchUserDetails(userId);
  };

  if (disable) {
    return children;
  }

  const popoverContent = (
    <div style={{ width: 270 }}>
      {popover.loading ? (
        <div style={{ textAlign: 'center' }}>
          <Spin size="small" />
        </div>
      ) : (
        popover.content && (
          <div className={styles.cardWrap}>
            <div className={classNames('ub ub-ac gap4')}>
              <div className={styles.user}>
                <span className={styles.icon}>{getDisplayUserNameInChat(popover.content?.userName)}</span>
              </div>
              <div className={styles.userInfo}>
                <div className="bold">{popover.content.userName}</div>
                <div>{popover.content.positionName}</div>
              </div>
            </div>
            <Divider />
            <div className={classNames('ub mb-10', styles.userItem)}>
              <div>{intl.formatMessage({ id: 'login.employeeId' })}</div>
              <div className="ub-f1">{popover.content.userCode}</div>
            </div>
            <div className={classNames('ub mb-10', styles.userItem)}>
              <div>{intl.formatMessage({ id: 'login.phone' })}</div>
              <div className="ub-f1">{popover.content.phone}</div>
            </div>
            <div className={classNames('ub mb-10', styles.userItem)}>
              <div>{intl.formatMessage({ id: 'login.department' })}</div>
              <div className="ub-f1">{popover.content.pathName}</div>
            </div>
            {/* {!disableChat && popover.targetUserId !== userInfo.userId && (
              <div className="ub ub-pe mt-16">
                <a className={styles.userPopoverBtn} onClick={() => GotoChat(popover.content)}>
                  <AntdIcon type="icon-cebianlan-duihuajilu" />
                  <span className="ml-8">{intl.formatMessage({ id: 'dialogueRecord.sendMessage' })}</span>
                </a>
              </div>
            )} */}
          </div>
        )
      )}
    </div>
  );

  return (
    <Popover
      content={popoverContent}
      trigger="click"
      placement="bottomLeft"
      arrow={false}
      open={popover.visible && popover.targetUserId === user.userId}
      onOpenChange={(visible) => {
        setPopover((prev) => ({ ...prev, visible }));
      }}
      overlayClassName={styles.userPopover}
    >
      <div className="pointer" onClick={(e) => handleIconClick(e, user.userId)}>
        {children}
      </div>
    </Popover>
  );
}

export default UserInfoModal;
