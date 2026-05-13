import React, { useEffect, useState } from 'react';
import { Empty, Popover } from 'antd';
import { useIntl } from '@umijs/max';
import taskIcon from '@/assets/svg/task.svg';

import { listTasksBySessionPage, ListTasksBySessionPageItem } from '@/service/workSpace';
import AntdIcon from '@/components/AntdIcon';
import { getTimeAgo } from '@/utils/date';
import styles from './ProjectTask.module.less';

interface ProjectTaskProps {
  onSelect?: (task: ListTasksBySessionPageItem) => void;
  updateAt?: number;
  sessionId: string | number;
}
interface ProjectTaskCardProps {
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  title: string;
  content: string;
  createTime: string;
  statusCdName: string;
  createByName: string;
}

interface iProjectTask {
  (props: ProjectTaskProps): React.JSX.Element;
  Card(props: ProjectTaskCardProps): React.JSX.Element;
}

const ProjectTask: iProjectTask = (props) => {
  const { sessionId, updateAt, onSelect } = props;
  const intl = useIntl();
  const [tasks, setTasks] = useState<ListTasksBySessionPageItem[]>([]);
  const [currentTask, setCurrentTask] = useState<ListTasksBySessionPageItem>();
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const onSelectTask = (task: ListTasksBySessionPageItem) => (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    setCurrentTask(task);
    setDropdownOpen(false);
  };

  useEffect(() => {
    listTasksBySessionPage({ sessionId, taskType: 'INPUT' }).then((res) => {
      setTasks(res?.list || []);
      setCurrentTask((v) => (!v ? res?.list[0] : { ...v }));
    });
  }, [sessionId, updateAt]);

  useEffect(() => {
    if (currentTask) {
      onSelect?.(currentTask);
    }
  }, [currentTask, onSelect]);

  const content = (
    <div className={styles.content}>
      {tasks.map((item, i) => (
        <ProjectTask.Card
          key={i}
          onClick={onSelectTask(item)}
          title={item.content}
          content={item.title}
          createTime={item.createTime}
          createByName={item.createByName}
          statusCdName={item.statusCdName}
        />
      ))}
      {!tasks.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ width: 294 }} />}
    </div>
  );

  return (
    <Popover
      arrow={false}
      trigger="click"
      content={content}
      open={dropdownOpen}
      placement="bottomLeft"
      onOpenChange={setDropdownOpen}
    >
      <div className={styles.projectTask}>
        <div className={styles.icon}>
          <img src={taskIcon} alt="task" />
        </div>
        <div className={styles.label}>
          {currentTask?.content || intl.formatMessage({ id: 'workSpace.projectTask.selectTask' })}
        </div>
        <div className={styles.extra}>
          <AntdIcon type={dropdownOpen ? 'icon-a-Downxia1' : 'icon-a-Upshang'} style={{ fontSize: 16 }} />
        </div>
      </div>
    </Popover>
  );
};

ProjectTask.Card = (props) => {
  const { onClick, title, content, createTime, createByName, statusCdName } = props;
  return (
    <div className={styles.projectTaskCard} onClick={onClick}>
      <div className={styles.head}>
        <div className={styles.ico}>
          <img src={taskIcon} alt="task" />
        </div>
        <div className={styles.txt}>{title}</div>
        <div className={styles.tag}>{statusCdName}</div>
      </div>
      <div className={styles.body}>{content}</div>
      <div className={styles.foot}>
        <div className={styles.user}>{!!createByName && `@${createByName}`}</div>
        <div className={styles.time}>{getTimeAgo(createTime)}</div>
      </div>
    </div>
  );
};

export default ProjectTask;
