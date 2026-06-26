import type { IMessage } from '@/typescript/message';
import { BugOutlined, DeleteOutlined } from '@ant-design/icons';
// @ts-ignore
import { useIntl } from '@umijs/max';
import { Button, Popconfirm, Tooltip } from 'antd';

import React from 'react';

import btnStyles from '@/components/MessageList/index.module.less';
import { getTraceIdByMessageId } from '@/service/message';
import useTroubleshootDrawer from '../../TroubleshootSessionDrawer/useTroubleshootDrawer';

const traceIdCache = new Map<string, string>();
// 同一条消息在 traceId 还没落库时，避免每次点击都重新请求一次。
const traceIdRequestCache = new Map<string, Promise<string>>();

function MoreActions(porps: { deleteMessage: (message: IMessage) => void; msg: IMessage; disabledList?: string[] }) {
  const { deleteMessage, msg, disabledList } = porps;
  const { messageId, traceId } = msg;
  const [traceIdLoading, setTraceIdLoading] = React.useState(false);

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
    if (traceId) {
      // 消息自身已经带 traceId，直接打开抽屉。
      openTroubleshootDrawer(traceId);
      return;
    }

    if (!messageId) return;

    const cachedTraceId = traceIdCache.get(messageId);
    if (cachedTraceId) {
      // 之前已经查到过 traceId，后续点击直接复用。
      openTroubleshootDrawer(cachedTraceId);
      return;
    }

    // 首次点击且消息里没有 traceId 时，调用接口补查并把结果存起来。
    const traceIdRequest = traceIdRequestCache.get(messageId) || getTraceIdByMessageId(messageId);
    traceIdRequestCache.set(messageId, traceIdRequest);
    setTraceIdLoading(true);
    traceIdRequest
      .then((fetchedTraceId) => {
        if (!fetchedTraceId) return;
        traceIdCache.set(messageId, fetchedTraceId);
        openTroubleshootDrawer(fetchedTraceId);
      })
      .catch(() => undefined)
      .finally(() => {
        traceIdRequestCache.delete(messageId);
        setTraceIdLoading(false);
      });
  }, [messageId, openTroubleshootDrawer, traceId]);

  const canDelete = messageId && !disabledList?.includes('delete');

  return (
    <div className={`ub ub-ac ${btnStyles.moreActions}`}>
      {troubleshootDrawerHolder}
      <div className={btnStyles.actionsBarItem} role="presentation">
        <Tooltip title={intl.formatMessage({ id: 'messageList.troubleshoot' })}>
          <Button
            type="text"
            size="small"
            loading={troubleshootLoading || traceIdLoading}
            icon={<BugOutlined className={btnStyles.icon} />}
            onClick={handleTroubleshoot}
          >
            <span className={btnStyles.actionsBarText}>{intl.formatMessage({ id: 'messageList.troubleshoot' })}</span>
          </Button>
        </Tooltip>
      </div>
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
