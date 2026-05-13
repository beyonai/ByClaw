import { CloseOutlined, EyeOutlined } from '@ant-design/icons';
import { useSelector, useIntl } from '@umijs/max';
import { Popconfirm, Space } from 'antd';
import classnames from 'classnames';
import { get, head, isFunction, last, noop } from 'lodash';
// tslint:disable:ordered-imports
import React, { useCallback, useMemo } from 'react';

import InfiniteScroll from '@/components/InfiniteScroll';
import useRender from '@/components/MessageList/useRender';
import useModal from '@/hooks/useModal';
import { getAgentChatAvatar } from '@/utils/agent';

import styles from './index.module.less';

import type { ISessionState } from '@/models/session';
import type { IMessage } from '@/typescript/message';

export type ICiteRender = {
  messageList: IMessage[];
  // eslint-disable-next-line react/no-unused-prop-types
  renderFileType?: 'cite';
};

export type IProps = {
  sessionId?: string;
  onClose?: (fileItem: ICiteRender) => void;
} & ICiteRender;

function CiteRender(props: IProps) {
  const { messageList, onClose, sessionId } = props;
  const intl = useIntl();

  const sessionList: ISessionState['sessionList'] = useSelector(
    ({ session }: { session: ISessionState }) => session.sessionList
  );

  const { ModalNode, setOpen, setMyContent } = useModal({
    title: intl.formatMessage({ id: 'citeRender.title' }),
    modalClassName: styles.modal,
  });

  const { renderMessage } = useRender({
    updateMessage: noop,
    deleteMessage: noop,
  });

  const messageListContent = useCallback(() => {
    return (
      <div
        className={classnames('full-height full-width hideThumb', styles.messageContent)}
        id="citeScrollMessage"
        style={{
          pointerEvents: 'none',
        }}
      >
        <InfiniteScroll
          next={noop}
          hasMore={false}
          loader={null}
          dataLength={messageList.length}
          scrollableTarget="citeScrollMessage"
          inverse
          hasChildren={messageList.length > 0}
          topItemKey={head(messageList)?.msgId}
          bottomItemKey={last(messageList)?.msgId}
          style={{ overflow: 'visible' }}
          className={styles.infiniteScroll}
        >
          {messageList.map((msg) => {
            return renderMessage(msg, {
              hideAction: true,
              hideThinking: true,
            });
          })}
        </InfiniteScroll>
      </div>
    );
  }, [messageList]);

  const fileItem = useMemo<ICiteRender>(() => {
    return {
      messageList,
      renderFileType: 'cite',
    };
  }, [messageList]);

  const firstQuestionText = useMemo(() => {
    return (
      get(
        messageList.find((item) => !item.fromBeyond),
        'text'
      ) || intl.formatMessage({ id: 'common.quote' })
    );
  }, [messageList]);

  const firstAnswerText = useMemo(() => {
    return (
      get(
        messageList.find((item) => item.fromBeyond),
        'text'
      ) || ''
    );
  }, [messageList]);

  const sessionItem = useMemo(() => {
    return sessionList.find((item) => item.sessionId === sessionId);
  }, [sessionId, sessionList]);

  return (
    <>
      <div className={classnames(styles.fileItem, 'ub ub-ac overflow-hidden')} key="citeRender">
        <div className={classnames(styles.actionList, 'full-width full-height ub ub-ac ub-pc')}>
          <Space>
            <div
              className={classnames(styles.fileItemDownload, 'ub ub-ac ub-pc pointer')}
              onClick={() => {
                setMyContent(messageListContent());
                setOpen(true);
              }}
              title={intl.formatMessage({ id: 'common.preview' })}
            >
              {/* 预览 */}
              <div className={classnames(styles.preview, styles.loading)}>
                <EyeOutlined style={{ fontSize: '16px' }} />
              </div>
            </div>
            {isFunction(onClose) && (
              <Popconfirm
                title={intl.formatMessage({ id: 'citeRender.deleteConfirm' })}
                onConfirm={() => {
                  onClose(fileItem);
                }}
              >
                <div className={classnames(styles.fileItemDownload, 'ub ub-ac ub-pc pointer')}>
                  <CloseOutlined style={{ fontSize: '16px', color: 'red' }} />
                </div>
              </Popconfirm>
            )}
          </Space>
        </div>
        <div style={{ position: 'relative' }}>
          <div className={styles.fileItemIcon}>
            <div
              style={{
                width: '100%',
                height: '100%',
                borderRadius: '50%',
                backgroundColor: `var(--${PREFIX_NAME}-${sessionItem?.theme}-2)`,
              }}
            >
              {getAgentChatAvatar(sessionItem?.avatar)}
            </div>
          </div>
        </div>
        <div className={classnames(styles.fileItemInfo, 'ub-f1 overflow-hidden')}>
          <p className={classnames(styles.fileItemName, 'textEllipsis')}>{firstQuestionText}</p>
          <div className="ub ub-ac">
            <p className={classnames(styles.fileItemMore, 'textEllipsis')} style={{ maxWidth: 'calc(100% - 26px)' }}>
              {firstAnswerText}
            </p>
          </div>
        </div>
      </div>
      {ModalNode}
    </>
  );
}

export default CiteRender;
