import { CheckOutlined, CloseOutlined, LoadingOutlined } from '@ant-design/icons';
import classnames from 'classnames';
import React from 'react';
import { theme } from 'antd';
import MyIcon from '@/components/AntdIcon';

import styles from './index.module.less';
import type { TreeNode } from '@/components/MessageList/components/ThinkingProcessRender/typescript';

export type IMessageListItemContent = {
  substance: {
    title?: string;
    status: '_START_' | '_DONE_' | '_ERROR_';
  };
};

export type IProps = {
  messageListItemContent: IMessageListItemContent;
  thinkListItem: TreeNode;
};

function ThinkStatusTitleV2(props: { status?: string; text: string }) {
  const { status } = props;
  const {
    token: { colorSuccess, colorError },
  } = theme.useToken();
  const isLoading = status !== '_DONE_' && status !== '_ERROR_';

  return (
    <div className={classnames(styles.thinkingTitleV2, 'ub ub-ac')}>
      <MyIcon type="icon-a-Toolgongju" style={{ fontSize: '18px', marginRight: '6px' }} />
      <div className={styles.titleTextV2}>
        <span style={{ marginRight: 10 }}>{props.text}</span>
        {isLoading && <LoadingOutlined />}
        {status === '_DONE_' && <CheckOutlined style={{ color: colorSuccess }} />}
        {status === '_ERROR_' && <CloseOutlined style={{ color: colorError }} />}
      </div>
    </div>
  );
}

function ThinkStatusTitle(props: IProps) {
  const { messageListItemContent } = props;

  const { substance } = messageListItemContent;
  let status = '';
  let title;
  if (typeof substance === 'string') {
    title = substance;
    status = '_DONE_';
  } else if (substance && typeof substance === 'object') {
    ({ title, status } = substance);
  }

  return <ThinkStatusTitleV2 status={status} text={title || ''} />;
}

export default ThinkStatusTitle;
