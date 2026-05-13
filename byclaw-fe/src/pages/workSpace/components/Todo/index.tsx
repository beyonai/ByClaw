import AntdIcon from '@/components/AntdIcon';
import { useIntl } from '@umijs/max';
import React, { useState } from 'react';
import styles from './index.module.less';

const TodoPage = () => {
  const intl = useIntl();
  const [todos, setTodos] = useState<
    {
      id: number;
      type: string;
      content: string;
      time: string;
      sponsor: string;
      handler: string;
      status: string;
      urge: boolean;
      checked: boolean;
    }[]
  >([]);

  // 催办
  const handleUrge = (id: number) => {
    setTodos((todos) => todos.map((item) => (item.id === id ? { ...item, urge: true } : item)));
    // 实际可加toast等
  };

  return (
    <div className={styles.todoPage}>
      {todos.map((todo) => (
        <div className={styles.todoCard} key={todo.id}>
          <div className={styles.todoHeader}>
            <span className={styles.todoType}>{todo.type}</span>
            <span className={styles.todoTime}>{todo.time}</span>
          </div>
          <div className={styles.todoContentWrap}>
            <span className={styles.todoContent}>{todo.content}</span>
            {todo.checked && (
              <span className={styles.todoCheckIcon}>
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="0.5" y="0.5" width="21" height="21" rx="7.5" fill="#F6FAFF" stroke="#165DFF" />
                  <path
                    d="M7 11.5L10 14.5L15 9.5"
                    stroke="#165DFF"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            )}
          </div>
          <div className={styles.todoInfo}>
            <span>
              {intl.formatMessage({ id: 'common.initiator' })}：
              <span className={styles.todoInfoText}>{todo.sponsor}</span>
            </span>
            <span>
              {intl.formatMessage({ id: 'common.handler' })}：
              <span className={styles.todoInfoText}>{todo.handler}</span>
            </span>
          </div>
          <div className={styles.todoStatusRow}>
            <span>
              {intl.formatMessage({ id: 'common.processingStatus' })}：
              <span className={styles.todoStatusText}>{todo.status}</span>
            </span>
            {!todo.checked && (
              <span className={styles.todoUrge} onClick={() => handleUrge(todo.id)}>
                <AntdIcon type="icon-a-Remindtixing1" className={styles.todoUrgeImg} />
                <span className={styles.todoUrgeText}>{intl.formatMessage({ id: 'common.urge' })}</span>
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export default TodoPage;
