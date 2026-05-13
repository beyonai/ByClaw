// tslint:disable:ordered-imports
import React, { Suspense, useCallback } from 'react';
import { ArrowRightOutlined, InfoCircleOutlined } from '@ant-design/icons';
// @ts-ignore
import { useIntl, useSelector } from '@umijs/max';
import { Divider, Space, Tooltip, Typography, Button } from 'antd';
import classnames from 'classnames';
import { get, isArray, isEmpty, noop, compact } from 'lodash';

import EmployeesDrawer from '@/pages/employees/components/EmployeesDrawer';

import DualBallLoading from '@/components/Loading/DualBallLoading';
import WaveBallLoading from '@/components/Loading/WaveBallLoading';
import CiteRender from '@/components/MessageList/components/CiteRender';
import FileRender from '@/components/MessageList/components/FileRender';
import NotSupport from '@/components/NotSupport';

import ThumbUpContent from './components/AnswerActions/ThumbUp/content';
import CopyComp from './components/AnswerActions/Copy';
import MoreActions from './components/AnswerActions/MoreActions';
import ThumbUp from './components/AnswerActions/ThumbUp';
import MsgRenderer from './components/MsgRenderer';
import UserInfoModal from '@/components/OrgUserSelector/components/UserInfoModal';
// import Memory from './components/Memory';

import useModal from '@/hooks/useModal';
import useGlobal from '@/hooks/useGlobal';
import useCanRefrence from '@/components/ChatLayoutComp/components/MultiChoices/hooks/useCanRefrence';

import lazyHandler from './lazyHandler';

import { agentTypeMap } from '@/constants/agent';
import { getPublicPath } from '@/utils';

import { getAgentChatAvatar } from '@/utils/agent';

import { IMessageState, SSEMessageType } from '@/constants/message';

import type { IState as useEmployeesIState } from '@/models/useEmployees';
import type { IFile } from '@/typescript/file';
import type { IMessage, IExtParams } from '@/typescript/message';
import type { IAgentCache } from '@/typescript/agent';

import styles from './index.module.less';
import getDisplayQuestion from '../QueryInput/getDisplayQuestion';
import getDisplayAnswer from '../QueryInput/getDisplayAnswer';
import { getDisplayUserNameInChat } from '@/utils/chat';
import { getDisplayDateTime, getResponseAgentInfo } from './utils';
import { getSystemConfigByStorage } from '@/utils/system';
import AntdIcon from '../AntdIcon';

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

  const { userInfo } = useSelector(({ user }) => ({ userInfo: user.userInfo }));
  const { employeesList, agentList }: useEmployeesIState = useSelector(
    ({ employees }: { employees: useEmployeesIState }) => ({
      ...employees,
    })
  );

  const intl = useIntl();
  const { EventEmitter } = useGlobal();

  const { canRefrence } = useCanRefrence();

  const { userId } = userInfo || {};
  const userQueryActions = useCallback(
    (msg: IMessage) => {
      const { text, resourceList, msgId } = msg;

      return (
        <div className="ub ub-ac">
          <CopyComp richText={text} text={getDisplayQuestion({ text, resourceList })} />
          <Divider type="vertical" />
          <Space size={2}>
            {canRefrence && (
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
            )}
            {/* <div className={classnames(styles.actionsBarItem)} role="presentation">
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
            </div> */}
            <MoreActions deleteMessage={deleteMessage} msg={msg} />
          </Space>
        </div>
      );
    },
    [deleteMessage, updateMessage, intl, canRefrence]
  );

  const beyondAnswerActions = useCallback(
    (msg: IMessage) => {
      const { messageList, msgId, messageState } = msg;

      return (
        <div className="full-width ub ub-ver" style={{ position: 'relative' }}>
          <div className={classnames('ub ub-ac ub-wrap', styles.beyondAnswerActions)} style={{ gap: '6px 0' }}>
            <Space size={1}>
              {[IMessageState.Done, IMessageState.Cancel].includes(messageState) && (
                <>
                  {canRefrence && (
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
                  )}
                  {/* <div className={classnames(styles.actionsBarItem)} role="presentation">
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
                  </div> */}
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
                      <span className={styles.actionsBarText}>{intl.formatMessage({ id: 'common.save' })}</span>
                    </Button>
                  </div>
                  {/* <Memory msg={msg} /> */}
                </>
              )}
              <MoreActions deleteMessage={deleteMessage} msg={msg} />
            </Space>
            <Divider type="vertical" size="small" />
            <Space size="small">
              <CopyComp text={getDisplayAnswer(messageList)} />
              {[IMessageState.Done, IMessageState.Cancel].includes(messageState) && (
                <ThumbUp updateMessage={updateMessage} msg={msg} />
              )}
            </Space>
          </div>
          <ThumbUpContent msg={msg} updateMessage={updateMessage} />
        </div>
      );
    },
    [deleteMessage, updateMessage, canRefrence]
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
        creatorId,
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
      const isSuperAssistant = fromBeyond && !!agentInfo?.isSuperAssistant;

      let leftName: string;
      if (fromBeyond || isSuperAssistant) {
        leftName =
          agentInfo?.name ||
          getSystemConfigByStorage().title ||
          intl.formatMessage({ id: 'messageList.defaultAIName' });
      } else {
        leftName = creatorName || intl.formatMessage({ id: 'common.user' });
      }

      const leftSideLogo = (() => {
        if (!isLeftSide) return null;
        if (fromOtherUser || isSuperAssistant) {
          // 这种情况下，应该渲染一个人名框
          return (
            <div className={classnames(styles.beyondLogo, styles.userName)}>
              <UserInfoModal user={{ userId: creatorId }}>
                <span>{getDisplayUserNameInChat(leftName)}</span>
              </UserInfoModal>
            </div>
          );
        }
        const avatar = fromBeyond || isSuperAssistant ? agentInfo?.chatAvatar : '';
        return (
          <div className={styles.beyondLogo}>
            <EmployeesDrawer agentInfo={agentInfo as Partial<IAgentCache>}>
              {getAgentChatAvatar(avatar || `${getPublicPath()}beyond/logo100.svg`)}
            </EmployeesDrawer>
          </div>
        );
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
              {isSuperAssistant && (
                <div className={styles.assistantMark}>
                  <span>{intl.formatMessage({ id: 'common.digitalClone' })}</span>
                </div>
              )}
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
              <div className="ub ub-ac">
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
              </div>
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
    [agentList, userId, employeesList, attachmentListRender, citeMsgRender, updateMessage, beyondAnswerActions]
  );

  const extendsRender = <>{ModalNode}</>;

  return {
    renderMessage,
    extendsRender,
  };
}
