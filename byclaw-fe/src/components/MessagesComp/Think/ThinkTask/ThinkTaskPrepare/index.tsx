// tslint:disable:ordered-imports
import React, { useMemo, useState } from 'react';
import { get, chain } from 'lodash';
import { useIntl } from '@umijs/max';
import { DesktopOutlined } from '@ant-design/icons';

import TaskLoading from '@/components/MessagesComp/Think/ThinkTask/components/TaskLoading';
import TaskFinish from '@/components/MessagesComp/Think/ThinkTask/components/TaskFinish';
import CodeModal from './components/CodeModal';

import { SSEEventStatus, IMessageState } from '@/constants/message';

import parentStyle from '@/components/MessagesComp/Think/ThinkTask/index.module.less';

import type { IMessage, IMessageListItem } from '@/typescript/message';

type IProps = {
  messageListItemContent: { substance: any };
  thinkListItem: IMessageListItem;
  message: IMessage;
};

export default function ThinkTaskPrepare(props: IProps) {
  const { thinkListItem, messageListItemContent, message } = props;
  const { messageState, thinkDone } = message;

  const intl = useIntl();

  const [showCodeModal, setShowCodeModal] = useState(false);

  const substance = get(messageListItemContent, 'substance', '');
  const isThinkDone = thinkDone || ![IMessageState.Answer, IMessageState.Query].includes(messageState);
  const isDone = SSEEventStatus.done === thinkListItem?.status || isThinkDone;

  const headerBlock = useMemo(() => {
    return (
      <div className={parentStyle.header}>
        <DesktopOutlined className={parentStyle.icon} />
        <span className={parentStyle.title}>{intl.formatMessage({ id: 'thinkTaskPrepare.thinkTaskPrepare' })}</span>
      </div>
    );
  }, []);

  const codeData = useMemo(() => {
    // prettier-ignore
    return chain(substance)
      .trim()
      .trimStart('```py')
      .trim()
      .trimEnd('```')
      .trim()
      .value();
  }, [substance]);

  return (
    <>
      {!isDone && (
        <TaskLoading
          headerBlock={headerBlock}
          onClick={() => {
            setShowCodeModal(true);
          }}
        />
      )}
      {isDone && (
        <TaskFinish
          headerBlock={headerBlock}
          onClick={() => {
            setShowCodeModal(true);
          }}
        />
      )}
      <CodeModal visible={showCodeModal} codeData={codeData} onVisible={setShowCodeModal} />
    </>
  );
}
