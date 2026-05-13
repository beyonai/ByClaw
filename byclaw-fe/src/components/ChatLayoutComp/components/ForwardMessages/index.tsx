import React from 'react';
import { head, set } from 'lodash';

import SessionSelect from '@/components/SessionSelect';

import { IMessageState, SSEEventStatus, SSEMessageType } from '@/constants/message';
import { addForwardMessage } from '@/service/session';
import { createMessage } from '@/utils/messgae';

import { dataItemTypeMap } from '@/components/PersonnelModel/const';
import useGlobal from '@/hooks/useGlobal';

function ForwardMessages({
  open,
  setOpen,
  multiChoicesMsgId,
  updateMessage,
}: {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  multiChoicesMsgId: string[];
  updateMessage: any;
}) {
  const { setAgentId, setSessionId } = useGlobal();

  return (
    <SessionSelect
      open={open}
      setOpen={setOpen}
      onOk={(selectList) => {
        const target = head(selectList);
        if (!target) {
          return Promise.resolve();
        }

        const payload = {
          chatContent: '',
          forwardMsgIds: multiChoicesMsgId, // 勾选消息id
          usage: 4,
        };

        if (target.type === dataItemTypeMap.session) {
          set(payload, 'sessionId', target.sessionId);
        }
        if (target.type === dataItemTypeMap.user) {
          set(payload, 'userId', target.userId);
        }

        return addForwardMessage(payload).then((res) => {
          if (res.sessionId) {
            setAgentId?.('');
            setSessionId?.(res.sessionId);

            setTimeout(() => {
              updateMessage(
                createMessage({
                  fromBeyond: false,
                  messageState: IMessageState.Done,
                  messageList: [
                    {
                      content: {
                        substance: null,
                      },
                      contentType: SSEMessageType.forward,
                      status: SSEEventStatus.done,
                    },
                  ],
                  messageId: res.messageId,
                  sessionId: res.sessionId,
                })
              );
            }, 500);
          }
          setOpen(false);
        });
      }}
    />
  );
}
export default ForwardMessages;
