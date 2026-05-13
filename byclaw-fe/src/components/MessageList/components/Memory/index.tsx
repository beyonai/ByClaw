import React, { useEffect, useState } from 'react';
import { Button } from 'antd';
import { get } from 'lodash';
import AntdIcon from '@/components/AntdIcon';
import classnames from 'classnames';
import useGlobal from '@/hooks/useGlobal';
import ChatLayoutCompContext from '@/components/ChatLayoutComp/hooks/useContext';
import { useIntl } from '@umijs/max';

import { checkQueryMessageCanMemory, checkAnswerMessageCanMemory } from '@/utils/messgae';

import { IMessage } from '@/typescript/message';

import styles from '@/components/MessageList/index.module.less';

function Memory({ msg }: { msg: IMessage }) {
  const { msgId } = msg;

  const intl = useIntl();

  const [canShowMemory, setCanShowMemory] = useState(false);

  const { EventEmitter } = useGlobal();
  const { getMessageList } = React.useContext(ChatLayoutCompContext);

  useEffect(() => {
    requestIdleCallback(() => {
      const messageList = getMessageList?.() || [];
      const targetMessageIdx = messageList.findIndex((item) => item.msgId === msgId);
      if (targetMessageIdx < 0) return;

      const queryMessage = get(messageList, targetMessageIdx - 1);
      const answerMessage = get(messageList, targetMessageIdx);

      setCanShowMemory(checkQueryMessageCanMemory(queryMessage) || checkAnswerMessageCanMemory(answerMessage));
    });
  }, [getMessageList]);

  if (!canShowMemory) {
    return null;
  }

  return (
    <div className={classnames(styles.actionsBarItem)} role="presentation">
      <Button
        type="text"
        size="small"
        icon={<AntdIcon type="icon-a-Braindanao" className={styles.icon} />}
        onClick={() => {
          EventEmitter.emit('beyond-messageList-set-multichoices-msgid', [msgId]);
          EventEmitter.emit('beyond-messageList-open-multichoices', ['memory']);
        }}
      >
        <span className={styles.actionsBarText}>{intl.formatMessage({ id: 'memory.enhanceMemory' })}</span>
      </Button>
    </div>
  );
}

export default Memory;
