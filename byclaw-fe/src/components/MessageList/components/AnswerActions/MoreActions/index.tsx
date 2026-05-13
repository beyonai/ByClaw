import type { IMessage } from '@/typescript/message';
import { DeleteOutlined, EllipsisOutlined } from '@ant-design/icons';
// @ts-ignore
import { useIntl } from '@umijs/max';
import { Dropdown, Popconfirm, Tooltip } from 'antd';

import { IMessageState } from '@/constants/message';

import ChatLayoutCompContext from '@/components/ChatLayoutComp/hooks/useContext';

// tslint:disable:ordered-imports
import React, { useMemo } from 'react';

import btnStyles from '@/components/MessageList/index.module.less';
import { isEmpty } from 'lodash';
import styles from './index.module.less';
import classNames from 'classnames';

function MoreActions(porps: { deleteMessage: (message: IMessage) => void; msg: IMessage; disabledList?: string[] }) {
  const { deleteMessage, msg, disabledList } = porps;
  const { getMessageList } = React.useContext(ChatLayoutCompContext);
  const { messageId, answerMsgId } = msg;

  const answerTaget = (getMessageList?.() || []).toReversed().find((item) => item.msgId === answerMsgId);
  const { messageState: answerMessageState = IMessageState.Done } = answerTaget || {};

  const intl = useIntl();

  const myDeleteMsg = React.useCallback(() => {
    deleteMessage(msg);
  }, [deleteMessage, msg]);

  const items = useMemo(() => {
    const i = [];

    if (messageId && !disabledList?.includes('delete')) {
      i.push({
        danger: true,
        key: 'delete',
        label: (
          <Popconfirm title={intl.formatMessage({ id: 'messageList.deleteMessageConfirm' })} onConfirm={myDeleteMsg}>
            <div className="ub ub-ac gap8 full-width" style={{ padding: '3px 6px' }}>
              <DeleteOutlined style={{ marginRight: '6px', fontSize: '16px' }} />
              {intl.formatMessage({ id: 'common.delete' })}
            </div>
          </Popconfirm>
        ),
      });
    }

    return i;
  }, [messageId, myDeleteMsg, disabledList, answerMessageState]);

  if (isEmpty(items)) return null;

  return (
    <Dropdown
      arrow
      placement="bottomLeft"
      menu={{
        items,
        onClick: () => {
        },
      }}
      overlayStyle={{
        width: '150px',
      }}
      rootClassName={styles.dropdown}
    >
      <Tooltip title={intl.formatMessage({ id: 'common.more' })}>
        <EllipsisOutlined className={classNames(btnStyles.actionsBarItem, styles.actionsBarItem)} />
      </Tooltip>
    </Dropdown>
  );
}

export default MoreActions;
