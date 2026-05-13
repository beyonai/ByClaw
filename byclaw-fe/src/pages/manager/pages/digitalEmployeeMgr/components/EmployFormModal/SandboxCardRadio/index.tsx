// @ts-nocheck
import React, { useEffect, useState } from 'react';
import { get } from 'lodash';
import classnames from 'classnames';
import { Form } from 'antd';
import { getDcSystemConfig } from '@/pages/manager/service/session';
import styles from './index.module.less';

const SANDBOX_TYPE_PARAM = 'SANDBOX_TYPE';

export interface SandboxOption {
  sandboxType: string;
  sandboxName: string;
  icon: string;
}

export interface SandboxCardRadioProps {
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
}

/**
 * 沙箱服务卡片选择器
 * 选项来自 getDcSystemConfig(paramCode: SANDBOX_TYPE)，paramValue 为 JSON 数组 [{ sandboxType, icon }]
 * sandboxType 作为表单值和展示文案，icon 为 base64 图片
 */
const SandboxCardRadio: React.FC<SandboxCardRadioProps> = ({ value, onChange, disabled = false }) => {
  const [options, setOptions] = useState<SandboxOption[]>([]);
  const [form] = Form.useForm();

  useEffect(() => {
    getDcSystemConfig({ paramCode: SANDBOX_TYPE_PARAM })
      .then((res) => {
        if (res?.code === 0 || res?.success) {
          const raw = get(res, 'data.paramValue');
          if (typeof raw === 'string') {
            try {
              const list = JSON.parse(raw) as SandboxOption[];
              setOptions(Array.isArray(list) ? list : []);
              if (list?.length) {
                const agentDevType = form.getFieldValue('agentDevType');
                if (!agentDevType || agentDevType === 'byai') {
                  onChange?.(list[0].sandboxType);
                }
              }
            } catch {
              setOptions([]);
            }
          }
        } else {
          setOptions([]);
        }
      })
      .catch(() => setOptions([]));
  }, []);

  if (!options.length) return null;

  return (
    <div className={styles.group}>
      {options.map((item) => {
        const itemValue = item.sandboxType;
        const iconSrc = item.icon;
        const isActive = itemValue === value;
        return (
          <div
            key={itemValue}
            className={classnames(styles.card, {
              [styles.active]: isActive,
              [styles.disabled]: disabled,
            })}
            onClick={() => {
              if (disabled) return;
              onChange?.(itemValue);
            }}
          >
            <div className={styles.iconWrap}>
              {iconSrc ? (
                <img
                  src={iconSrc.startsWith('data:') ? iconSrc : `data:image/png;base64,${iconSrc}`}
                  alt=""
                  className={styles.icon}
                />
              ) : (
                <div className={styles.iconPlaceholder} />
              )}
            </div>
            <span className={styles.label}>{item.sandboxName}</span>
          </div>
        );
      })}
    </div>
  );
};

export default SandboxCardRadio;
