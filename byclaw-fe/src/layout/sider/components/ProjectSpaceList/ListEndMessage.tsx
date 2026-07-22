import React from 'react';
import { Divider } from 'antd';
import { useIntl } from '@umijs/max';

// 项目详情的需求、任务和成员列表统一使用数字员工侧栏的到底分割线样式。
const ListEndMessage: React.FC = () => {
  const intl = useIntl();

  return (
    <Divider plain>
      {intl.formatMessage({ id: 'projectSpace.list.endMessage' })}{' '}
      <span role="img" aria-label="emoji">
        🤐
      </span>
    </Divider>
  );
};

export default ListEndMessage;
