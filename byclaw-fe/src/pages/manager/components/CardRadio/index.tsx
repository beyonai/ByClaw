/* eslint-disable max-len */
import { useIntl } from '@umijs/max';
import React from 'react';
import { Tooltip } from 'antd';
import styles from './index.module.less';
import classnames from 'classnames';
import AntdIcon from '@/pages/manager/components/AntdIcon';

const CardRadio = ({
  value,
  onChange,
  options = [],
  disabled = false,
  iconStyle,
}: {
  value?: string;
  onChange?: (value: string) => void;
  options: { label: string; icon: string; value: string; desc?: string; disabled?: boolean; iconStyle?: any }[];
  disabled?: boolean;
  iconStyle?: any;
}) => {
  const intl = useIntl();

  return (
    <div className={styles['card-radio']}>
      <div className={classnames(styles['card-radio-group'], 'ub ub-ac gap8 ub-wrap full-width')}>
        {options.map((item) => (
          <div
            className={classnames(styles['card-radio-item'], 'ub-f1', {
              [styles['card-radio-item-active']]: item.value === value,
              [styles['card-radio-item-disabled']]: item.disabled,
            })}
            key={item.value}
            onClick={() => {
              if (disabled) return;
              if (item.disabled) return;
              onChange?.(item.value);
            }}
          >
            <div className={styles['card-radio-item-title']}>
              {item.icon && (
                <AntdIcon
                  className={`${styles.icon} ${iconStyle}`}
                  type={item.icon}
                  style={{ color: item.iconStyle }}
                />
              )}
              <span className={styles.label}>{intl.formatMessage({ id: item.label })}</span>
            </div>
            {item?.desc && (
              <Tooltip title={intl.formatMessage({ id: item?.desc })}>
                <span className={classnames(styles['card-radio-item-desc'], 'textEllipsis3')}>
                  {intl.formatMessage({ id: item?.desc })}
                </span>
              </Tooltip>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default CardRadio;
