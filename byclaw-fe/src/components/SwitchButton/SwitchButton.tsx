import classNames from 'classnames';
import React, { useState } from 'react';
// @ts-ignore
import { useIntl } from '@umijs/max';
import styles from './SwitchButton.less';

export interface SwitchButtonProps<A, B = A> {
  keys?: [A, B];
  label?: [string, string];
  block?: boolean;
  action?: [A | B | undefined, React.Dispatch<React.SetStateAction<A | B | undefined>>];
}

export function SwitchButton<A = boolean, B = A>(props: SwitchButtonProps<A, B>) {
  const intl = useIntl();
  const { label, keys = [true, false], action, block } = props;
  const defaultLabel = label || [intl.formatMessage({ id: 'common.yes' }), intl.formatMessage({ id: 'common.no' })];
  const _action = useState<A | B>(keys[0] as any);

  const onClick = (v: any) => () => {
    if (action) action[1](v);
    if (!action) _action[1](v);
  };

  return (
    <div className={classNames(styles['switch-button'], { [styles['switch-button-block']]: !!block })}>
      {defaultLabel.map((it, i) => {
        const actived = (action ? action[0] : _action[0]) === keys[i];
        return (
          <div
            key={i}
            className={classNames(styles['switch-button-item'], {
              [styles['switch-button-item-active']]: actived,
            })}
            onClick={onClick(keys[i])}
          >
            {it}
          </div>
        );
      })}
    </div>
  );
}
