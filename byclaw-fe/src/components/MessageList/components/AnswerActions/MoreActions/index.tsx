import type { IMessage } from '@/typescript/message';
import { BugOutlined, DeleteOutlined, LinkOutlined } from '@ant-design/icons';
// @ts-ignore
import { useIntl } from '@umijs/max';
import { Button, Popconfirm, Tooltip } from 'antd';

import React from 'react';

import btnStyles from '@/components/MessageList/index.module.less';
import TraceDetailDrawer from '@/components/TraceDetailDrawer';
import { useLangfuseConfigStore } from '@/models/common/useLangfuseConfigStore';
import { getTraceIdByMessageId, qryTroubleshootSession } from '@/service/message';
import { cacheTroubleshootSession, getCachedTroubleshootSession } from '../../TroubleshootSessionDrawer/sessionCache';
import useTroubleshootDrawer from '../../TroubleshootSessionDrawer/useTroubleshootDrawer';

const traceIdCache = new Map<string, string>();
const traceIdRequestCache = new Map<string, Promise<string>>();
const troubleshootSessionRequestCache = new Map<string, Promise<string>>();

function MoreActions(porps: {
  deleteMessage: (message: IMessage) => void;
  msg: IMessage;
  disabledList?: string[];
  showTroubleshoot?: boolean;
}) {
  const { deleteMessage, msg, disabledList, showTroubleshoot = false } = porps;
  const { messageId, traceId } = msg;
  const [troubleshootActionLoading, setTroubleshootActionLoading] = React.useState(false);
  const [traceDrawerOpen, setTraceDrawerOpen] = React.useState(false);
  const [resolvedTraceId, setResolvedTraceId] = React.useState<string | undefined>(traceId);

  const intl = useIntl();
  const {
    placeholder: troubleshootDrawerHolder,
    open: openTroubleshootDrawer,
    loading: troubleshootLoading,
  } = useTroubleshootDrawer();

  // Lazy-load /langfuse/config so we know whether to show the "Trace" button.
  const ensureLangfuseConfigLoaded = useLangfuseConfigStore((s) => s.ensureLoaded);
  const langfuseConfig = useLangfuseConfigStore((s) => s.config);
  const langfuseEnabled = Boolean(langfuseConfig?.enabled && langfuseConfig?.projectId);
  React.useEffect(() => {
    void ensureLangfuseConfigLoaded();
  }, [ensureLangfuseConfigLoaded]);

  const myDeleteMsg = React.useCallback(() => {
    deleteMessage(msg);
  }, [deleteMessage, msg]);

  const getLatestTraceId = React.useCallback(() => {
    if (traceId) {
      return Promise.resolve(traceId);
    }

    if (!messageId) {
      return Promise.resolve('');
    }

    const cachedTraceId = traceIdCache.get(messageId);
    if (cachedTraceId) {
      return Promise.resolve(cachedTraceId);
    }

    const traceIdRequest = traceIdRequestCache.get(messageId) || getTraceIdByMessageId(messageId);
    traceIdRequestCache.set(messageId, traceIdRequest);

    return traceIdRequest
      .then((fetchedTraceId) => {
        if (!fetchedTraceId) return '';
        traceIdCache.set(messageId, fetchedTraceId);
        return fetchedTraceId;
      })
      .catch(() => '')
      .finally(() => {
        traceIdRequestCache.delete(messageId);
      });
  }, [messageId, traceId]);

  const syncTroubleshootSessionCache = React.useCallback(
    async (sessionId?: string) => {
      if (!sessionId || !messageId) return sessionId;

      const latestTraceId = traceId || (await getLatestTraceId());
      cacheTroubleshootSession({
        messageId,
        traceId: latestTraceId,
        sessionId,
      });
      return sessionId;
    },
    [getLatestTraceId, messageId, traceId]
  );

  const handleTroubleshoot = React.useCallback(() => {
    if (!messageId) {
      openTroubleshootDrawer({ traceId });
      return;
    }

    const cachedSessionId = getCachedTroubleshootSession({ messageId, traceId });
    if (cachedSessionId) {
      void syncTroubleshootSessionCache(cachedSessionId);
      openTroubleshootDrawer({
        messageId,
        sessionId: cachedSessionId,
        traceId,
      });
      return;
    }

    setTroubleshootActionLoading(true);
    const troubleshootSessionRequest =
      troubleshootSessionRequestCache.get(messageId) ||
      qryTroubleshootSession({ messageId }).then(async (res) => {
        const fetchedSessionId = `${res?.data?.sessionId || res?.sessionId || ''}`;
        if (fetchedSessionId) {
          await syncTroubleshootSessionCache(fetchedSessionId);
        }
        return fetchedSessionId;
      });

    troubleshootSessionRequestCache.set(messageId, troubleshootSessionRequest);

    troubleshootSessionRequest
      .then(async (fetchedSessionId) => {
        if (fetchedSessionId) {
          openTroubleshootDrawer({
            messageId,
            sessionId: fetchedSessionId,
            traceId,
          });
          return;
        }

        const fetchedTraceId = await getLatestTraceId();
        openTroubleshootDrawer({
          messageId,
          traceId: fetchedTraceId || traceId,
        });
      })
      .catch(async () => {
        const fetchedTraceId = await getLatestTraceId();
        openTroubleshootDrawer({
          messageId,
          traceId: fetchedTraceId || traceId,
        });
      })
      .finally(() => {
        troubleshootSessionRequestCache.delete(messageId);
        setTroubleshootActionLoading(false);
      });
  }, [getLatestTraceId, messageId, openTroubleshootDrawer, syncTroubleshootSessionCache, traceId]);

  const canDelete = messageId && !disabledList?.includes('delete');
  // 所有数字员工回答均可发起运维排查，用户自己发送的提问不展示。
  const canShowTroubleshoot = showTroubleshoot && msg.fromBeyond;
  const canShowTrace = langfuseEnabled && !disabledList?.includes('trace');
  // 用户提问的操作区只保留调用链图标，数字员工回答才显示国际化文案，避免提问操作区过宽。
  const showTraceLabel = msg.fromBeyond;

  const handleOpenTraceDrawer = React.useCallback(() => {
    // Always seed with the latest known traceId; if the message carried no traceId
    // (typical for older / streamed-in history messages), fall back to the
    // getTraceIdByMessageId endpoint so the drawer can fetch a real id.
    setResolvedTraceId(traceId);
    setTraceDrawerOpen(true);
    if (!traceId && messageId) {
      getLatestTraceId().then((fetched) => {
        if (fetched) setResolvedTraceId(fetched);
      });
    }
  }, [getLatestTraceId, messageId, traceId]);

  return (
    <div className={`ub ub-ac ${btnStyles.moreActions}`}>
      {troubleshootDrawerHolder}
      <TraceDetailDrawer open={traceDrawerOpen} traceId={resolvedTraceId} onClose={() => setTraceDrawerOpen(false)} />
      {canShowTrace ? (
        <div className={btnStyles.actionsBarItem} role="presentation">
          <Tooltip title={intl.formatMessage({ id: 'messageList.viewTraceTooltip' })}>
            <Button
              type="text"
              size="small"
              icon={<LinkOutlined className={btnStyles.icon} />}
              onClick={handleOpenTraceDrawer}
            >
              {showTraceLabel ? (
                <span className={btnStyles.actionsBarText}>{intl.formatMessage({ id: 'messageList.viewTrace' })}</span>
              ) : null}
            </Button>
          </Tooltip>
        </div>
      ) : null}
      {canShowTroubleshoot ? (
        <div className={btnStyles.actionsBarItem} role="presentation">
          <Tooltip title={intl.formatMessage({ id: 'messageList.troubleshootTooltip' })}>
            <Button
              type="text"
              size="small"
              loading={troubleshootLoading || troubleshootActionLoading}
              icon={<BugOutlined className={btnStyles.icon} />}
              onClick={handleTroubleshoot}
            >
              <span className={btnStyles.actionsBarText}>{intl.formatMessage({ id: 'messageList.troubleshoot' })}</span>
            </Button>
          </Tooltip>
        </div>
      ) : null}
      {canDelete ? (
        <div className={btnStyles.actionsBarItem} role="presentation">
          <Popconfirm title={intl.formatMessage({ id: 'messageList.deleteMessageConfirm' })} onConfirm={myDeleteMsg}>
            <Tooltip title={intl.formatMessage({ id: 'messageList.deleteMessage' })}>
              <Button type="text" size="small" icon={<DeleteOutlined className={btnStyles.icon} />}>
                {showTroubleshoot ? (
                  <span className={btnStyles.actionsBarText}>{intl.formatMessage({ id: 'common.delete' })}</span>
                ) : null}
              </Button>
            </Tooltip>
          </Popconfirm>
        </div>
      ) : null}
    </div>
  );
}

export default MoreActions;
