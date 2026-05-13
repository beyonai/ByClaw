// tslint:disable:ordered-imports
import React, { useCallback } from 'react';
import { InfoCircleOutlined } from '@ant-design/icons';
// @ts-ignore
import { useSelector } from '@umijs/max';
import { Tooltip, Typography } from 'antd';
import classnames from 'classnames';

import DualBallLoading from '@/components/Loading/DualBallLoading';
import WaveBallLoading from '@/components/Loading/WaveBallLoading';
import MsgRenderer from './components/MsgRenderer';
import AntdIcon from '@/components/AntdIcon';

import useModal from '@/hooks/useModal';

import { getNoticeName, getDisplayDateTime } from './utils';

import { IMessageState } from '@/constants/message';

import type { IMessage } from '@/typescript/message';

import styles from './index.module.less';

const { Paragraph } = Typography;

export default function useRender({ updateMessage }: { updateMessage: (message: IMessage) => void }) {
  const { setOpen, setMyContent, setMyTitle } = useModal({});

  const { userInfo } = useSelector(({ user }) => ({ userInfo: user.userInfo }));
  const { userId } = userInfo || {};

  const renderMessage = useCallback(
    (msg: IMessage) => {
      const {
        fromBeyond,
        fromOtherUser,
        messageState,
        messageTip = '',
        traceback,
        msgId,
        createTime,
        usage,
        messageList,
      } = msg;
      const isLeftSide = fromBeyond || fromOtherUser;

      const { name: leftName, icon, theme } = getNoticeName(messageList?.map((i) => i.contentType));

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
          })}
        >
          {isLeftSide && (
            <div className={classnames(styles.beyondLogo, 'ub ub-pc')}>
              <div className={classnames('ub ub-ac ub-pc', styles.leftIcon)} style={{ background: theme }}>
                <AntdIcon type={icon} style={{ fontSize: '18px' }} />
              </div>
            </div>
          )}
          {isLeftSide && (
            <div className={styles.name}>
              {leftName}
              <span className={styles.createTime}>{displayCreateTime}</span>
            </div>
          )}
          <div className={styles.bubble}>
            <div
              className={classnames(styles.compRender, 'ub ub-ver gap8', {
                [styles.pureText]: fromOtherUser && usage !== '4',
              })}
            >
              <MsgRenderer msg={msg} updateMessage={updateMessage} />
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
        </div>
      );
    },
    [updateMessage, userId]
  );

  return {
    renderMessage,
  };
}
