import { getPublicPath } from '@/utils';
import { createFromIconfontCN } from '@ant-design/icons';
import { Popconfirm, Tooltip } from 'antd';
import type { PopconfirmProps } from 'antd/lib/popconfirm';
import type { TooltipProps } from 'antd/lib/tooltip';
import classNames from 'classnames';
import React from 'react';
import styles from './index.module.less';

export interface AntdIconProps {
  type: string;
  rotate?: number;
  spin?: boolean;
  twoToneColor?: string;
  style?: React.CSSProperties;
  className?: string;
  onClick?: (event: React.MouseEvent) => void;
  title?: string | any;
  toolTipProps?: TooltipProps;
  popconfirmprops?: PopconfirmProps;
}

// 使用构建时注入的文件名（开发环境为 iconfont.js，生产环境为 iconfont.[hash].js）
const iconfontFileName = typeof ICONFONT_FILE_NAME !== 'undefined' ? ICONFONT_FILE_NAME : 'iconfont.js';

const IconFont = createFromIconfontCN({
  scriptUrl: `${getPublicPath()}js/${iconfontFileName}`,
});

const AntdIcon = (props: AntdIconProps) => {
  const { title, toolTipProps, popconfirmprops, ...ret } = props;

  // eslint-disable-next-line no-nested-ternary
  return popconfirmprops ? (
    <Popconfirm {...popconfirmprops}>
      <Tooltip title={title} trigger={['hover', 'click', 'focus']} {...toolTipProps}>
        <IconFont {...ret} className={classNames(styles.i, props.className)} />
      </Tooltip>
    </Popconfirm>
  ) : title ? (
    <Tooltip title={title} trigger={['hover', 'click', 'focus']} {...toolTipProps}>
      <IconFont {...ret} className={classNames(styles.i, props.className)} />
    </Tooltip>
  ) : (
    <IconFont {...ret} className={classNames(styles.i, props.className)} />
  );
};

export default React.memo(AntdIcon);
