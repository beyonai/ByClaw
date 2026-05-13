import React, { useState, useEffect } from 'react';
// @ts-ignore
import { useSelector, useIntl, useSearchParams } from '@umijs/max';
import classNames from 'classnames';
import { Layout, Button, Divider, Spin } from 'antd';
import { noop, head, last } from 'lodash';
import { DownOutlined } from '@ant-design/icons';

import InfiniteScroll from '@/components/InfiniteScroll';
import useToBottomBtn from '@/components/MessageList/hooks/useToBottomBtn';
import AntdProvider from '@/layout/components/provider/antd';
import GlobalContext, { Platform } from '@/layout/components/provider/global';
import useRender from '@/components/MessageList/useRender';
import useMobileRender from '@/pages/mobile/MessageList/useRender';
import DividerTips from '@/components/MessageList/components/DividerTips';
import SystemTips from '@/components/MessageList/components/SystemTips';
import AbsoluteDrawer from '@/components/AbsoluteDrawer';
import FullScreenModal from '@/components/FullScreenModal';
import MainDrawer from '@/components/MainDrawer';
import MinorDrawer from '@/components/MinorDrawer';
import { LayoutMode } from '@/constants/system';
import { createMessage, fetchMessageHandler } from '@/utils/messgae';
import usePlatform from '@/hooks/usePlatform';
import { IPlatform } from '@/typescript/platform';
import Empty from '@/components/Empty';

import antdMobileTheme from '@/styles/antdMobileTheme';
import antdDefaultTheme from '@/styles/antdDefaultTheme';

import { GET } from '@/service/common/request';

import { generateUniqueId } from '@/utils/math';
import { EventEmitter$Cls } from '@/utils/eventEmitter';
import type { IMessage } from '@/typescript/message';

import styles from './index.module.less';
import messageListStyles from '@/components/MessageList/index.module.less';

const { Content } = Layout;
const myEventEmitter = new EventEmitter$Cls();
const Preview = () => {
  const intl = useIntl();
  // 获取URL中的ID参数
  const [searchParams] = useSearchParams();
  const code = searchParams.get('code');

  const [platform] = usePlatform();

  const [list, setList] = useState<IMessage[]>([]);
  const [title, setTitle] = useState<string>('');
  const [createTime, setCreateTime] = useState<string>('');
  const [agentId, setAgentId] = React.useState<string>('');
  const [loading, setLoading] = React.useState<boolean>(false);
  const [hasLimit, setHasLimit] = React.useState<string>('');

  const scrollMessageDomId = React.useRef<string>(`scrollMessage_${generateUniqueId()}`);

  const forwardScrollMessageRef = React.useRef<HTMLDivElement>(null);
  const layoutRef = React.useRef<HTMLDivElement>(null);
  const infiniteScrollRef = React.useRef<InfiniteScroll>(null);

  const isPC = platform === IPlatform.pc;

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

  const { renderMessage: renderMessageMobile, extendsRender: extendsRenderMobile } = useMobileRender({
    updateMessage: noop,
    deleteMessage: noop,
  });

  const { renderMessage: renderMessagePC, extendsRender: extendsRenderPC } = useRender({
    updateMessage: noop,
    deleteMessage: noop,
  });

  const renderMessage = React.useMemo(() => {
    return isPC ? renderMessagePC : renderMessageMobile;
  }, [isPC, renderMessagePC, renderMessageMobile]);

  const extendsRender = React.useMemo(() => {
    return isPC ? extendsRenderPC : extendsRenderMobile;
  }, [isPC, extendsRenderPC, extendsRenderMobile]);

  const toBottom = React.useCallback(() => {
    infiniteScrollRef.current?.scrollToBottom();
    setToBottomBtnVisable(false);
  }, []);

  const theme = React.useMemo(() => {
    return isPC ? antdDefaultTheme : antdMobileTheme;
  }, [isPC]);

  useEffect(() => {
    // 从URL中获取的ID: id = "YjFmOTVkZTEtYjZkNi00YzQ5LTk4ZDItNDAyMjQzMTcyNDg3"
    // 可以根据需要使用这个ID，例如作为sessionId或其他用途
    console.log('Preview ID:', code);
    if (!code) return;

    setLoading(true);

    GET<{ messages: IMessage[]; title: string; createdTime: string }>(
      '/byaiService/chat/message/share-link/access',
      {
        token: code,
      },
      {
        responseCfg: {
          hideErrorTips: true,
        },
      }
    )
      .then((res) => {
        console.log(res);
        const { messages, title, createdTime } = res;
        const cacheList = (messages || []).map((item) => {
          const myMessage = fetchMessageHandler(item);

          return createMessage(myMessage);
        });

        setTitle(title);
        setCreateTime(createdTime);
        setList(cacheList);
      })
      .catch((err) => {
        setHasLimit(err || 'preview.expiredOrExceeded');
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  return (
    <AntdProvider theme={theme}>
      <GlobalContext.Provider
        value={{
          platform: Platform.pc,
          sessionId: '',
          setSessionId: noop,
          agentId,
          agentInfo: curAgentInfo,
          setAgentId,
          EventEmitter: myEventEmitter,
          layoutMode: LayoutMode.preview,
        }}
      >
        <Layout
          className="full-width full-height"
          style={
            {
              '--user-fill-color': '#F2F6FA',
              '--layout-gap': '8px',
            } as React.CSSProperties
          }
        >
          <Layout
            id="preview-session-layout"
            className={classNames('ub full-width full-height', messageListStyles.layout)}
            style={{ position: 'relative', flexDirection: 'row', background: 'linear-gradient(#e8edff, #f7f9fc)' }}
          >
            <MinorDrawer />
            <div className={classNames('ub ub-ver gap8', styles.messageListWrapper)}>
              <div className={classNames('ub ub-ver ub-f1', styles.content)}>
                <Spin spinning={loading} wrapperClassName={styles.spinningWrapper}>
                  {!hasLimit && (
                    <>
                      <div className={classNames('mW900 full-width', styles.header)}>
                        <h1 style={{ marginBottom: '0' }}>{title}</h1>
                        <p style={{ color: 'var(--beyond-color-text-quaternary)' }}>{createTime}</p>
                        <Divider style={{ margin: '.8rem 0 0' }} />
                      </div>
                      <div className={classNames('ub-f1 overflow-auto hideThumb')}>
                        <Content className={classNames('full-height', messageListStyles.content)}>
                          <div className="full-height full-width" style={{ position: 'relative' }}>
                            <div
                              className={classNames(
                                messageListStyles.messageContent,
                                'full-height full-width hideThumb'
                              )}
                              id={scrollMessageDomId.current}
                              ref={forwardScrollMessageRef}
                              // style={{ pointerEvents: replayed ? 'auto' : 'none' }}
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
                                            hideThinking: true,
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
                    </>
                  )}
                  {hasLimit && (
                    <div className="full-width full-height ub ub-ac ub-pc">
                      <Empty description={intl.formatMessage({ id: hasLimit, defaultMessage: hasLimit })} />
                    </div>
                  )}
                </Spin>
              </div>
              <p className="ub ub-ac ub-pc" style={{ color: 'var(--beyond-color-text-quaternary)' }}>
                {intl.formatMessage({ id: 'preview.slogan' })}
              </p>
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

export default Preview;
