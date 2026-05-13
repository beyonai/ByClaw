// tslint:disable:ordered-imports
import React, { useMemo, useState } from 'react';
import { get } from 'lodash';
import classnames from 'classnames';
import { DesktopOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import { Modal } from 'antd';

import TaskLoading from '@/components/MessagesComp/Think/ThinkTask/components/TaskLoading';
import TaskFinish from '@/components/MessagesComp/Think/ThinkTask/components/TaskFinish';
import Markdown from '@/components/Markdown';

import { SSEEventStatus, IMessageState } from '@/constants/message';

import styles from './index.module.less';
import parentStyle from '@/components/MessagesComp/Think/ThinkTask/index.module.less';

import type { IMessageListItem, IMessage } from '@/typescript/message';

type IProps = {
  messageListItemContent: { substance: any };
  thinkListItem: IMessageListItem;
  message: IMessage;
};

export default function ThinkTaskExecute(props: IProps) {
  const { thinkListItem, messageListItemContent, message } = props;
  const { messageState, thinkDone } = message;

  const intl = useIntl();

  const [showModal, setShowModal] = useState(false);

  const substance = get(messageListItemContent, 'substance', '');
  const isThinkDone = thinkDone || ![IMessageState.Answer, IMessageState.Query].includes(messageState);
  const isDone = SSEEventStatus.done === thinkListItem?.status || isThinkDone;

  const detailText = useMemo(() => {
    if (typeof substance === 'string') {
      return substance;
    }
    if (substance && typeof substance === 'object') {
      return JSON.stringify(substance, null, 2);
    }
    return substance;
  }, [substance]);

  const headerBlock = useMemo(() => {
    return (
      <div className={parentStyle.header}>
        <DesktopOutlined className={parentStyle.icon} />
        <span className={parentStyle.title}>{intl.formatMessage({ id: 'thinkTaskExecute.thinkTaskExecute' })}</span>
      </div>
    );
  }, [intl]);

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
        title={intl.formatMessage({ id: 'common.taskExecute' })}
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
        <Markdown defaultExpandJson text={detailText} />
      </Modal>
    </>
  );
}
