import React from 'react';
// @ts-ignore
import { useIntl } from '@umijs/max';
import classNames from 'classnames';
import styles from './index.module.less';
import AntdIcon from '@/components/AntdIcon';
import { Button } from 'antd';

type IQuestionItem = {
  icon?: string;
  title: React.ReactNode;
};

export function QuickQuestion({
  item,
  style,
  isFirstRow,
  showAction,
  className,
  onClick,
}: {
  style?: React.CSSProperties;
  showAction?: boolean;
  isFirstRow?: boolean;
  onClick?: () => void;
  item: IQuestionItem;
  className?: string;
}) {
  const intl = useIntl();
  return (
    <div style={style} className={classNames(styles.quickItem, className)} onClick={() => onClick?.()}>
      {item.icon && <span>{item.icon}</span>}
      <span className={classNames(styles.itemText, 'textEllipsis')}>{item.title}</span>
      {isFirstRow && (
        <div className={styles.down}>
          <AntdIcon type="icon-a-Downxia" />
        </div>
      )}
      {showAction && (
        <Button shape="round" variant="filled" size="small" className={styles.action}>
          {intl.formatMessage({ id: 'common.try' })}
        </Button>
      )}
    </div>
  );
}
