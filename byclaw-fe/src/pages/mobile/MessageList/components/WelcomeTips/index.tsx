import React, { useState } from 'react';
import classnames from 'classnames';
import { useSelector } from '@umijs/max';

import { RightOutlined, UndoOutlined } from '@ant-design/icons';

import { getRuntimeActualUrl, getPublicPath } from '@/utils';
import { getSystemConfigByStorage } from '@/utils/system';

import styles from './index.module.less';
import { useQuestions } from '@/pages/chat/components/BottomContent/useQuestions';
import useClickQuestion from '@/pages/chat/components/BottomContent/useClickQuestion';

export default function WelcomeTips() {
  const userInfo = useSelector(({ user }) => user.userInfo);
  const questionList = useQuestions(userInfo);
  const onClickQuestion = useClickQuestion();

  const [p, setP] = useState(0);

  const getAssistantIcon = React.useMemo(() => {
    const defaultIcon = `${getPublicPath()}beyond/assistant.png`;
    return getSystemConfigByStorage().assistant || defaultIcon;
  }, []);

  return (
    <div
      className={classnames(styles.wrapper, 'full-height full-width ub ub-ac ub-pc')}
      style={{ backgroundImage: `url(${getRuntimeActualUrl('beyond/mobile/welcomeBg.png')})` }}
    >
      <div
        className={styles.welcomeTips}
        style={{ backgroundImage: `url(${getRuntimeActualUrl('beyond/mobile/welcomeTop.png')})` }}
      >
        <div className={classnames(styles.title, 'ub ub-pc gap8 ub-ver')}>
          <p style={{ fontSize: '18px', fontWeight: 500 }} className="ellipsis">
            HI! {userInfo?.userName}
          </p>
          <p style={{ fontSize: '14px', color: '#40454D' }}>我是您的专属超级助手</p>
        </div>
        <div className={styles.assistant}>
          <img alt="assistant" src={getAssistantIcon} className="full-width full-height" />
        </div>
        <div className={classnames(styles.content, 'ub ub-ver gap12')}>
          <div className="ub ub-ac ub-pj" style={{ fontSize: '13px', color: '#40454D' }}>
            <p>你可以提问或者给我指派任务</p>
            <div
              className="ub ub-ac gap8"
              onClick={() => {
                setP((p) => {
                  if (p < Math.floor(questionList.length / 3)) {
                    return p + 1;
                  }
                  return 0;
                });
              }}
            >
              <UndoOutlined />
              换一换
            </div>
          </div>
          {questionList.slice(p * 3, (p + 1) * 3).map((item) => (
            <div className={styles.question} key={item.content} onClick={() => onClickQuestion(item)}>
              <p className="ub-f1 ellipsis">
                {item.icon && `${item.icon} `}
                {item.content}
              </p>
              <RightOutlined />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
