import React from 'react';
import classNames from 'classnames';
import { useSelector, useIntl } from '@umijs/max';
import { Layout, Button, Spin, Space } from 'antd';
import { noop, head, last, cloneDeep, size, isFunction, orderBy } from 'lodash';
import { DownOutlined, CloseOutlined, PauseOutlined } from '@ant-design/icons';

import { generateUniqueId, getRandomNumber } from '@/utils/math';
import { themes } from '@/constants/theme';

import AntdProvider from '@/layout/components/provider/antd';
import GlobalContext, { Platform } from '@/layout/components/provider/global';
import useRender from '@/components/MessageList/useRender';
import { getTemplateSessionDetail } from '@/service/session';

import Achievements, { TriggerRef } from '@/pages/workSpace/Achievements';
import AntdIcon from '@/components/AntdIcon';
import AbsoluteDrawer from '@/components/AbsoluteDrawer';
import MainDrawer from '@/components/MainDrawer';
import MinorDrawer from '@/components/MinorDrawer';

import DividerTips from '@/components/MessageList/components/DividerTips';
import SystemTips from '@/components/MessageList/components/SystemTips';
import InfiniteScroll from '@/components/InfiniteScroll';
import ChatAvatar from '@/components/ChatAvatar';

import { createMessage, fetchMessageHandler, initAnswerMessage } from '@/utils/messgae';
import { EventEmitter$Cls } from '@/utils/eventEmitter';
import useToBottomBtn from '@/components/MessageList/hooks/useToBottomBtn';
import { LayoutMode } from '@/constants/system';

import { IMessageState } from '@/constants/message';
import type { IMessage } from '@/typescript/message';

import styles from './index.module.less';
import messageListStyles from '@/components/MessageList/index.module.less';
import FullScreenModal from '../FullScreenModal';

const { Content } = Layout;

type IProps = {
  sessionInfo: {
    sessionId: string;
    sessionName: string;
  };

  onClose: () => void;
};

const myEventEmitter = new EventEmitter$Cls();
const REPLAY_TEMPLATE_INTERVAL_TIME = 2000;
export const cannotClickList = [
  '2001',
  '2002',
  '2003',
  '2004',
  '2005',
  '2006',
  '2007',
  '2008',
  '2009',
  '2010',
  '2011',
  '2012',
  '2013',
  '2014',
  '2015',
];

