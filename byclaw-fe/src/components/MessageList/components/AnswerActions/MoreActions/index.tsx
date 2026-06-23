import type { IMessage } from '@/typescript/message';
import { BugOutlined, DeleteOutlined } from '@ant-design/icons';
// @ts-ignore
import { useIntl } from '@umijs/max';
import { Button, Popconfirm, Tooltip } from 'antd';

import React from 'react';

import btnStyles from '@/components/MessageList/index.module.less';
import useTroubleshootDrawer from '../../TroubleshootSessionDrawer/useTroubleshootDrawer';

function MoreActions(porps: { deleteMessage: (message: IMessage) => void; msg: IMessage; disabledList?: string[] }) {
  const { deleteMessage, msg, disabledList } = porps;
  const { messageId, traceId } = msg;

  const intl = useIntl();
  const {
    placeholder: troubleshootDrawerHolder,
    open: openTroubleshootDrawer,
    loading: troubleshootLoading,
  } = useTroubleshootDrawer();

  const myDeleteMsg = React.useCallback(() => {
    deleteMessage(msg);
  }, [deleteMessage, msg]);

  const handleTroubleshoot = React.useCallback(() => {
    openTroubleshootDrawer(traceId);
  }, [openTroubleshootDrawer, traceId]);

  const canDelete = messageId && !disabledList?.includes('delete');

  return (
    <div className="ub ub-ac" style={{ columnGap: '2px' }}>
      {troubleshootDrawerHolder}
      {traceId && (
        <div className={btnStyles.actionsBarItem} role="presentation">
          <Tooltip title={intl.formatMessage({ id: 'messageList.troubleshootTooltip' })}>
            <Button
              type="text"
              size="small"
              loading={troubleshootLoading}
              icon={<BugOutlined className={btnStyles.icon} />}
              onClick={handleTroubleshoot}
            >
              <span className={btnStyles.actionsBarText}>{intl.formatMessage({ id: 'messageList.troubleshoot' })}</span>
            </Button>
          </Tooltip>
        </div>
      )}
      {canDelete ? (
        <div className={btnStyles.actionsBarItem} role="presentation">
          <Popconfirm title={intl.formatMessage({ id: 'messageList.deleteMessageConfirm' })} onConfirm={myDeleteMsg}>
            <Tooltip title={intl.formatMessage({ id: 'common.delete' })}>
              <Button type="text" size="small" icon={<DeleteOutlined className={btnStyles.icon} />}>
                <span className={btnStyles.actionsBarText}>{intl.formatMessage({ id: 'common.delete' })}</span>
              </Button>
            </Tooltip>
          </Popconfirm>
        </div>
      ) : null}
    </div>
  );
}

export default MoreActions;
