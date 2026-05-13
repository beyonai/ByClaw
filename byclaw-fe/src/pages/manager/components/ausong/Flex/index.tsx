/* eslint-disable dot-notation */
import React from 'react';
import classnames from 'classnames';
import styles from './index.less';

function Flex(props: any) {
  const { children, attrs = [], className, width, height, style: divStyle, ...otherProps } = props;
  // 获取div class
  const classNames = [];
  if (attrs.includes('row')) {
    classNames.push(styles['flex_row']);
  }

  if (attrs.includes('column')) {
    classNames.push(styles['flex_column']);
  }

  if (attrs.includes('auto')) {
    classNames.push(styles['flex_auto']);
  }

  if (attrs.includes('none')) {
    classNames.push(styles['flex_none']);
  }

  const sizeStyle: React.CSSProperties = {};
  if (width) {
    if (Number.isNaN(width)) {
      sizeStyle.width = width;
    } else {
      sizeStyle.width = `${width}px`;
    }
  }

  if (height) {
    if (Number.isNaN(height)) {
      sizeStyle.height = height;
    } else {
      sizeStyle.height = `${height}px`;
    }
  }

  return (
    <div className={classnames(className, ...classNames)} style={{ ...sizeStyle, ...divStyle }} {...otherProps}>
      {children}
    </div>
  );
}

export default Flex;
