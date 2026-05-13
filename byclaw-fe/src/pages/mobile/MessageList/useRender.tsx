// tslint:disable:ordered-imports
import React, { Suspense, useCallback } from 'react';
import { ArrowRightOutlined, InfoCircleOutlined } from '@ant-design/icons';
// @ts-ignore
import { useIntl, useSelector } from '@umijs/max';
import { Divider, Space, Tooltip, Typography, Button } from 'antd';
import classnames from 'classnames';
import { get, isArray, isEmpty, noop, compact } from 'lodash';

import DualBallLoading from '@/components/Loading/DualBallLoading';
import WaveBallLoading from '@/components/Loading/WaveBallLoading';
import CiteRender from '@/components/MessageList/components/CiteRender';
import FileRender from '@/components/MessageList/components/FileRender';

import ThumbUpContent from '@/components/MessageList/components/AnswerActions/ThumbUp/content';
// import Memory from '@/components/MessageList/components/Memory';
import CopyComp from '@/components/MessageList/components/AnswerActions/Copy';
import MoreActions from '@/components/MessageList/components/AnswerActions/MoreActions';
import ThumbUp from '@/components/MessageList/components/AnswerActions/ThumbUp';
import MsgRenderer from '@/components/MessageList/components/MsgRenderer';

import useModal from '@/hooks/useModal';
import useGlobal from '@/hooks/useGlobal';
import NotSupport from '@/components/NotSupport';

import lazyHandler from '@/components/MessageList/lazyHandler';

import { agentTypeMap } from '@/constants/agent';
import { getPublicPath } from '@/utils';

import { getAgentChatAvatar } from '@/utils/agent';

import { IMessageState, SSEMessageType } from '@/constants/message';

import type { IState as useEmployeesIState } from '@/models/useEmployees';
import type { IFile } from '@/typescript/file';
import type { IMessage, IExtParams } from '@/typescript/message';

import styles from './index.module.less';
import getDisplayQuestion from '@/components/QueryInput/getDisplayQuestion';
import { getDisplayDateTime, getResponseAgentInfo } from '@/components/MessageList/utils';
import { getSystemConfigByStorage } from '@/utils/system';
import AntdIcon from '@/components/AntdIcon';

const { Paragraph } = Typography;

