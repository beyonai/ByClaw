import React, { useEffect, useMemo } from 'react';
import classNames from 'classnames';
import { Button, Layout, Spin } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { isFunction, last, get, isString, noop, set, concat, cloneDeep } from 'lodash';
import { getLocale, useDispatch, useSelector, useIntl } from '@umijs/max';

import ChatLayoutComp from '@/components/ChatLayoutComp';
import { agentTypeMap, ROOT_AGENT_ID } from '@/constants/agent';

import AntdProvider from '@/layout/components/provider/antd';

import GlobalContext, { Platform } from '@/layout/components/provider/global';

import AbsoluteDrawer from '@/components/AbsoluteDrawer';
import MainDrawer from '@/components/MainDrawer';
import MinorDrawer from '@/components/MinorDrawer';
import AgentIframe from '@/pages/employees/components/AgentIframe';
import { EventEmitter$Cls } from '@/utils/eventEmitter';

import { IMessageState, SSEMessageType } from '@/constants/message';

import type { IMessageListItemContent } from '@/components/MessagesComp/Application';
import type { IAgentType } from '@/typescript/agent';
import type { IMessage } from '@/typescript/message';
import type { IMessageInfo } from '@/models/useMessageStore';
import type { IDrawerMessage } from '@/components/FullAbsoluteDrawer';

import styles from './index.module.less';
import useGlobal from '@/hooks/useGlobal';
import { getResponseAgentInfo } from '../MessageList/utils';

const { Content } = Layout;

type IProps = {
  onClose: () => void;
  onUpdateMessage: (message: IDrawerMessage) => void;

  currentMessage: IMessage;
  messageListItemContent: IMessageListItemContent;
  autoAsk?: boolean;
  toRecover?: boolean;
  isDone?: boolean;
};

const myEventEmitter = new EventEmitter$Cls();

