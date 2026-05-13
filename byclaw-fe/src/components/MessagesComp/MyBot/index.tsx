import { get, omit } from 'lodash';
import React from 'react';

import { useSelector } from '@umijs/max';

import useGlobal from '@/hooks/useGlobal';

import BotRenderer from './Renderer';

import type { IMessage } from '@/typescript/message';

import styles from './index.module.less';

type IMessageListItemContent = {
  substance: {
    data: any;
    id: string;
  };
  submitBtnInfo?: {
    submitBtnBId?: string;
  };
  stepId?: string;
  stepTaskId?: string;
};

type IProps = {
  messageListItemContent: IMessageListItemContent;
  message: IMessage;
  messageIdx: number;
};

function Bot(props: IProps) {
  const { messageListItemContent, message, messageIdx } = props;

  const { substance, submitBtnInfo, stepId, stepTaskId } = messageListItemContent || {};

  const { sessionId } = useGlobal();
  const extParamsBySessionId = useSelector(({ session }) => session.extParamsBySessionId);

  const page = React.useMemo(() => {
    return get(substance, 'data') || {};
  }, [substance]);

  const otherProps = React.useMemo(() => {
    return omit(substance, ['data']);
  }, [substance]);

  const taskId = React.useMemo(() => {
    return get(extParamsBySessionId, `${sessionId}.beyondTaskId`);
  }, [sessionId, extParamsBySessionId]);

  return (
    <div>
      {substance && (
        <div className={styles.botComp}>
          <BotRenderer
            botProps={{
              page,
              ...otherProps,
            }}
            taskId={taskId ? `${taskId}` : ''}
            stepId={stepId}
            stepTaskId={`${stepTaskId}`}
            message={message}
            messageIdx={messageIdx}
            submitBtnInfo={submitBtnInfo}
          />
        </div>
      )}
    </div>
  );
}

export default Bot;
