import React, { useState } from 'react';
import AntdIcon from '@/components/AntdIcon';
import FeedbackModal from './FeedbackModal';
import styles from './styles.module.less';
import classNames from 'classnames';

interface FeedbackProps {
  userId: string;
  className?: string;
  style?: React.CSSProperties;
}

export default function Feedback(props: FeedbackProps) {
  const { userId, className, style } = props;
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);

  return (
    <>
      <div className={classNames(styles.feedbackIcon, className)} style={style}>
        <AntdIcon type="icon-a-Edit-onebianji1" onClick={() => setShowFeedbackModal(true)} />
      </div>
      <FeedbackModal userId={userId} open={showFeedbackModal} onCancel={() => setShowFeedbackModal(false)} />
    </>
  );
}
