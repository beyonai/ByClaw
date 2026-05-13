import React, { useContext, useMemo } from 'react';
import { Empty } from 'antd';
import infoIcon from '@/assets/svg/task.svg';
import loadingIcon from '@/assets/svg/sloading.svg';
import { AchievementContext } from './AchievementContext';
import styles from './info.view.module.less';

export default function InfoView() {
  const context = useContext(AchievementContext);
  const [task] = context.useValue('task');

  const taskList = useMemo(() => {
    console.log('task >>>', task?.resPageJson);
    if (!task?.resPageJson) return [];
    if (!Array.isArray(task.resPageJson)) {
      task.resPageJson = task.resPageJson.steps ? task.resPageJson.steps : [task.resPageJson];
    }
    const temp: any[] = task.resPageJson.map((step: any) => ({
      label: step.step_name || step.step_topic,
      items: (step.sub_steps ?? []).map((item: any) => ({
        done: item.step_status === 'thingdone',
        txt: item.step_description,
      })),
    }));
    return temp;
  }, [task]);

  return (
    <section className={styles.InfoView}>
      <div className={styles.head} style={{ display: !task ? 'none' : undefined }}>
        <span className={styles.icon}>
          <img src={infoIcon} alt="info" />
        </span>
        <div className={styles.title}>{task?.content ?? '-'}</div>
      </div>

      <div className={styles.body} style={{ display: !task ? 'none' : undefined }}>
        {taskList.map((item, index) => (
          <div key={index} className={styles.task}>
            <div className={styles.label}>{item.label}</div>
            <div className={styles.items}>
              {item.items.map((item: any, i: number) => (
                <div key={[index, i].join()} className={styles.item}>
                  <div className={styles.ico}>{!item.done && <img src={loadingIcon} alt="loading" />}</div>
                  <div className={styles.txt}>{item.txt}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {!task && <Empty className={styles.empty} />}
    </section>
  );
}
