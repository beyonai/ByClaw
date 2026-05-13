import { getPublicPath } from '@/utils';
import { Empty as AntdEmpty } from 'antd';
import { EmptyProps } from 'antd/lib/empty';
import React, { FC } from 'react';
import styles from './index.module.less';

const Empty = (props: EmptyProps) => {
  return <AntdEmpty image={`${getPublicPath()}svg/Empty.svg`} className={styles.emptyBox} {...props} />;
};

export const EmptyWrap: FC<
  EmptyProps & {
    isEmpty: boolean;
    children: React.ReactNode;
  }
> = ({ isEmpty, children, ...props }) => {
  return isEmpty ? <Empty {...props} /> : <>{children}</>;
};

export default Empty;
