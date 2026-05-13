import { useMemo, useState } from 'react';

import { DesktopOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { Modal } from 'antd';
import classnames from 'classnames';
import { get } from 'lodash';

import Markdown from '@/components/Markdown';
import TaskFinish from '@/components/MessagesComp/Think/ThinkTask/components/TaskFinish';
import TaskLoading from '@/components/MessagesComp/Think/ThinkTask/components/TaskLoading';

import { SSEEventStatus, IMessageState } from '@/constants/message';

import parentStyle from '@/components/MessagesComp/Think/ThinkTask/index.module.less';
import styles from './index.module.less';

import type { IMessage, IMessageListItem } from '@/typescript/message';

type IProps = {
  messageListItemContent: { substance: any };
  thinkListItem: IMessageListItem;
  message: IMessage;
};

export default function ThinkTaskResult(props: IProps) {
  const { thinkListItem, messageListItemContent, message } = props;
  const { messageState, thinkDone } = message;  

  const intl = useIntl();

  const [showModal, setShowModal] = useState(false);

  const substance = get(messageListItemContent, 'substance', '');
  const isThinkDone = thinkDone || ![IMessageState.Answer, IMessageState.Query].includes(messageState);
  const isDone = SSEEventStatus.done === thinkListItem?.status || isThinkDone;

  const headerBlock = useMemo(() => {
    return (
      <div className={parentStyle.header}>
        <DesktopOutlined className={parentStyle.icon} />
        <span className={parentStyle.title}>{intl.formatMessage({ id: 'thinkTaskResult.thinkTaskResult' })}</span>
      </div>
    );
  }, []);

  return (
    <>
      {!isDone && (
        <TaskLoading
          headerBlock={headerBlock}
          onClick={() => {
            setShowModal(true);
          }}
        />
      )}
      {isDone && (
        <TaskFinish
          headerBlock={headerBlock}
          onClick={() => {
            setShowModal(true);
          }}
        />
      )}
      <Modal
        className={classnames(styles.modal)}
        centered
        title={intl.formatMessage({ id: 'thinkTaskResult.thinkTaskResult' })}
        open={showModal}
        onCancel={() => setShowModal(false)}
        width="60%"
        styles={{
          body: {
            height: '524px',
            overflow: 'auto',
          },
        }}
        footer={null}
        destroyOnHidden
      >
        <Markdown text={substance} />
      </Modal>
    </>
  );
}
