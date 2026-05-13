import React from 'react';
import { Button, Input, InputProps } from 'antd';
import { useControllableValue } from 'ahooks';
import { SearchOutlined, FilterOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import styles from './InputFilter.module.less';

interface InputFilterProps extends Omit<InputProps, 'onChange'> {
  onSearch?: (s: string) => void;
  onChange?: (s: string) => void;
}

export const InputFilter: React.FC<InputFilterProps> = (props) => {
  const { onSearch, ...rest } = props;
  const intl = useIntl();
  const [value, onChange] = useControllableValue(props);

  const handlerSearch = (v?: string) => {
    onSearch?.(v ?? '');
  };
  return (
    <nav className={styles.inputFilter}>
      <Input
        suffix={<SearchOutlined style={{ color: '#707680' }} onClick={() => handlerSearch(value)} />}
        placeholder={intl.formatMessage({ id: 'workSpace.inputFilter.keywordPlaceholder' })}
        {...rest}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ borderRadius: 8 }}
        allowClear
        onClear={() => handlerSearch()}
        onPressEnter={() => handlerSearch(value)}
      />
      <Button icon={<FilterOutlined style={{ color: '#707680' }} />} style={{ padding: 8, borderRadius: 8 }} />
    </nav>
  );
};
