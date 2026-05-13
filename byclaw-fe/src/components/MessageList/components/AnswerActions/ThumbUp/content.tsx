import React from 'react';
import { get, trim } from 'lodash';
import { Button, Input, message } from 'antd';
// @ts-ignore
import { useIntl } from '@umijs/max';
import useAppStore from '@/models/common/useAppStore';
import { updateMesFeedback } from '@/service/message';
import type { IMessage } from '@/typescript/message';

import classnames from 'classnames';

import styles from './index.module.less';
import useGlobal from '@/hooks/useGlobal';

type IProps = {
  updateMessage: (message: IMessage) => void;
  msg: IMessage;
};

const reducer = (state: any, action: any) => {
  switch (action.type) {
    case 'setFeedbackState':
      return {
        ...state,
        ...action.payload,
      };
    default:
      return state;
  }
};

export default function ThumbUpContent(props: IProps) {
  const { msg, updateMessage } = props;
  const { messageId } = msg;

  const intl = useIntl();
  const { EventEmitter } = useGlobal();
  const { feedbackType } = useAppStore();
  const FEEDBACK = get(feedbackType, 'FEEDBACK') || [];

  const [feedbackState, setFeedbackState] = React.useReducer(reducer, {
    feedbackValue: '',
    feedbackContent: '',
  });

  const [loading, setLoading] = React.useState(false);
  const [showFeedbackPanel, setShowFeedbackPanel] = React.useState(false);

  const onOpen = React.useCallback(
    (id: string) => {
      if (messageId !== id) return;
      setShowFeedbackPanel(true);
    },
    [messageId]
  );

  const onClose = React.useCallback(
    (id: string) => {
      if (messageId !== id) return;
      setShowFeedbackPanel(false);
    },
    [messageId]
  );

  const onSubmit = () => {
    const { feedbackValue, feedbackContent } = feedbackState;

    if (feedbackValue === 'FEED_OTHER' && !feedbackContent) {
      message.error(intl.formatMessage({ id: 'thumbUp.pleaseEnterReason' }));
      return;
    }

    setLoading(true);
    setShowFeedbackPanel(false);
    EventEmitter.emit('beyond-messageList-loading-feedback', messageId);

    updateMesFeedback({
      type: 'tread',
      messageId,
      feedbackLabel: feedbackState.feedbackValue,
      ...feedbackState,
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
        EventEmitter.emit('beyond-messageList-loading-feedback', messageId);
      });
  };

  React.useEffect(() => {
    EventEmitter.on('beyond-messageList-open-feedback', onOpen);
    EventEmitter.on('beyond-messageList-close-feedback', onClose);
    return () => {
      EventEmitter.off('beyond-messageList-open-feedback', onOpen);
      EventEmitter.off('beyond-messageList-close-feedback', onClose);
    };
  }, [messageId, onOpen, onClose]);

  return (
    <div
      className={classnames(styles.feedbackPanel, 'ub-ver gap8', {
        [styles.open]: showFeedbackPanel,
      })}
    >
      <p style={{ color: 'var(--beyond-color-text-secondary)', fontSize: '14px', marginBottom: '4px' }}>
        {intl.formatMessage({ id: 'thumbUp.pleaseTellUs' })}
      </p>
      <div className="ub ub-ac gap8">
        {FEEDBACK.map((item) => {
          const { paramName, paramValue } = item;
          return (
            <Button
              type={feedbackState.feedbackValue === paramValue ? 'primary' : 'default'}
              onClick={() => {
                setFeedbackState({ type: 'setFeedbackState', payload: { feedbackValue: paramValue } });
              }}
              key={paramValue}
            >
              {paramName}
            </Button>
          );
        })}
      </div>
      {feedbackState.feedbackValue === 'FEED_OTHER' && (
        <div className="full-width">
          <Input.TextArea
            placeholder={intl.formatMessage({ id: 'thumbUp.pleaseEnterReason' })}
            value={feedbackState.feedbackContent}
            onChange={(e) => {
              setFeedbackState({ type: 'setFeedbackState', payload: { feedbackContent: trim(e.target.value) } });
            }}
            className="full-width"
            rows={3}
            style={{ resize: 'none' }}
          />
        </div>
      )}
      <div className="full-width ub ub-pe gap8">
        <Button type="primary" onClick={onSubmit} loading={loading} disabled={!feedbackState.feedbackValue}>
          {intl.formatMessage({ id: 'common.submit' })}
        </Button>
      </div>
    </div>
  );
}
