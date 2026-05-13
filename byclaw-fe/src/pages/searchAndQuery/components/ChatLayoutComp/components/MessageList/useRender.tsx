// tslint:disable:ordered-imports
import React, { Suspense, useCallback } from 'react';
import { InfoCircleOutlined } from '@ant-design/icons';
// @ts-ignore
import { useIntl, useSelector } from '@umijs/max';
import { Divider, Space, Tooltip, Typography } from 'antd';
import classnames from 'classnames';
import { isEmpty, noop, compact } from 'lodash';

import SaveToWorkSpace from './components/saveToWorkSpace';
import DualBallLoading from '@/components/Loading/DualBallLoading';
import WaveBallLoading from '@/components/Loading/WaveBallLoading';
import FileRender from '@/components/MessageList/components/FileRender';
import ThumbUpContent from '@/components/MessageList/components/AnswerActions/ThumbUp/content';
import CopyComp from '@/components/MessageList/components/AnswerActions/Copy';
import MoreActions from '@/components/MessageList/components/AnswerActions/MoreActions';
import ThumbUp from '@/components/MessageList/components/AnswerActions/ThumbUp';
import MsgRenderer from '@/components/MessageList/components/MsgRenderer';

import useModal from '@/hooks/useModal';
import NotSupport from '@/components/NotSupport';

import lazyHandler from './lazyHandler';

import { getPublicPath } from '@/utils';
import { getAgentChatAvatar } from '@/utils/agent';
import getDisplayQuestion from '@/components/QueryInput/getDisplayQuestion';
import { getDisplayUserNameInChat } from '@/utils/chat';
import { getDisplayDateTime } from '@/components/MessageList/utils';

import { IMessageState } from '@/constants/message';

import type { IState as useEmployeesIState } from '@/models/useEmployees';
import type { IFile } from '@/typescript/file';
import type { IMessage, IExtParams } from '@/typescript/message';

import styles from '@/components/MessageList/index.module.less';

const { Paragraph } = Typography;

