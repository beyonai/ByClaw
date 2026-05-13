import React, { useCallback, useRef } from 'react';
import { isString, size, omit } from 'lodash';

import BotComp from './components/BotComp';

import { getRandomNumber } from '@/utils/math';
import { theme as themes } from '@/models/task';
import { getControlBtns, getDetailBtn } from '@/components/MessagesComp/MyBot/Renderer/util';

import useGlobal from '@/hooks/useGlobal';

import type { IMessage } from '@/typescript/message';
import type { ITask } from '@/typescript/task';

type IMessageListItemContent = {
  substance: ITask;
};

export type IProps = {
  message: IMessage;
  updateMessageListItemContent: (messageListItemContent: IMessageListItemContent) => void;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  messageListItemContent: IMessageListItemContent;
};

function Todo(props: IProps) {
  const { messageListItemContent, message, updateMessageListItemContent } = props;
  const { substance } = messageListItemContent || {};

  const globalContext = useGlobal();
  const { EventEmitter } = globalContext;

  const themeRef = useRef(themes[getRandomNumber(0, size(themes) - 1)]);

  const todoItem = React.useMemo<ITask>((): ITask => {
    let resPageObj: any = {};

    if (isString(substance.resPage)) {
      try {
        resPageObj = JSON.parse(substance.resPage);
      } catch (e) {
        console.error(e);
      }
    }

    return {
      ...substance,
      resPageObj,
    };
  }, [substance]);

  const { pageId, resPageObj, loadSsoIframeUrl, taskId, statusCd } = todoItem || {};
  const { disabledBIds = [] } = resPageObj || {};
  const isCompleted = statusCd === 'Completed';

  const getTodoItem = useCallback(() => todoItem, [todoItem]);

  const getMyControlBtns = useCallback(() => {
    const btnList = [];

    if (substance?.resourceBizType) {
      btnList.push(getDetailBtn());
    }

    btnList.push(...getControlBtns().map((item) => ({ ...item, isDisabled: isCompleted })));

    return btnList;
  }, [isCompleted, substance?.resourceBizType]);

  React.useEffect(() => {
    const onUpdateTask = (param: any) => {
      if (`${taskId}` !== `${param.taskId}`) return;

      updateMessageListItemContent({
        substance: {
          ...substance,
          ...(param?.targetTask || {}),
          statusCd: param?.statusCd || substance?.statusCd,
        },
      });
    };

    EventEmitter.on('beyond-update-task', onUpdateTask);

    return () => {
      EventEmitter.off('beyond-update-task', onUpdateTask);
    };
  }, [updateMessageListItemContent, substance, taskId]);

  return (
    <div className="mW600" style={{ minHeight: '200px' }}>
      <BotComp
        key={taskId}
        theme={themeRef.current}
        botProps={{
          pageId,
          parameters: {
            ...resPageObj,
            flow: {
              ...(resPageObj?.flow || {}),
              FLOW_STATUS: isCompleted ? '00A' : '00X',
            },
            substance: omit(substance, ['resPage']),
          },
          myControlBtns: getMyControlBtns(),
          disabledBIds,
        }}
        taskId={`${taskId}`}
        loadSsoIframeUrl={loadSsoIframeUrl}
        message={message}
        getTodoItem={getTodoItem}
      />
    </div>
  );
}

export default Todo;
