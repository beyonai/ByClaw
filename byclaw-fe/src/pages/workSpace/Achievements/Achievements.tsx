import React, { useEffect, useImperativeHandle, useState } from 'react';
import { useIntl, getIntl } from '@umijs/max';
import { SharedState } from '@/utils/SharedState';
import ProjectTask from './components/ProjectTask';
import { ScrollTab, Tab as ScrollTabTab } from './components/ScrollTab';
import { AchievementProvider, AchievementState, AchievementEffects } from './components/AchievementContext';
import styles from './Achievements.module.less';
import { EventEmitter$Cls } from '@/utils/eventEmitter';
import { CloseOutlined } from '@ant-design/icons';

const tabs: ScrollTabTab[] = [
  {
    label: getIntl().formatMessage({ id: 'common.detail' }),
    value: 'info',
    component: React.lazy(() => import('./components/info.view')),
  },
  {
    label: getIntl().formatMessage({ id: 'common.file' }),
    value: 'file',
    component: React.lazy(() => import('./components/file.view')),
  },
  {
    label: getIntl().formatMessage({ id: 'common.search' }),
    value: 'search',
    component: React.lazy(() => import('./components/search.view')),
  },
  {
    label: getIntl().formatMessage({ id: 'common.todo' }),
    value: 'todo',
    component: React.lazy(() => import('./components/todo.view')),
  },
];

interface AchievementsProps {
  // eslint-disable-next-line react/no-unused-prop-types
  onClose?: () => void;
  // eslint-disable-next-line react/no-unused-prop-types
  updateAt?: number;
  sessionId: string | number;
}

interface AchievementsTriggerProps extends AchievementsProps {
  defaultOpen?: boolean;
  EventEmitter: EventEmitter$Cls;
}

export interface TriggerRef {
  open: () => void;
  close: () => void;
  toggle: () => void;
}

interface iAchievements {
  (props: AchievementsProps): React.JSX.Element;
  Trigger: React.ForwardRefExoticComponent<AchievementsTriggerProps & React.RefAttributes<TriggerRef>>;
}

const Achievements: iAchievements = (props) => {
  const { sessionId, updateAt, onClose } = props;
  const intl = useIntl();
  const [tab, setTab] = useState<string>('info');
  const [context] = useState(() => new SharedState<AchievementState, AchievementEffects>({ sessionId }));

  const onChangeTask = (task: any) => {
    if (task?.resPage) {
      try {
        task.resPageJson = JSON.parse(task.resPage);
      } catch (e) {
        console.error(e);
      }
    }
    context.emit('[task]', task);
  };

  useEffect(() => {

    /** 预览文件 - 1.跳转文件Tab 2.预览文件 */
    context.effects.toPreviewFile = (file: AchievementState['currentFile']) => {
      setTab('file');
      context.emit('[currentFile]', file);
    };
  }, [context]);

  // 同步更新 sessionId
  useEffect(() => {
    context.emit('[sessionId]', sessionId);
  }, [sessionId]);

  return (
    <AchievementProvider value={context}>
      <section className={styles.achievements}>
        <header className={styles.header}>
          <h3 className={styles.title}>{intl.formatMessage({ id: 'workSpace.achievements.title' })}</h3>
          <div className={styles.closeButton}>
            <CloseOutlined size={16} onClick={onClose} />
          </div>
        </header>
        <div className={styles.content}>
          <ProjectTask sessionId={sessionId} updateAt={updateAt} onSelect={onChangeTask} />
          <ScrollTab tabs={tabs} index={tab} onChange={setTab} />
        </div>
      </section>
      {/* </Resizable> */}
    </AchievementProvider>
  );
};

Achievements.Trigger = React.forwardRef<TriggerRef, AchievementsTriggerProps>((props, ref) => {
  const { sessionId, updateAt, EventEmitter, defaultOpen = false } = props;
  const [isOpen, setIsOpen] = useState<boolean>(defaultOpen);

  useImperativeHandle(ref, () => ({
    open: () => {
      setIsOpen(true);
    },
    close: () => {
      setIsOpen(false);
    },
    toggle: () => {
      setIsOpen((prev) => !prev);
    },
  }));

  useEffect(() => {
    if (isOpen) {
      EventEmitter.emit('beyond-main-driver-open-type', {
        width: '25vw',
        canClose: false,
        minWidth: 260,
        drawerType: <Achievements sessionId={sessionId} updateAt={updateAt} onClose={() => setIsOpen(false)} />,
      });
    } else {
      EventEmitter.emit('beyond-main-driver-open-type', '');
    }
  }, [isOpen]);

  return <div key="1" />;
});

export default Achievements;