export default function useRender({
  updateMessage,
  deleteMessage,
}: {
  updateMessage: (message: IMessage) => void;
  deleteMessage: (message: IMessage) => void;
}) {
  const { ModalNode, setOpen, setMyContent, setMyTitle } = useModal({});

  const { userInfo } = useSelector(({ user }) => ({ userInfo: user.userInfo }));
  const { employeesList, agentList }: useEmployeesIState = useSelector(
    ({ employees }: { employees: useEmployeesIState }) => ({
      ...employees,
    })
  );

  const intl = useIntl();

  const { userId } = userInfo || {};
  const userQueryActions = useCallback(
    (msg: IMessage) => {
      const { text, resourceList } = msg;

      return (
        <div className="ub ub-ac">
          <CopyComp richText={text} text={getDisplayQuestion({ text, resourceList })} />
          <Divider type="vertical" />
          <MoreActions deleteMessage={deleteMessage} msg={msg} />
        </div>
      );
    },
    [deleteMessage, updateMessage, intl]
  );

  const beyondAnswerActions = useCallback(
    (msg: IMessage) => {
      const { messageState } = msg;

      return (
        <div className="full-width ub ub-ver" style={{ position: 'relative' }}>
          <div className={classnames('ub ub-ac ub-wrap', styles.beyondAnswerActions)} style={{ gap: '6px 0' }}>
            <Space size={1}>
              {[IMessageState.Done, IMessageState.Cancel].includes(messageState) && <SaveToWorkSpace msg={msg} />}
              <MoreActions deleteMessage={deleteMessage} msg={msg} />
            </Space>
            <Divider type="vertical" size="small" />
            {[IMessageState.Done, IMessageState.Cancel].includes(messageState) && (
              <ThumbUp updateMessage={updateMessage} msg={msg} />
            )}
          </div>
          <ThumbUpContent msg={msg} updateMessage={updateMessage} />
        </div>
      );
    },
    [deleteMessage, updateMessage]
  );

  const uploadFileRender = useCallback((fileList?: IFile[], msg?: IMessage) => {
    if (!fileList || isEmpty(fileList)) return null;

    return (
      <div className={classnames(styles.fileList, 'ub ub-wrap full-width gap8')} style={{ justifyContent: 'inherit' }}>
        {fileList.map((fileItem) => {
          return <FileRender fileItem={fileItem} key={fileItem.uid} message={msg} canQuote canCollect />;
        })}
      </div>
    );
  }, []);

  const extParamsRender = useCallback((extParams?: IExtParams, msg?: IMessage) => {
    if (!extParams || isEmpty(extParams)) return null;

    const { extendsMsgItemList } = extParams;
    const { msgId } = msg || {};

    if (!extendsMsgItemList || isEmpty(extendsMsgItemList)) return null;

    return (
      <div className="ub ub-ver gap8" style={{ justifyContent: 'inherit' }}>
        {extendsMsgItemList.map((messageListItem, idx) => {
          const key = `${msgId}_extendsMsgItem_${idx}`;

          const { content, contentType } = messageListItem;

          const Comp = lazyHandler.lazyComp(`${contentType}`) as React.ComponentType<any> | null;

          if (!Comp) return <NotSupport />;
          return (
            <Suspense key={`${key}_Suspense`}>
              <Comp
                key={`${key}_Comp`}
                message={msg}
                messageListItem={messageListItem}
                messageListItemContent={content}
                updateMessageListItemContent={noop}
              />
            </Suspense>
          );
        })}
      </div>
    );
  }, []);

  const attachmentListRender = useCallback((msg: IMessage) => {
    const { fromBeyond, fromOtherUser, imageList, fileList, extParams } = msg;

    const isLeftSide = fromBeyond || fromOtherUser;

    const renderList = compact([
      uploadFileRender(imageList, msg),
      uploadFileRender(fileList, msg),
      extParamsRender(extParams, msg),
    ]);

    if (isEmpty(renderList)) return null;

    return (
      <div
        className={classnames(
          {
            'ub-ps': isLeftSide,
            'ub-pe': !isLeftSide,
            'ub-ae': !isLeftSide,
          },
          'ub ub-ver full-width'
        )}
      >
        {renderList}
      </div>
    );
  }, []);

  const renderMessage = useCallback(
    (
      msg: IMessage,
      param?: {
        showRelatedQuestions?: boolean;
        hideAction?: boolean;
        hideThinking?: boolean;
      }
    ) => {
      const {
        creatorName,
        fromBeyond,
        fromOtherUser,
        messageState,
        messageTip = '',
        traceback,
        msgId,
        createTime,
        usage,
      } = msg;

      const { hideAction } = param || {};
      const isLeftSide = fromBeyond;

      const leftName: string = '搜问助手';

      const leftSideLogo = (() => {
        if (!isLeftSide) return null;

        return <div className={styles.beyondLogo}>{getAgentChatAvatar(`${getPublicPath()}beyond/logo100.svg`)}</div>;
      })();
      const rightName = creatorName || intl.formatMessage({ id: 'common.user' });
      const showRightUserNameDiv = !isLeftSide;

      let displayCreateTime = createTime;
      if (createTime) {
        displayCreateTime = getDisplayDateTime(createTime);
      }

      return (
        <div
          key={msgId}
          data-frombeyond={!!isLeftSide}
          className={classnames(styles.messageRow, 'gap12', {
            [styles.left]: isLeftSide,
            [styles.right]: showRightUserNameDiv,
          })}
        >
          {isLeftSide && leftSideLogo}
          {isLeftSide && (
            <div className={styles.name}>
              {leftName}
              <span className={styles.createTime}>{displayCreateTime}</span>
            </div>
          )}
          {showRightUserNameDiv && (
            <div className={classnames(styles.beyondLogo, styles.userName)}>
              <span>{getDisplayUserNameInChat(rightName)}</span>
            </div>
          )}
          {!isLeftSide && showRightUserNameDiv ? (
            <div className={styles.name}>
              <span className={styles.createTime}>{displayCreateTime}</span>
              {rightName}
            </div>
          ) : null}
          <div className={styles.bubble} key={`${msgId}_bubble`}>
            <div
              className={classnames(styles.compRender, 'ub ub-ver gap8', {
                [styles.pureText]: fromOtherUser && usage !== '4',
              })}
            >
              <MsgRenderer msg={msg} updateMessage={updateMessage} hideThinking={param?.hideThinking} />
              {messageState === IMessageState.Query && <DualBallLoading style={{ width: 32, height: 32 }} />}
            </div>
            {fromBeyond && messageState === IMessageState.Error && (
              <Tooltip
                title={
                  <div style={{ maxWidth: '300px' }}>
                    <Paragraph
                      ellipsis={{
                        rows: 5,
                        suffix: `${(messageTip?.slice(-10) || '').trim()}`,
                      }}
                      style={{
                        color: '#fff',
                        marginBottom: '0',
                      }}
                    >
                      {messageTip?.slice(0, messageTip.length - 10)}
                    </Paragraph>
                  </div>
                }
              >
                <InfoCircleOutlined
                  className={classnames(styles.errorIcon, 'pointer')}
                  onClick={() => {
                    setMyTitle(traceback ? messageTip : 'Error Tips');
                    setMyContent(traceback || messageTip);
                    setOpen(true);
                  }}
                />
              </Tooltip>
            )}
          </div>
          {messageState === IMessageState.Answer && (
            <div>
              <WaveBallLoading style={{ width: 20, height: 20, opacity: 0.6 }} />
            </div>
          )}
          {attachmentListRender(msg)}
          {!hideAction && [IMessageState.Done, IMessageState.Cancel, IMessageState.Error].includes(messageState) && (
            <div className={styles.actionsBar}>
              {isLeftSide && beyondAnswerActions(msg)}
              {!isLeftSide && userQueryActions(msg)}
            </div>
          )}
        </div>
      );
    },
    [agentList, userId, employeesList, attachmentListRender, updateMessage, beyondAnswerActions]
  );

  const extendsRender = <>{ModalNode}</>;

  return {
    renderMessage,
    extendsRender,
  };
}
