import React, { isValidElement } from 'react';
import cn from 'classnames';
import { useControllableValue } from 'ahooks';
import { KeepAlive } from '@/components/KeepAlive';
import styles from './ScrollTab.module.less';

export interface Tab extends Record<string, any> {
  label: React.ReactNode;
  component?: React.JSX.Element | React.FC<any>;
}

interface ScrollTabProps<T = number> {
  tabs: Tab[];
  // eslint-disable-next-line react/no-unused-prop-types
  index?: T;
  // eslint-disable-next-line react/no-unused-prop-types
  onChange?: (tab: T) => void;

  // eslint-disable-next-line react/no-unused-prop-types
  defaultIndex?: T;
}

export function ScrollTab<T extends number | string = number>(props: ScrollTabProps<T>) {
  const { tabs } = props;
  const [index, setIndex] = useControllableValue(props, {
    trigger: 'onChange',
    defaultValue: 0,
    valuePropName: 'index',
    defaultValuePropName: 'defaultIndex',
  });

  return (
    <>
      <nav className={styles.scrollTab}>
        <div className={styles.scrollTab}>
          {tabs.map((tab, i) => (
            <div
              key={i}
              className={cn(styles.tab, { [styles.active]: index === i || index === tab.value })}
              onClick={() => setIndex(tab.value || i)}
            >
              {tab.label}
            </div>
          ))}
        </div>
      </nav>
      {tabs.map(
        (tab, i) =>
          tab.component && (
            <KeepAlive key={i} active={index === i || index === tab.value}>
              {isValidElement(tab.component) ? tab.component : React.createElement(tab.component as React.FC)}
            </KeepAlive>
          )
      )}
    </>
  );
}
