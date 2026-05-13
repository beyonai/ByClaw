import React from 'react';
import classnames from 'classnames';
import { useIntl } from '@umijs/max';

import styles from './index.module.less';

type IMessageListItemContent = {
  substance: any;
};

export type IProps = {
  // message: IMessage;
  // updateMessageListItemContent: (messageListItemContent: IMessageListItemContent) => void;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  messageListItemContent: IMessageListItemContent;
};

function Approval(props: IProps) {
  const { messageListItemContent } = props;
  const intl = useIntl();

  const { substance } = messageListItemContent;

  return (
    <div className={classnames(styles.wrapper, 'mW600')}>
      <div className={classnames(styles.header, 'ub ub-ac')}>
        {intl.formatMessage({ id: 'notice.messageComp.approval.title' })}
      </div>
      <div className={classnames(styles.content, 'ub gap8 ub-ver')}>
        <p>{substance}</p>
      </div>
    </div>
  );
}
export default Approval;
