import React, { useContext, useEffect, useState } from 'react';
import { useIntl } from '@umijs/max';
import taskIcon from '@/assets/svg/message.svg';
import { InputFilter } from './InputFilter';
import styles from './todo.view.module.less';
import { AchievementContext } from './AchievementContext';
import { getTodoListByTask } from '@/service/workSpace';
import { getTimeAgo } from '@/utils/date';
import { Empty, Spin } from 'antd';

type CardProps = {
  title: string;
  time: string;
  status: string;
  content: string;
  createByName: string;
  handleByName: string;
};

const Card = ({ title, content, time, status, createByName, handleByName }: CardProps) => {
  const intl = useIntl();
  return (
    <div className={styles.Card}>
      <div className={styles.head}>
        <div className={styles.ico}>
          <img src={taskIcon} alt="task" />
        </div>
        <div className={styles.txt}>{title}</div>
        <div className={styles.tag}>{status}</div>
      </div>
      <div className={styles.body}>{content}</div>
      <div className={styles.row}>
        <div className={styles.it}>
          <span>{intl.formatMessage({ id: 'common.initiator' })}：</span>
          <span>{createByName}</span>
        </div>
        <div className={styles.it}>
          <span>{intl.formatMessage({ id: 'common.handler' })}：</span>
          <span>{handleByName}</span>
        </div>
      </div>
      <div className={styles.foot}>
        <div className={styles.time}>{time}</div>
        <div className={styles.icon}>
          <span className={styles.ico} />
        </div>
      </div>
    </div>
  );
};

export default function TodoView() {
  const context = useContext(AchievementContext);
  const [sessionId] = context.useValue('sessionId');
  const [list, setList] = useState<CardProps[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [task] = context.useValue('task');

  console.log('task', task);

  useEffect(() => {
    if (sessionId) {
      setLoading(true);
      getTodoListByTask({ pTaskId: task?.taskId || 10053509 }).then((res) => {
        setLoading(false);
        if (!res || !res.length) return;
        const temp = res.map((it: any) => ({
          ...it,
          title: it.title,
          content: it.content,
          time: it.createTime ? getTimeAgo(it.createTime) : '',
          status: it.statusCdName,
          createByName: it.createByName,
          handleByName: it.reciObjName,
        }));

        setList(temp);
      });
    }
  }, [sessionId]);

  return (
    <section className={styles.TodoView}>
      <div className={styles.todoViewHeader}>
        <InputFilter />
      </div>
      <div className={styles.todoViewBody}>
        <Spin spinning={loading} style={{ minHeight: 100 }}>
          {!list.length && <Empty />}
          <div className={styles.list}>
            {list.map((it, i) => (
              <Card key={i} {...it} />
            ))}
          </div>
        </Spin>
      </div>
    </section>
  );
}
