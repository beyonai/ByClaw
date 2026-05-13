import { FilterOutlined } from '@ant-design/icons';
import { Input } from 'antd';
import { useIntl } from '@umijs/max';
import React from 'react';
import styles from './index.module.less';

const { Search } = Input;

const TaskPage = () => {
  const intl = useIntl();
  const [tasks] = React.useState<
    {
      id: number;
      title: string;
      desc: string;
      status: string;
      statusText: string;
      statusColor: string;
      borderColor: string;
    }[]
  >([]);
  const [search] = React.useState('');

  // 搜索过滤
  const filteredTasks = tasks.filter((task) => task.title.includes(search) || task.desc.includes(search));

  return (
    <div className={styles.taskPage}>
      {/* 搜索栏和筛选 */}
      <div className={styles.taskHeader}>
        <Search
          className={styles.searchInput}
          placeholder={intl.formatMessage({ id: 'common.inputKeyword' })}
          allowClear
        />
        <FilterOutlined className={styles.filter} />
      </div>
      {/* 标题 */}
      <div className={styles.taskTitle}>
        <span className={styles.taskTitleText}>{intl.formatMessage({ id: 'common.allTasks' })}</span>
      </div>
      {/* 任务列表 */}
      <div className={styles.taskList}>
        {filteredTasks.map((task) => (
          <div className={styles.taskCard} key={task.id}>
            <div className={styles.cardHeader}>
              <span className={styles.cardIcon}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="3" y="4" width="14" height="12" rx="2" fill="#E9F3FF" />
                  <rect x="6" y="2" width="8" height="4" rx="1" fill="#1890FF" />
                </svg>
              </span>
              <span className={styles.cardTitle}>{task.title}</span>
              <span
                className={styles.cardStatus}
                style={{
                  color: task.statusColor,
                  borderColor: task.borderColor,
                  background: task.status === 'done' ? '#E8FFEA' : '#E8F3FF',
                }}
              >
                {task.statusText}
              </span>
            </div>
            <div className={styles.cardDesc}>{task.desc}</div>
            <div className={styles.cardFooter}>{task.time}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TaskPage;
