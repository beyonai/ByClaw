import { useCallback, useState, useMemo, useEffect } from 'react';
import { debounce } from 'lodash';
import { Button, message, Spin } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
// @ts-ignore
import { useIntl } from '@umijs/max';

import AntdIcon from '@/components/AntdIcon';
import { updateMesFeedback } from '@/service/message';
import type { IMessage } from '@/typescript/message';

import btnStyles from '@/components/MessageList/index.module.less';
import styles from './index.module.less';
import classNames from 'classnames';
import useGlobal from '@/hooks/useGlobal';

function ThumbUp(porps: { updateMessage: (message: IMessage) => void; msg: IMessage }) {
  const intl = useIntl();
  const { EventEmitter } = useGlobal();

  const { updateMessage, msg } = porps;
  const { messageId, metadata, isHistoryMsg } = msg;

  const [loading, setLoading] = useState(false);

  const [showFeedbackPanel, setShowFeedbackPanel] = useState(!isHistoryMsg);
  const [showSuccessTips] = useState(false);

  const hasFeedback = useMemo(() => {
    if (!metadata) return '';

    if (metadata?.includes('praise')) {
      return 'praise';
    }
    if (metadata?.includes('tread')) {
      return 'tread';
    }
    return '';
  }, [metadata]);

  const handleLikeOrDislike = useCallback(
    debounce((type: string) => {
      setLoading(true);
      setShowFeedbackPanel(false);
      EventEmitter.emit('beyond-messageList-close-feedback', messageId);

      updateMesFeedback({
        type,
        messageId,
      })
        .then((res) => {
          if (!res?.data) return;
          updateMessage({ ...msg, metadata: res?.data });
          EventEmitter.emit('beyond-messageList-success-feedback', messageId);
        })
        .catch(() => {
          message.error(intl.formatMessage({ id: 'thumbUp.feedbackFailed' }));
        })
        .finally(() => {
          setLoading(false);
        });
    }, 300),
    [messageId, metadata, msg]
  );

  const handleSolvedClick = useCallback(() => {
    handleLikeOrDislike('praise');
  }, [handleLikeOrDislike]);

  const handleUnsolvedClick = useCallback(() => {
    EventEmitter.emit('beyond-messageList-open-feedback', messageId);
  }, [messageId]);

  const handleFeedbackClick = useCallback(() => {
    if (loading) return;
    setShowFeedbackPanel((prevState) => {
      return !prevState;
    });
  }, [loading]);

  useEffect(() => {
    if (!showFeedbackPanel) {
      EventEmitter.emit('beyond-messageList-close-feedback', messageId);
    }
  }, [showFeedbackPanel, messageId]);

  useEffect(() => {
    const onSuccessFeedback = () => {};

    const onLoading = (id: string) => {
      if (messageId !== id) return;
      setLoading((prev) => !prev);
      setShowFeedbackPanel(false);
    };

    EventEmitter.on('beyond-messageList-success-feedback', onSuccessFeedback);
    EventEmitter.on('beyond-messageList-loading-feedback', onLoading);

    return () => {
      EventEmitter.off('beyond-messageList-loading-feedback', onLoading);
    };
  }, [messageId, EventEmitter, isHistoryMsg]);

  const tipsRender = useMemo(() => {
    if (hasFeedback) {
      return (
        <div
          className="ub ub-ac pointer gap4"
          style={{ color: 'var(--beyond-color-text-tertiary)', fontSize: '12px', height: '28px' }}
          onClick={handleFeedbackClick}
        >
          {loading && <Spin size="small" />}
          {!loading && hasFeedback === 'praise' && (
            <AntdIcon
              type="icon-a-Thumbs-upzan-fill"
              className={btnStyles.actionsBarItem}
              style={{ fontSize: '16px', color: 'var(--beyond-color-primary)' }}
            />
          )}
          {!loading && hasFeedback === 'tread' && (
            <AntdIcon
              type="icon-a-Thumbs-downcai-fill"
              className={btnStyles.actionsBarItem}
              style={{ fontSize: '16px', color: 'var(--beyond-color-error)' }}
            />
          )}
          {hasFeedback === 'praise' && intl.formatMessage({ id: 'common.solved' })}
          {hasFeedback === 'tread' && intl.formatMessage({ id: 'common.unsolved' })}
        </div>
      );
    }

    return (
      <Button size="small" type="text" onClick={handleFeedbackClick} className={styles.feedbackButton1}>
        {loading && <Spin size="small" />}
        {!loading && <AntdIcon type="icon-a-Messagexinxi" />}
        {intl.formatMessage({ id: 'common.feedback' })}
      </Button>
    );
  }, [isHistoryMsg, loading, hasFeedback, handleFeedbackClick]);

  return (
    <div className={classNames(styles.wrapper)}>
      {showSuccessTips && (
        <span
          className={classNames(styles.successTips, {
            [styles.animate]: showSuccessTips,
          })}
        >
          {intl.formatMessage({ id: 'thumbUp.pointsAdded' })}
        </span>
      )}
      <div
        className={classNames('ub ub-as gap4', styles.thumbUp)}
        style={{
          alignSelf: 'flex-start',
          borderColor: showFeedbackPanel ? '#ced3d9' : 'transparent',
        }}
      >
        {tipsRender}
        <div
          className={classNames(styles.thumbUpContent, {
            [styles.slideIn]: showFeedbackPanel,
          })}
        >
          <div className="ub ub-ac gap4">
            <div className={classNames('ub gap4', styles.feedbackButton)}>
              {intl.formatMessage({ id: 'thumbUp.currentAnswerQuestion' })}
            </div>
            <div className="ub ub-ac ub-f1">
              <Button
                size="small"
                type="text"
                onClick={handleSolvedClick}
                className={styles.feedbackButton}
                icon={
                  <AntdIcon
                    type={metadata && metadata?.includes('praise') ? 'icon-a-Thumbs-upzan-fill' : 'icon-a-Thumbs-upzan'}
                    className={classNames(btnStyles.actionsBarItem, styles.feedbackButtonIcon)}
                  />
                }
              >
                {intl.formatMessage({ id: 'common.solved' })}
              </Button>
              <Button
                size="small"
                type="text"
                onClick={handleUnsolvedClick}
                className={styles.feedbackButton}
                icon={
                  <AntdIcon
                    type={
                      metadata && metadata?.includes('tread') ? 'icon-a-Thumbs-downcai-fill' : 'icon-a-Thumbs-downcai'
                    }
                    className={classNames(btnStyles.actionsBarItem, styles.feedbackButtonIcon)}
                  />
                }
              >
                {intl.formatMessage({ id: 'common.unsolved' })}
              </Button>
              <Button
                size="small"
                type="text"
                className={styles.feedbackButton}
                icon={<CloseOutlined />}
                onClick={handleFeedbackClick}
                style={{ marginLeft: '4px' }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ThumbUp;
