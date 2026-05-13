import { DownOutlined, UnorderedListOutlined, UpOutlined } from '@ant-design/icons';
import classnames from 'classnames';
import { get } from 'lodash';
import React, { useCallback, useRef } from 'react';

import { getNodesToHide, hideNodesBatch, showNodesBatch } from '@/utils/dom';

import styles from './index.module.less';

type IProps = {
  messageListItemContent: { substance: string };
};
export default function ThinkOldRootTitle(props: IProps) {
  const { messageListItemContent } = props;

  const text = get(messageListItemContent, 'substance', '');

  const thinkingTitleRef = useRef<HTMLDivElement>(null);

  const [isCollapse, setIsCollapse] = React.useState(false);

  const onCollapse = useCallback(() => {
    if (!thinkingTitleRef.current) return;

    const parent = thinkingTitleRef.current.parentElement;
    if (!parent) return;

    const nodesToHide = getNodesToHide(parent);
    hideNodesBatch(nodesToHide, 10); // 每帧处理10个
  }, [isCollapse]);

  const onShow = useCallback(() => {
    if (!thinkingTitleRef.current) return;

    const parent = thinkingTitleRef.current.parentElement;
    if (!parent) return;

    const nodesToHide = getNodesToHide(parent);
    showNodesBatch(nodesToHide, 10); // 每帧处理10个
  }, [isCollapse]);

  return (
    <div className={classnames(styles.thinkingTitle, 'ub')} ref={thinkingTitleRef}>
      <div className={classnames('ub ub-ac', styles.desc)}>
        <div className={classnames(styles.dot, 'ub ub-ac ub-pc')}>
          <UnorderedListOutlined style={{ color: '#fff', fontSize: '12px' }} />
        </div>
      </div>
      <div className={classnames(styles.titleText, 'ub-f1')}>{text}</div>
      {!isCollapse && (
        <UpOutlined
          className="pointer"
          style={{ padding: '12px 0' }}
          onClick={() => {
            onCollapse();
            setIsCollapse(true);
          }}
        />
      )}
      {isCollapse && (
        <DownOutlined
          className="pointer"
          style={{ padding: '12px 0' }}
          onClick={() => {
            onShow();
            setIsCollapse(false);
          }}
        />
      )}
    </div>
  );
}
