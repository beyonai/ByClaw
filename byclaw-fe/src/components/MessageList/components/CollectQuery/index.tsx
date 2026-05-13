import React from 'react';
import { Button } from 'antd';
import AntdIcon from '@/components/AntdIcon';
import classnames from 'classnames';
import { IMessage } from '@/typescript/message';

import styles from '@/components/MessageList/index.module.less';

function CollectQuery({ msg, updateMessage }: { msg: IMessage; updateMessage: (msg: IMessage) => void }) {
  const { queryCollectedState = 'uncollect' } = msg;

  const onSetCollect = React.useCallback(() => {
    updateMessage({ ...msg, queryCollectedState: 'changing' });
    setTimeout(() => {
      updateMessage({ ...msg, queryCollectedState: queryCollectedState === 'collected' ? 'uncollect' : 'collected' });
    }, 1000);
  }, [queryCollectedState, msg, updateMessage]);

  const myIcon = React.useMemo(() => {
    if (queryCollectedState === 'collected') {
      return (
        <AntdIcon type="icon-a-Starxingxing-1" style={{ fontSize: '16px', color: 'var(--beyond-color-primary)' }} />
      );
    }
    return <AntdIcon type="icon-a-Folder-focus-oneshoucangwenjianjia1" style={{ fontSize: '16px' }} />;
  }, [queryCollectedState]);

  return (
    <div className={classnames(styles.actionsBarItem)} role="presentation">
      <Button
        type="text"
        size="small"
        icon={myIcon}
        onClick={onSetCollect}
        loading={queryCollectedState === 'changing'}
      >
        {queryCollectedState === 'collected' && <span className={styles.actionsBarText}>已设置</span>}
        {queryCollectedState === 'uncollect' && <span className={styles.actionsBarText}>设为常用</span>}
        {queryCollectedState === 'changing' && <span className={styles.actionsBarText}>添加中</span>}
      </Button>
    </div>
  );
}

export default CollectQuery;
