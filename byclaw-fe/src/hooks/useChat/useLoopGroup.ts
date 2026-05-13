import React from 'react';
import { useDispatch } from '@umijs/max';
import { get, last, uniqBy, orderBy, isEmpty } from 'lodash';

import { fetchMessage } from '@/models/useMessageStore';

import type { IMessage } from '@/typescript/message';

type IProps = {
  getMessageList: () => IMessage[];
  setMessageList: React.Dispatch<React.SetStateAction<IMessage[]>>;
};

const LooperIntervalTime = 5000;

function useLoopGroup(props: IProps) {
  const { getMessageList, setMessageList } = props;

  const dispatch = useDispatch();
  const looper = React.useRef<NodeJS.Timeout>(undefined);

  const myFetchMessage = React.useCallback(
    (sessionId: string, fromMessageId?: string) => {
      if (!fromMessageId) return;

      fetchMessage({
        sessionId,
        fromMessageId,
        streamAppend: true,
      }).then((res) => {
        if (isEmpty(res.list)) return;

        const msgList = getMessageList();

        const newList = orderBy(uniqBy([...res.list, ...msgList], 'messageId'), ['messageId'], ['asc']);

        const cache = {
          ...res,
          list: newList,
        };

        dispatch({
          type: 'messageStore/setSessionMessage',
          payload: {
            sessionId,
            messageListInfo: cache,
          },
        });

        setMessageList([...newList]);
      });
    },
    [setMessageList]
  );

  const getFromMessage = React.useCallback(() => {
    return last(getMessageList());
  }, [getMessageList]);

  const startLooping = React.useCallback(
    (sessionId: string) => {
      looper.current = setInterval(() => {
        myFetchMessage(sessionId, get(getFromMessage(), 'messageId'));
      }, LooperIntervalTime);
    },
    [getFromMessage]
  );

  const stopLooping = React.useCallback(() => {
    clearInterval(looper.current);
  }, []);

  React.useEffect(() => {
    return () => {
      stopLooping();
    };
  }, []);

  return {
    startLooping,
    stopLooping,
  };
}

export default useLoopGroup;
