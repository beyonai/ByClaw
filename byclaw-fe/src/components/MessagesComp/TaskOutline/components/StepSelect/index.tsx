import type { SelectProps } from 'antd';
import { Checkbox, Empty, Select } from 'antd';
import React, { useEffect, useState } from 'react';
// @ts-ignore
import { useIntl } from '@umijs/max';
import styles from './index.module.less';

interface DataItem {
  name: string;
  serial: number;
  desc: string;
}

interface StepSelectProps {
  data: DataItem[];
  value?: string[] | null;
  onChange: (val: string[]) => void;
}

const StepSelect: React.FC<StepSelectProps> = ({ data, value, onChange }) => {
  const intl = useIntl();
  // 选中的值（name数组）
  const [selectedValues, setSelectedValues] = useState<string[]>([]);

  useEffect(() => {
    setSelectedValues(Array.isArray(value) ? value : []);
  }, [value]);

  // 处理选中变化
  const handleChange = (selectedNames: string[]) => {
    setSelectedValues(selectedNames);
    onChange(selectedNames);
  };

  // 自定义下拉内容
  const dropdownRender = () => (
    <div className={styles.dropdownBlock}>
      {data.length > 0 ? (
        data.map((item) => (
          <div key={`${item.name}-${item.serial}`} className={styles.optionItem}>
            <Checkbox
              checked={selectedValues.includes(item.name)}
              onChange={(e) => {
                const { checked } = e.target;
                if (checked) {
                  handleChange([...selectedValues, item.name]);
                } else {
                  handleChange(selectedValues.filter((name) => name !== item.name));
                }
              }}
            >
              <div style={{ display: 'flex', marginTop: '18px' }}>
                <span style={{ marginRight: 8 }}>{item.serial}.</span>
                <span className={styles.descStyle}>{item.desc}</span>
              </div>
            </Checkbox>
          </div>
        ))
      ) : (
        <div className={styles.emptyWrapper}>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={intl.formatMessage({ id: 'common.noData' })} />
        </div>
      )}
    </div>
  );

  // Select的options配置
  const selectOptions: SelectProps['options'] = data.map((item) => ({
    label: item.name,
    value: item.name,
  }));

  return (
    <div style={{ display: 'flex', width: '100%' }}>
      <Select
        popupClassName={styles.selectStyle}
        mode="multiple"
        value={selectedValues}
        onChange={handleChange}
        options={selectOptions}
        dropdownRender={dropdownRender}
        tagRender={({ value, onClose }) => {
          const item = data.find((d) => d.name === value);
          return (
            <span style={{ margin: '2px 4px', padding: '0 8px', background: '#f0f0f0', borderRadius: '4px' }}>
              {item ? intl.formatMessage({ id: 'taskOutline.step' }, { serial: item.serial }) : value}
              <span style={{ marginLeft: '4px', cursor: 'pointer' }} onClick={onClose}>
                ×
              </span>
            </span>
          );
        }}
        style={{ flex: 1, marginRight: 8 }}
        placeholder={intl.formatMessage({ id: 'form.select' })}
        optionLabelProp="label"
        labelRender={(props) => {
          const item = data.find((d) => d.name === props.value);
          return (
            <span>{item ? intl.formatMessage({ id: 'taskOutline.step' }, { serial: item.serial }) : props.value}</span>
          );
        }}
      />
    </div>
  );
};

export default StepSelect;
