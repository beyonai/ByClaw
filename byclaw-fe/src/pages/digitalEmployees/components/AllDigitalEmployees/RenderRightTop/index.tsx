import { FC } from 'react';

import { Button, ButtonProps } from 'antd';
import classnames from 'classnames';
// @ts-ignore
import { useIntl } from '@umijs/max';

import { IAgentCache } from '@/typescript/agent';
import styles from './index.module.less';

interface IProps {
  employee: IAgentCache;
  size?: ButtonProps['size'];
}

const RenderRightTop: FC<IProps> = (props) => {
  const { employee } = props;
  const intl = useIntl();

  const { approveStatus = null } = employee || {};

  /* A已申请、S申请中、null未申请或申请没通过 */
  if (approveStatus !== 'S') {
    return null;
  }

  return (
    <Button
      className={classnames(styles.applyBtn, styles.isWarn)}
      size={props.hasOwnProperty('size') ? props.size : 'small'}
      color="default"
      variant="filled"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      {intl.formatMessage({ id: 'digitalEmployees.inApprover' })}
    </Button>
  );
};

export default RenderRightTop;
