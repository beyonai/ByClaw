/**
 * 卡片标题组件
 * 负责渲染卡片标题区域
 */
import React from 'react';
import { Typography } from 'antd';
import classnames from 'classnames';
import type { ICardTitle } from './types';
import styles from './index.module.less';

const { Text } = Typography;

interface CardTitleProps {
  title?: ICardTitle;
}

const CardTitle: React.FC<CardTitleProps> = ({ title }) => {
  if (!title) {
    return null;
  }

  let titleConfig;
  if (typeof title === 'string') {
    titleConfig = {
      mainTitle: title,
    };
  } else {
    titleConfig = title;
  }
  const { mainTitle, subTitle, style } = titleConfig;

  return (
    <div className={classnames(styles.cardTitle)} style={style}>
      <div className={styles.titleMain} style={typeof mainTitle === 'string' ? undefined : mainTitle.style}>
        {typeof mainTitle === 'string' ? mainTitle : mainTitle.text}
      </div>
      {subTitle && (
        <Text
          type="secondary"
          className={styles.titleSubtitle}
          style={typeof subTitle === 'string' ? undefined : subTitle.style}
        >
          {typeof subTitle === 'string' ? subTitle : subTitle.text}
        </Text>
      )}
    </div>
  );
};

export default CardTitle;
