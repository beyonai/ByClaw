import React, { useEffect, useRef, useState } from 'react';
import useDelayedHover from '@/hooks/useDelayedHover';
import classNames from 'classnames';
import AntdIcon from '@/components/AntdIcon';
// @ts-ignore
import { useDispatch, useIntl, useSelector } from '@umijs/max';
import { QuickQuestion } from './quickEntries';
import RecommendTabs from './recommendTabs';
import styles from './index.module.less';
import { ITaskState } from '@/models/task';
import TodoList from './todoList';
import { useQuestions } from './useQuestions';
import useClickQuestion from './useClickQuestion';

export default function BottomContent() {
  const intl = useIntl();
  const [hoverLeft, setHoverLeft] = useState(false);
  const [hoverRight, setHoverRight] = useState<-1 | 0 | 1>(0);
  const todoListWrap = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const dispatch = useDispatch();
  const { userInfo, showTodo, tohandlePagination } = useSelector(({ task, user }: { task: ITaskState; user: any }) => ({
    userInfo: user.userInfo,
    tohandlePagination: task.tohandlePagination,
    showTodo: !task.noTohandleData,
  }));
  const questionList = useQuestions(userInfo, 5);

  // 使用延时悬停Hook - 左侧区域
  const { onMouseEnter: onMouseEnterLeft, onMouseLeave: onMouseLeaveLeft } = useDelayedHover({
    delay: 300,
    onEnter: () => {
      setHoverLeft(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (todoListWrap.current) {
          todoListWrap.current.style.display = 'block';
        }
      }, 300);
    },
    onLeave: () => {
      setHoverLeft(false);
      if (todoListWrap.current) {
        todoListWrap.current.style.display = 'none';
      }
    },
  });

  // 使用延时悬停Hook - 右侧区域
  const { onMouseEnter: onMouseEnterRight, onMouseLeave: onMouseLeaveRight } = useDelayedHover({
    delay: 300,
    onEnter: () => setHoverRight(1),
    onLeave: () => setHoverRight(-1),
  });

  useEffect(() => {
    if (userInfo) {
      dispatch({
        type: 'task/queryTohanleList',
        payload: {
          pageNum: 1,
        },
      });
    } else {
      dispatch({
        type: 'task/cleanTohanleList',
        payload: {
          noTohandleData: true,
        },
      });
    }
  }, [userInfo]);

  useEffect(() => {
    if (!showTodo && hoverRight !== 0) {
      const bothSideFakeDiv = document.querySelectorAll(`.${styles.bothSideFakeDiv}`);
      bothSideFakeDiv.forEach((item) => {
        item.className = `${styles.bothSideFakeDiv} ${hoverRight > 0 ? styles.fakeHiding : styles.fakeShow25}`;
      });
    }
  }, [hoverRight]);

  const onClickQuestion = useClickQuestion();

  return (
    <div className={styles.bottomContent}>
      <div className={styles.entryRow}>
        <div
          style={{
            flex: '1 1 50%',
            display: hoverRight < 1 && showTodo ? 'block' : 'none',
            // 加个minHeight，避免鼠标移入之后马上移动到下方，又导致触发onMouseLeave
            minHeight: hoverLeft ? 100 : undefined,
          }}
          onMouseEnter={onMouseEnterLeft}
          onMouseLeave={onMouseLeaveLeft}
        >
          <div
            style={{ marginBottom: hoverLeft ? 8 : undefined }}
            className={classNames(styles.hoverEntry, styles.active)}
          >
            <span>
              {intl.formatMessage({ id: 'common.youHave' })}
              <span className={styles.todoTotal}>{tohandlePagination.total}</span>
              {intl.formatMessage({ id: 'chat.bottomContent.todo.desc' })}
            </span>
            <div className={styles.down}>
              <AntdIcon type="icon-a-Downxia" />
            </div>
          </div>
          <div ref={todoListWrap} style={{ display: 'none' }}>
            <TodoList />
          </div>
        </div>
        {hoverLeft && <div className={styles.fakeHiding} style={{ width: '50%' }} />}
        {hoverRight > 0 && showTodo && <div className={styles.fakeHiding} style={{ width: '50%' }} />}
        {!showTodo && <div className={styles.bothSideFakeDiv} />}
        {!hoverLeft && questionList.length > 0 && (
          <div
            className="overflow-hidden"
            style={{ flex: '1 1 50%' }}
            onMouseEnter={onMouseEnterRight}
            onMouseLeave={onMouseLeaveRight}
          >
            <QuickQuestion
              item={{
                icon: questionList[0].icon,
                title: questionList[0].content,
              }}
              showAction={hoverRight > 0}
              isFirstRow={hoverRight < 1}
              onClick={() => onClickQuestion(questionList[0])}
              className={classNames(styles.hoverEntry, hoverRight < 1 ? styles.active : '')}
            />
            {/* 加个minHeight，避免鼠标移入之后马上移动到下方，又导致触发onMouseLeave */}
            <div style={{ minHeight: 100, display: hoverRight > 0 ? 'block' : 'none' }}>
              {questionList.slice(1).map((item, idx) => (
                <QuickQuestion
                  item={{
                    icon: item.icon,
                    title: item.content,
                  }}
                  showAction
                  onClick={() => onClickQuestion(item)}
                  className={classNames(styles.hoverEntry, styles.showup)}
                  style={{
                    opacity: 0,
                    animationDelay: `${0.2 + idx * 0.1}s`,
                  }}
                  key={item.content}
                />
              ))}
            </div>
          </div>
        )}
        {!showTodo && <div className={styles.bothSideFakeDiv} />}
      </div>
      <div style={{ display: hoverLeft || hoverRight > 0 ? 'none' : 'block' }}>
        <RecommendTabs />
      </div>
    </div>
  );
}
