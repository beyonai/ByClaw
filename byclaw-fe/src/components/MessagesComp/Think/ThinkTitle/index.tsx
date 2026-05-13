// tslint:disable:ordered-imports
import React, { useMemo } from 'react';
import { get } from 'lodash';
import classnames from 'classnames';
import { RadarChartOutlined } from '@ant-design/icons';
// @ts-ignore
import { getIntl } from '@umijs/max';
import MyIcon from '@/components/AntdIcon';
import Markdown from '@/components/Markdown';

import styles from './index.module.less';

type IProps = {
  // eslint-disable-next-line react/no-unused-prop-types
  messageListItemContent: { substance: string };
};

const getIconMap = () => {
  const intl = getIntl();
  return {
    [intl.formatMessage({ id: 'thinkTitle.taskPlan' })]: 'icon-a-View-listxiangqingliebiao',
    [intl.formatMessage({ id: 'thinkTitle.companyData' })]: 'icon-a-Book-oneshuji11',
    [intl.formatMessage({ id: 'thinkTitle.networkSearch' })]: 'icon-a-Sphereyuanqiu1',
    [intl.formatMessage({ id: 'thinkTitle.optimizeData' })]: 'icon-a-Six-pointsliugedian1',
    [intl.formatMessage({ id: 'thinkTitle.digitalEmployee' })]: 'icon-a-Six-pointsliugedian1',
    [intl.formatMessage({ id: 'thinkTitle.taskEnd' })]: 'icon-a-Powerkaiguan',
  };
};

export const IconRender = ({ text }: { text: string }) => {
  const IconType = useMemo(() => {
    const iconMap = getIconMap();
    const keyName = Object.keys(iconMap).find((key) => {
      return text?.startsWith?.(key);
    });

    if (keyName) {
      return <MyIcon type={iconMap[keyName]} style={{ fontSize: '18px', marginRight: '6px' }} />;
    }

    return <RadarChartOutlined style={{ fontSize: '18px', marginRight: '6px' }} />;
  }, [text]);

  return IconType;
};

export default function ThinkTitle(props: IProps) {
  const text = get(props, 'messageListItemContent.substance', '');

  return (
    <div className={classnames(styles.thinkingTitle, 'ub ub-ac')}>
      <IconRender text={text} />
      <div className={styles.titleText}>
        <Markdown text={text} />
      </div>
    </div>
  );
}
