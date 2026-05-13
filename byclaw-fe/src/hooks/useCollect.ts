import React, { useCallback } from 'react';
import { get, cloneDeep, set, pull } from 'lodash';
import { collectCase, cancelCollectCase } from '@/service/message';

import useGlobal from '@/hooks/useGlobal';
import { IMessage } from '@/typescript/message';

function useCollect(props: {
  sessionId: string;
  messageId?: string;
  collectKey: string;
  type: string;
  message?: IMessage;
}) {
  const { sessionId, messageId, collectKey, type, message } = props;

  const { EventEmitter } = useGlobal();

  const [collectLoading, setCollectLoading] = React.useState(false);

  const cancelCollect = useCallback(() => {
    setCollectLoading(true);
    return cancelCollectCase({
      sessionId, // Long，必填，会话ID
      messageId, // Long，可选，当前消息ID
      type, // String，必填，类型（ppt/text/chat等）, record纪要
      fileCode: collectKey,
    })
      .then(() => {
        if (message) {
          const myMessage = cloneDeep(message);

          const myCollectIds = get(myMessage, 'collectIds') || [];
          pull(myCollectIds, collectKey);
          set(myMessage, 'collectIds', myCollectIds);

          EventEmitter.emit('beyond-update-message', {
            message: myMessage,
            opt: {
              isAssign: true,
            },
          });
        }
      })
      .finally(() => {
        setCollectLoading(false);
      });
  }, [sessionId, message, collectKey, messageId]);

  const collect = useCallback(
    ({ name, content, agentId }: { content: string; name: string; agentId?: string }) => {
      setCollectLoading(true);
      return collectCase({
        sessionId, // Long，必填，会话ID
        type, // String，必填，类型（ppt/text/chat等）, record纪要
        content,
        name, // String，必填，名称，最大256字符
        messageId, // Long，可选，当前消息ID
        agentId,
      })
        .then(() => {
          if (message) {
            const myMessage = cloneDeep(message);

            const myCollectIds = get(myMessage, 'collectIds') || [];
            myCollectIds.push(collectKey);
            set(myMessage, 'collectIds', myCollectIds);

            EventEmitter.emit('beyond-update-message', {
              message: myMessage,
              opt: {
                isAssign: true,
              },
            });
          }
        })
        .finally(() => {
          setCollectLoading(false);
        });
    },
    [sessionId, message, messageId, type]
  );

  return { collect, cancelCollect, collectLoading };
}

export default useCollect;