function ApplicationSession(props: IProps) {
  const intl = useIntl();
  const { EventEmitter } = useGlobal();
  const dispatch = useDispatch();

  const {
    onClose,
    onUpdateMessage,
    messageListItemContent,
    currentMessage,
    autoAsk = true,
    toRecover = false,
    isDone,
  } = props;
  const { substance: agentInfo } = messageListItemContent || {};

  const { args } = get(messageListItemContent, 'substance') || {};
  const { input: chatInput, files } = args;

  const { sessionId, isSubagent } = agentInfo;
  const mySessionId = `${sessionId || ''}`;

  const [agentId, setAgentId] = React.useState<string>(agentInfo.agentId);
  const [agentType, setAgentType] = React.useState<IAgentType>(agentInfo.agentType || agentTypeMap.common);

  const [loading, setLoading] = React.useState(true);
  const [canSummary, setCanSummary] = React.useState<boolean>(false);
  const [summaryText, setSummaryText] = React.useState<{ content?: string; files?: any[] }>({});

  const layoutRef = React.useRef<HTMLDivElement>(null);
  const chatLayoutCompRef = React.useRef(null);

  const { agentList, employeesList } = useSelector(({ employees }) => ({
    agentList: employees.agentList || [],
    employeesList: employees.employeesList,
  }));

  const { metadata } = currentMessage;
  const messageAgentInfo = useMemo(
    () => getResponseAgentInfo({ agentList, employeesList }, metadata),
    [metadata, agentList, employeesList]
  );

  const curAgentInfo = React.useMemo(() => {
    return [...(agentList || []), ...(employeesList || [])].find(
      (item) => `${item.id}` === `${agentId}` || `${item.resourceCode}` === `${agentId}`
    );
  }, [agentList, employeesList, agentId]);

  const { agentHomeUrl, integrationType } = curAgentInfo || {};

  const isPage = integrationType === 'PAGE'; // 整个页面打开iframe，如：慧记
  const isInterface = integrationType === 'INTERFACE'; // 主驾页面打开iframe，如：慧笔
  const isNONE = integrationType === 'NONE' || !integrationType; // 纯主驾聊天

  const getSendPayloadAgentId = React.useCallback(() => {
    if (isSubagent) {
      // 如果是subagent，则取这次会话原本的目标agent。如果没有，那就是跟默认数字员工聊的。
      // 在拿到任何summary后，应该都是找回main agent，因为再找subagent，main的流程走不下去。
      // 因此如果subagent在处理任务的时候失败了，应该通过提示词告诉main agent缺失的信息，重新通过main agent发起流程
      return messageAgentInfo?.agentId || ROOT_AGENT_ID;
    }
    return agentId;
  }, [isSubagent, agentId, messageAgentInfo]);

  const getLastMessageInLoop = React.useCallback(() => {
    const getLast = () => {
      setTimeout(() => {
        dispatch({
          type: 'messageStore/getSessionMessage',
          payload: {
            sessionId: mySessionId,
          },
        }).then((info: IMessageInfo) => {
          const lastMessage = last(info.list);
          if (lastMessage && lastMessage.fromBeyond && lastMessage.messageState === IMessageState.Done) {
            setCanSummary(true);
          } else {
            getLast();
          }
        });
      }, 5000);
    };
    getLast();
  }, [mySessionId]);

  const autoSend = () => {
    if (!chatInput || !autoAsk) return;

    setAgentId(agentInfo.agentId);
    setAgentType(agentInfo.agentType);

    const extParams = {
      language: getLocale(),
    };

    const sendProps = {
      queryQuestion: chatInput,
      payload: {
        agentId: getSendPayloadAgentId(),
        agentType: agentInfo.agentType,
        files,
        extParams,
      },
      msgOpt: {
        queryMsg: {
          fileList: (files || []).map((item) => {
            return {
              fileType: item.fileType,
              uid: item.fileId,
              imgUrl: item.fileType === 'image' ? item.fileUrl : undefined,
              status: 'done',
              queryFile: {
                ...item,
                length: item.fileSize,
              },
            };
          }),
        },
        answerMsg: {
          agentId: agentInfo.agentId,
          agentType: agentInfo.agentType,
        },
      },
    };

    if (`${agentInfo.agentType}` === agentTypeMap.chatbi) {
      Object.assign(extParams, {});
    }
    if (`${agentInfo.agentType}` === agentTypeMap.writer) {
      Object.assign(extParams, {
        files: [],
        intention: 'OUTLINE',
        templateId: -1,
        outlineType: 'writer',
        searchEnabled: false,
      });

      set(sendProps, 'payload.outlineImitation', false);
    }

    setTimeout(() => {
      myEventEmitter.emit('beyond-chat-on-send-msg', {
        sendProps,
      });

      getLastMessageInLoop();
    }, 300);
  };

  const getLastMessageContent = React.useCallback(() => {
    if (isFunction(chatLayoutCompRef.current?.getMessageList)) {
      const messageList = chatLayoutCompRef.current?.getMessageList?.() || [];
      if (Array.isArray(messageList) && messageList.length > 0) {
        let mySummaryText = '';
        (get(last(messageList), 'messageList') || []).forEach((item) => {
          const { contentType, content } = item;
          if (`${contentType}` === `${SSEMessageType.chartBI}`) {
            mySummaryText += `${intl.formatMessage({ id: 'applicationSession.chart' })}：`;
          } else {
            mySummaryText += `${intl.formatMessage({ id: 'applicationSession.content' })}：`;
          }

          try {
            const substanceStr = get(content, 'substance');
            if (isString(substanceStr)) {
              mySummaryText += substanceStr;
            } else {
              mySummaryText += JSON.stringify(substanceStr);
            }
          } catch (e) {
            console.error(e);
          }

          mySummaryText += '\n';
        });

        return mySummaryText;
      }
    }

    return '';
  }, [intl]);

  const contentRender = React.useCallback(() => {
    if (loading) {
      return (
        <div className="full-width full-height ub ub-ac ub-pc">
          <Spin spinning />
        </div>
      );
    }

    return (
      <Content
        className={classNames(styles.content, {
          [styles.opening]: true,
        })}
      >
        <div className="full-width full-height ub" id="application_wrapper">
          <ChatLayoutComp
            isBottom
            readOnly={isDone}
            hideChatTitle
            sessionId={mySessionId}
            agentType={agentType}
            setAgentType={setAgentType}
            queryInputProps={{
              placeholder: '',
            }}
            ref={chatLayoutCompRef}
          />
        </div>
      </Content>
    );
  }, [mySessionId, agentType, isDone, loading]);

  const createSummary = (param?: { content?: string; files?: any[] }) => {
    const { content: mySummaryText, files } = param || summaryText;

    console.log('createSummary summaryText', mySummaryText);
    console.log('currentMessage', currentMessage);
    console.log('messageListItemContent', messageListItemContent);
    console.log('agentInfo', agentInfo);

    // currentUpdateMessageListItemContent({
    //   ...messageListItemContent,
    // });

    const payload = {
      sendProps: {
        queryQuestion: mySummaryText,
        payload: {
          files,
          agentId: getSendPayloadAgentId(),
          agentType,
          extParams: {
            resumeFromSubAgent: isSubagent
              ? {
                agentName: curAgentInfo.name,
                agentId: curAgentInfo.id,
              }
              : undefined,
            contentType: `${SSEMessageType.application}`,
            agentCard: {
              ...(get(messageListItemContent, 'substance') || {}),
            },
            files,
          },

          llmMessageId: currentMessage.messageId,
          taskOperateType: 'FEEDBACK',
          taskStepId: get(messageListItemContent, 'stepId'),
        },
        msgOpt: {
          answerMsg: {},
        },
      },
      sendConf: {
        onlyQuery: true,
      },
    };

    if (toRecover) {
      set(payload, 'sendProps.msgOpt', {
        answerMsg: {
          ...currentMessage,
          messageState: IMessageState.Query,
        },
        queryMsg: {
          msgId: currentMessage.queryMsgId,
        },
      });
    }

    EventEmitter.emit('beyond-chat-on-send-msg', payload);

    const newMessage = cloneDeep(currentMessage);
    const messageListItem = [...(get(newMessage, 'messageList') || []), ...(get(newMessage, 'thinkList') || [])].find(
      (item: any) => {
        return `${item?.content?.substance?.sessionId}` === `${messageListItemContent.substance.sessionId}`;
      }
    );

    if (messageListItem) {
      set(messageListItem, 'content.substance.status', '1');
      onUpdateMessage(newMessage as IDrawerMessage);
    }
  };

  const encodeAgentHomeUrl = React.useMemo(() => {
    if (isPage && agentHomeUrl) {
      try {
        const url = new URL(agentHomeUrl);

        url.searchParams.append('messageId', currentMessage.messageId || '');

        if (!isDone) {
          if (chatInput) {
            url.searchParams.append('chatInputValue', chatInput);
          }
          if (files) {
            try {
              url.searchParams.append('files', btoa(encodeURIComponent(JSON.stringify(concat([], files)))));
            } catch (e) {
              console.error(e);
            }
          }
        }

        return decodeURIComponent(url.toString());
      } catch (e) {
        console.error(e);
      }
    }

    return agentHomeUrl;
  }, [isPage, agentHomeUrl, chatInput, currentMessage.messageId, files, isDone]);

  const toSummary = () => {
    if (!canSummary || isDone) return;

    if (isNONE || isInterface) {
      const payload = {
        content: getLastMessageContent(),
      };

      setSummaryText(payload);
      createSummary(payload);

      return;
    }

    createSummary();
  };

  React.useEffect(() => {
    const getSummary = (e: MessageEvent) => {
      console.log('getSummary:', e.data);
      const type = e.data.eventType || e.data.type;

      if (type !== 'createSummary') return;
      setSummaryText(get(e, 'data.data', {}));
      setCanSummary(true);
    };
    window.addEventListener('message', getSummary);

    return () => {
      window.removeEventListener('message', getSummary);
    };
  }, []);

  useEffect(() => {
    if (isNONE || isInterface) {
      setAgentId(agentInfo?.agentId);
      setAgentType(agentInfo?.agentType);

      dispatch({
        type: 'messageStore/getSessionMessage',
        payload: {
          sessionId: mySessionId,
        },
      })
        .then((info: IMessageInfo) => {
          const lastMessage = last(info.list);
          if (lastMessage && lastMessage.fromBeyond) {
            if (lastMessage.messageState === IMessageState.Done) {
              setCanSummary(true);
            }
          } else {
            autoSend();
          }
        })
        .finally(() => {
          setLoading(false);
        });
    }

    return () => {
      const lastMessage = last(chatLayoutCompRef.current?.getMessageList?.());
      if (lastMessage && isFunction(lastMessage.cancelSSE)) {
        lastMessage?.cancelSSE?.();
      }
    };
  }, []);

  // 必须用memo，对象参数的变化会导致iframe刷新（不是基于React或者vue这类框架的话，页面就会闪一下）
  const iframeAgentMemo = React.useMemo(() => {
    return {
      agentHomeUrl: encodeAgentHomeUrl,
      id: agentId,
      agentId,
      agentType,
    };
  }, [agentId, agentType, encodeAgentHomeUrl]);

  // todo: 不能智办
  if (!mySessionId && !isPage) return null;

  return (
    <div className="full-width full-height ub ub-ver" ref={layoutRef}>
      <div className={classNames(styles.header, 'ub ub-ac ub-pj gap4')}>
        <Button
          icon={<ArrowLeftOutlined />}
          type="text"
          onClick={() => {
            toSummary();
            onClose();
          }}
        />
        <div className="ub-f1 ellipsis" title={chatInput}>
          {chatInput}
        </div>
        {!isDone && (
          <div style={{ marginLeft: 'auto' }}>
            {!canSummary && (
              <div
                className={classNames('ub ub-ac gap8', styles.taskBtn, styles.running)}
                style={{ paddingRight: '12px' }}
              >
                <i className={classNames(styles.star, styles.running)} />
                {intl.formatMessage({ id: 'applicationSession.processing' })}
              </div>
            )}
            {canSummary && (
              <div className={classNames('ub ub-ac gap8', styles.taskBtn)}>
                <i className={styles.star} />
                {intl.formatMessage({ id: 'applicationSession.subTaskCompleted' })}
                <Button
                  size="small"
                  type="primary"
                  shape="round"
                  onClick={() => {
                    toSummary();
                    onClose();
                  }}
                  style={{ marginLeft: '16px' }}
                >
                  {intl.formatMessage({ id: 'applicationSession.continueMainTask' })}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="ub-f1 overflow-hidden" style={{ backgroundColor: '#fff' }}>
        <AntdProvider>
          <GlobalContext.Provider
            value={{
              platform: Platform.pc,
              sessionId: mySessionId,
              setSessionId: noop,
              agentId,
              setAgentId,
              agentInfo: curAgentInfo,
              EventEmitter: myEventEmitter,
            }}
          >
            <Layout
              className="full-width full-height ub ub-ver"
              style={
                {
                  '--user-fill-color': '#F2F6FA',
                  '--layout-gap': '8px',
                } as React.CSSProperties
              }
            >
              <Layout
                id="application-session-layout"
                className={classNames('full-width full-height ub-f1', styles.layout)}
                style={{ position: 'relative', flexDirection: 'row' }}
              >
                <MinorDrawer />
                {(isNONE || isInterface) && contentRender()}
                {isPage && <AgentIframe agent={iframeAgentMemo} />}
                <MainDrawer />
              </Layout>
              <AbsoluteDrawer getContainer={() => layoutRef.current || window.document.body} />
            </Layout>
          </GlobalContext.Provider>
        </AntdProvider>
      </div>
    </div>
  );
}
export default ApplicationSession;