export default function useRender({
  updateMessage,
  deleteMessage,
  sessionId,
}: {
  updateMessage: (message: IMessage) => void;
  deleteMessage: (message: IMessage) => void;
  sessionId?: string;
}) {
  const { ModalNode, setOpen, setMyContent, setMyTitle } = useModal({});

  const { employeesList, agentList }: useEmployeesIState = useSelector(
    ({ employees }: { employees: useEmployeesIState }) => ({
      ...employees,
    })
  );

  const intl = useIntl();
  const { EventEmitter } = useGlobal();

  const { userInfo } = useSelector(({ user }) => ({ userInfo: user.userInfo }));
  const { userId } = userInfo || {};

  const userQueryActions = useCallback(
    (msg: IMessage) => {
      const { text, resourceList, msgId } = msg;

      return (
        <div className="ub ub-ac">
          <CopyComp richText={text} text={getDisplayQuestion({ text, resourceList })} />
          <Divider type="vertical" />
          <Space size={2}>
            <div className={classnames(styles.actionsBarItem)} role="presentation">
              <Button
                type="text"
                size="small"
                icon={<AntdIcon type="icon-a-Listliebiao" className={styles.icon} />}
                onClick={() => {
                  EventEmitter.emit('beyond-messageList-set-multichoices-msgid', [msgId]);
                  EventEmitter.emit('beyond-messageList-open-multichoices', ['reference']);
                }}
              >
                <span className={styles.actionsBarText}>{intl.formatMessage({ id: 'common.quote' })}</span>
              </Button>
            </div>
            <div className={classnames(styles.actionsBarItem)} role="presentation">
              <Button
                type="text"
                size="small"
                icon={<AntdIcon type="icon-a-Share-twofenxiang21" className={styles.icon} />}
                onClick={() => {
                  EventEmitter.emit('beyond-messageList-set-multichoices-msgid', [msgId]);
                  EventEmitter.emit('beyond-messageList-open-multichoices', ['shared']);
                }}
              >
                <span className={styles.actionsBarText}>{intl.formatMessage({ id: 'common.share' })}</span>
              </Button>
            </div>
            <MoreActions deleteMessage={deleteMessage} msg={msg} />
          </Space>
        </div>
      );
    },
    [deleteMessage, updateMessage, intl]
  );

  const beyondAnswerActions = useCallback(
    (msg: IMessage) => {
      const { msgId, messageState } = msg;

      return (
        <div className="full-width ub ub-ver" style={{ position: 'relative' }}>
          <div className="ub ub-ac ub-wrap" style={{ gap: '6px 0' }}>
            <Space size={2}>
              {[IMessageState.Done, IMessageState.Cancel].includes(messageState) && (
                <>
                  <div className={classnames(styles.actionsBarItem)} role="presentation">
                    <Button
                      type="text"
                      size="small"
                      icon={<AntdIcon type="icon-a-Listliebiao" className={styles.icon} />}
                      onClick={() => {
                        EventEmitter.emit('beyond-messageList-set-multichoices-msgid', [msgId]);
                        EventEmitter.emit('beyond-messageList-open-multichoices', ['reference']);
                      }}
                    >
                      <span className={styles.actionsBarText}>{intl.formatMessage({ id: 'common.quote' })}</span>
                    </Button>
                  </div>
                  <div className={classnames(styles.actionsBarItem)} role="presentation">
                    <Button
                      type="text"
                      size="small"
                      icon={<AntdIcon type="icon-a-Share-twofenxiang21" className={styles.icon} />}
                      onClick={() => {
                        EventEmitter.emit('beyond-messageList-set-multichoices-msgid', [msgId]);
                        EventEmitter.emit('beyond-messageList-open-multichoices', ['shared']);
                      }}
                    >
                      <span className={styles.actionsBarText}>{intl.formatMessage({ id: 'common.share' })}</span>
                    </Button>
                  </div>
                  <div className={classnames(styles.actionsBarItem)} role="presentation">
                    <Button
                      type="text"
                      size="small"
                      icon={<AntdIcon type="icon-a-Starxingxing" className={styles.icon} />}
                      onClick={() => {
                        EventEmitter.emit('beyond-messageList-set-multichoices-msgid', [msgId]);
                        EventEmitter.emit('beyond-messageList-open-multichoices', ['collect']);
                      }}
                    >
                      <span className={styles.actionsBarText}>{intl.formatMessage({ id: 'common.collect' })}</span>
                    </Button>
                  </div>
                  {/* <Memory msg={msg} /> */}
                </>
              )}
              <MoreActions deleteMessage={deleteMessage} msg={msg} />
            </Space>
            <Divider type="vertical" />
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
  const citeMsgRender = useCallback(
    (citeMsgList?: IMessage[]) => {
      if (!citeMsgList || isEmpty(citeMsgList)) return null;

      return (
        <div className={classnames(styles.fileList, 'ub ub-wrap full-width')} style={{ justifyContent: 'inherit' }}>
          <CiteRender messageList={citeMsgList} sessionId={sessionId} />
        </div>
      );
    },
    [sessionId]
  );

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

  const relatedQuestionsRender = useCallback((msg: IMessage) => {
    const relatedQuestions = get(msg, 'relatedQuestions');

    if (!isArray(relatedQuestions) || isEmpty(relatedQuestions)) return null;

    const hasChatBI = msg?.messageList?.find((item: any) =>
      [`${SSEMessageType.chartBI}`, `${SSEMessageType.recommend}`].includes(`${item.contentType}`)
    );
    if (hasChatBI || msg?.agentType === agentTypeMap.chatbi) return null;

    return (
      <div className={styles.questionTips}>
        {relatedQuestions.map((item) => (
          <div
            className={styles.bubleButton}
            key={item}
            onClick={() => {
              EventEmitter.emit('queryInput-set-value', item);
            }}
          >
            {item}
            <ArrowRightOutlined />
          </div>
        ))}
      </div>
    );
  }, []);

  const attachmentListRender = useCallback(
    (msg: IMessage) => {
      const { fromBeyond, fromOtherUser, imageList, fileList, citeMsgList, extParams } = msg;

      const isLeftSide = fromBeyond || fromOtherUser;

      const renderList = compact([
        uploadFileRender(imageList, msg),
        uploadFileRender(fileList, msg),
        citeMsgRender(citeMsgList),
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
    },
    [citeMsgRender]
  );

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

      const { showRelatedQuestions = false, hideAction } = param || {};
      const agentInfo = getResponseAgentInfo({ employeesList, agentList }, msg.metadata);
      const isLeftSide = fromBeyond || fromOtherUser;

      let leftName: string;
      if (fromBeyond) {
        leftName =
          agentInfo?.name ||
          getSystemConfigByStorage().title ||
          intl.formatMessage({ id: 'messageList.defaultAIName' });
      } else {
        leftName = creatorName || '用户';
      }

      const leftSideLogo = (() => {
        if (!isLeftSide) return null;
        const avatar = fromBeyond ? agentInfo?.chatAvatar : '';
        return (
          <div className={styles.beyondLogo}>
            {getAgentChatAvatar(avatar || `${getPublicPath()}beyond/logo100.svg`)}
          </div>
        );
      })();
      const showRightUserNameDiv = !isLeftSide;

      let displayCreateTime = createTime;
      if (createTime) {
        displayCreateTime = getDisplayDateTime(createTime);
      }

      return (
        <div
          key={msgId}
          data-frombeyond={!!isLeftSide}
          className={classnames(styles.messageRow, 'gap8', {
            [styles.left]: isLeftSide,
            [styles.right]: showRightUserNameDiv,
          })}
        >
          <div className="ub ub-ac gap8">
            {isLeftSide && leftSideLogo}
            {isLeftSide && (
              <div className={classnames(styles.name, 'ub-ver')}>
                <p className={styles.n}>{leftName}</p>
                <span className={styles.createTime}>{displayCreateTime}</span>
              </div>
            )}
          </div>
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
                    setMyTitle(messageTip);
                    setMyContent(traceback);
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
          {showRelatedQuestions && relatedQuestionsRender(msg)}
        </div>
      );
    },
    [agentList, userId, employeesList, attachmentListRender, citeMsgRender, updateMessage]
  );

  const extendsRender = <>{ModalNode}</>;

  return {
    renderMessage,
    extendsRender,
  };
}