export const PreviewMessageRenderer = (
  props: {
    list: IMessage[];
    layoutRef: React.RefObject<HTMLDivElement | null>;
    forwardScrollMessageRef: React.RefObject<HTMLDivElement | null>;
  } & Pick<IProps, 'sessionInfo'>
) => {
  const { sessionInfo, list } = props;
  const { forwardScrollMessageRef, layoutRef } = props;
  const { sessionId } = sessionInfo;

  const [agentId, setAgentId] = React.useState<string>('');

  const scrollMessageDomId = React.useRef<string>(`scrollMessage_${generateUniqueId()}`);
  const infiniteScrollRef = React.useRef<InfiniteScroll>(null);

  const { agentList, employeesList } = useSelector(({ employees }) => ({
    agentList: employees.agentList || [],
    employeesList: employees.employeesList,
  }));

  const curAgentInfo = React.useMemo(() => {
    return [...(agentList || []), ...(employeesList || [])].find(
      (item) => `${item.id}` === `${agentId}` || `${item.resourceCode}` === `${agentId}`
    );
  }, [agentList, employeesList, agentId]);

  const { toBottomBtnVisable, setToBottomBtnVisable } = useToBottomBtn({
    messageList: list,
    scrollMessageId: scrollMessageDomId.current,
  });

  const { renderMessage, extendsRender } = useRender({
    updateMessage: noop,
    deleteMessage: noop,
    sessionId,
  });

  const toBottom = React.useCallback(() => {
    infiniteScrollRef.current?.scrollToBottom();
    setToBottomBtnVisable(false);
  }, []);

  return (
    <AntdProvider>
      <GlobalContext.Provider
        value={{
          platform: Platform.pc,
          sessionId,
          setSessionId: noop,
          agentId,
          agentInfo: curAgentInfo,
          setAgentId,
          EventEmitter: myEventEmitter,
          layoutMode: LayoutMode.preview,
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
            className={classNames('full-width full-height ub-f1', messageListStyles.layout)}
            style={{ position: 'relative', flexDirection: 'row', background: '#fff' }}
          >
            <MinorDrawer />
            <div className="ub ub-ver ub-f1 full-width full-height" style={{ borderRight: '1px solid #E5E5E5' }}>
              <Content
                className={classNames(messageListStyles.content, {
                  [messageListStyles.opening]: true,
                })}
              >
                <div className="full-height full-width" style={{ position: 'relative' }}>
                  <div
                    className={classNames(messageListStyles.messageContent, 'full-height full-width hideThumb')}
                    id={scrollMessageDomId.current}
                    ref={forwardScrollMessageRef}
                  >
                    <InfiniteScroll
                      ref={infiniteScrollRef}
                      next={noop}
                      hasMore={false}
                      loader={null}
                      dataLength={list.length}
                      scrollableTarget={scrollMessageDomId.current}
                      inverse
                      className={classNames(messageListStyles.messageRowWrap)}
                      scrollThreshold="50px"
                      hasChildren={list.length > 0}
                      topItemKey={head(list)?.msgId}
                      bottomItemKey={last(list)?.updateKey || last(list)?.msgId}
                      style={{
                        overflow: 'visible',
                      }}
                    >
                      {list.map((msg, idx, arr) => {
                        const { msgId } = msg;
                        const { usage, text } = msg;

                        const isDividerTips = `${usage}` === '3';
                        const isSystemTips = `${usage}` === '5';

                        return (
                          <div
                            key={`${msgId}_wrapper`}
                            className={classNames('ub ub-pa mW900', messageListStyles.msgWrapper)}
                            id={`wrapper_${msgId}`}
                            style={{ zIndex: arr.length - idx, position: 'relative' }}
                          >
                            <div className="ub-f1 mW850">
                              {isDividerTips && <DividerTips text={text} />}
                              {isSystemTips && <SystemTips text={text} />}
                              {!isDividerTips &&
                                !isSystemTips &&
                                renderMessage(msg, {
                                  showRelatedQuestions: false,
                                  hideAction: true,
                                })}
                            </div>
                          </div>
                        );
                      })}
                    </InfiniteScroll>
                  </div>
                  {toBottomBtnVisable && (
                    <div className={classNames(messageListStyles.toBottomBtn, 'pointer')}>
                      <Button
                        icon={<DownOutlined />}
                        shape="circle"
                        onClick={() => {
                          toBottom();
                        }}
                      />
                    </div>
                  )}
                </div>
              </Content>
            </div>
            <MainDrawer />
          </Layout>
          <AbsoluteDrawer getContainer={() => layoutRef.current || window.document.body} />
          <FullScreenModal />
          {extendsRender}
        </Layout>
      </GlobalContext.Provider>
    </AntdProvider>
  );
};

const ReplayTemplate = (props: IProps) => {
  const intl = useIntl();
  const { sessionInfo, onClose } = props;
  const { sessionId, sessionName } = sessionInfo;

  const [loading, setLoading] = React.useState<boolean>(true);
  const [list, setList] = React.useState<IMessage[]>([]);
  const [replayed, setReplayed] = React.useState<boolean>(true);
  const forwardScrollMessageRef = React.useRef<HTMLDivElement>(null);
  const layoutRef = React.useRef<HTMLDivElement>(null);
  const achievementRef = React.useRef<TriggerRef>(null);

  const timerRef = React.useRef<any>('');
  const cacheListRef = React.useRef<IMessage[]>([]);
  const isStoppedRef = React.useRef<boolean>(true);

  const eventRef = React.useRef(noop);

  const mySessionInfo = React.useMemo(() => {
    return {
      theme: themes[getRandomNumber(0, size(themes) - 1)],
      avatar: 'beyond/session.png',
      updateTime: Date.now().toString(),
      parentSessionId: -1, // 列表中的父会话ID
      createTime: Date.now().toString(), // 会话的创建时间
      ...sessionInfo,
    };
  }, [sessionInfo]);

  // const onToggleAchievements = () => {
  //   achievementRef.current?.toggle();
  // };

  const startRunning = async () => {
    if (!cacheListRef.current || cacheListRef.current.length === 0) {
      return Promise.resolve();
    }

    // 遍历 cacheListRef 中的每个 message
    for (let i = 0; i < cacheListRef.current.length; i += 1) {
      // 检查是否被停止
      if (isStoppedRef.current) {
        break;
      }

      const item = cacheListRef.current[i];

      if (!item.fromBeyond) {
        setList((prevList) => [...prevList, item]);
      } else {
        // 先插入当前 message 到 list 中
        setList((prevList) => [...prevList, initAnswerMessage(cloneDeep(item))]);

        // 处理 thinkList
        if (item.thinkList && item.thinkList.length > 0) {
          for (const thinkItem of item.thinkList) {
            // 检查是否被停止
            if (isStoppedRef.current) {
              break;
            }

            await new Promise((resolve) => {
              timerRef.current = setTimeout(resolve, REPLAY_TEMPLATE_INTERVAL_TIME);
            }); // 等待2秒
            if (isStoppedRef.current) {
              break;
            }

            setList((prevList) => {
              const i = last(prevList);

              if (i) {
                Object.assign(i, {
                  thinkList: [...(i.thinkList || []), thinkItem],
                  updateKey: `${item.msgId}_think_${thinkItem.contentType}_${Date.now()}`,
                });
              }

              return [...prevList];
            });
          }
        }

        // 处理 messageList
        if (item.messageList && item.messageList.length > 0) {
          for (const messageItem of item.messageList) {
            // 检查是否被停止
            if (isStoppedRef.current) {
              break;
            }

            await new Promise((resolve) => {
              timerRef.current = setTimeout(resolve, REPLAY_TEMPLATE_INTERVAL_TIME);
            }); // 等待2秒
            if (isStoppedRef.current) {
              break;
            }
            setList((prevList) => {
              const i = last(prevList);

              if (i) {
                Object.assign(i, {
                  messageList: [...(i.messageList || []), messageItem],
                  updateKey: `${item.msgId}_message_${messageItem.contentType}_${Date.now()}`,
                });
              }

              return [...prevList];
            });
          }
        }

        setList((prevList) => {
          const i = last(prevList);

          if (i) {
            Object.assign(i, {
              messageState: IMessageState.Done,
            });
          }

          return [...prevList];
        });
      }

      // 如果不是最后一个 message，等待再处理下一个
      if (i < cacheListRef.current.length - 1) {
        // 检查是否被停止
        if (isStoppedRef.current) {
          break;
        }

        await new Promise((resolve) => {
          timerRef.current = setTimeout(resolve, 1000);
        }); // 等待1秒
      }
    }

    return Promise.resolve();
  };

  const stopTask = React.useCallback(() => {
    setReplayed(true);
    isStoppedRef.current = true;

    clearTimeout(timerRef.current);
  }, []);

  const startTask = React.useCallback(() => {
    setReplayed(false);
    isStoppedRef.current = false;

    startRunning().finally(stopTask);
  }, []);

  const addEvent = React.useCallback(() => {
    const h = (e: any) => {
      console.log(e);

      e.preventDefault();
      e.stopPropagation();
    };
    setTimeout(() => {
      forwardScrollMessageRef.current?.querySelectorAll('div[data-comptype]').forEach((item) => {
        if (cannotClickList.includes(`${item.dataset?.comptype}`)) {
          item.addEventListener('click', h);
        }
      });
    }, 100);

    return () => {
      forwardScrollMessageRef.current?.querySelectorAll('div[data-comptype]').forEach((item) => {
        item.removeEventListener('click', h);
      });
    };
  }, []);

  React.useEffect(() => {
    getTemplateSessionDetail({
      sessionId,
    })
      .then((info: { messageList: IMessage[] }) => {
        const cacheList = orderBy(info?.messageList || [], ['messageId'], ['desc']).map((item) => {
          const myMessage = fetchMessageHandler(item);

          return createMessage(myMessage);
        });
        cacheListRef.current = cacheList;
        startTask();
      })
      .finally(() => {
        setLoading(false);
      });

    return () => {
      setReplayed(true);
    };
  }, []);

  React.useEffect(() => {
    eventRef.current = addEvent();
    return () => {
      if (isFunction(eventRef.current)) {
        eventRef.current();
      }
    };
  }, [replayed]);

  return (
    <>
      <Spin spinning={loading} wrapperClassName={styles.spinWrapper}>
        <div className={classNames(styles.wrapper, 'full-width full-height ub ub-ver')} ref={layoutRef}>
          <div className="ub ub-ac" style={{ height: 48, padding: '8px 20px' }}>
            <div className="ub-f1 ub ub-ac gap8">
              <ChatAvatar session={mySessionInfo} size={32} />
              <div className="ub-f1 ellipsis">{sessionName}</div>
            </div>
            <Space size="small">
              {/* <span className={styles.btn} onClick={onToggleAchievements}>
                <AntdIcon type="icon-a-Folder-withdrawal-onetuichuwenjianjia1" />
              </span> */}
              {/* <Divider type="vertical" /> */}
              <Button onClick={onClose} icon={<CloseOutlined />} type="text" iconPosition="start" />
            </Space>
          </div>
          <div className="ub ub-ver ub-f1">
            <div className="ub-f1">
              <PreviewMessageRenderer
                sessionInfo={sessionInfo}
                list={list}
                forwardScrollMessageRef={forwardScrollMessageRef}
                layoutRef={layoutRef}
              />
            </div>
            <div style={{ height: 80, padding: '16px 20px' }} className="ub ub-ac ub-pc">
              <div
                className={classNames(styles.footer, 'ub ub-ac ub-pj', {
                  [styles.running]: !replayed,
                })}
              >
                {!replayed && <p style={{ fontWeight: '500' }}>{intl.formatMessage({ id: 'common.replaying' })}</p>}
                {replayed && <p style={{ fontWeight: '500' }}>{intl.formatMessage({ id: 'common.replayEnded' })}</p>}
                {!replayed && (
                  <Button
                    icon={<PauseOutlined />}
                    type="primary"
                    shape="round"
                    iconPosition="start"
                    onClick={() => {
                      stopTask();
                      setList([...cacheListRef.current]);
                    }}
                  >
                    {intl.formatMessage({ id: 'common.viewResult' })}
                  </Button>
                )}
                {replayed && (
                  <Button
                    icon={<AntdIcon type="icon-a-Replay-musiczhongxinbofang" />}
                    type="primary"
                    shape="round"
                    iconPosition="start"
                    onClick={() => {
                      setList([]);
                      startTask();
                    }}
                  >
                    {intl.formatMessage({ id: 'common.replayAgain' })}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </Spin>
      <Achievements.Trigger
        ref={achievementRef}
        key={sessionId}
        updateAt={0}
        sessionId={sessionId}
        EventEmitter={myEventEmitter}
      />
    </>
  );
};

export default ReplayTemplate;
