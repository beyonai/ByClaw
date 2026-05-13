import { Input, Select } from 'antd';
import React, { useEffect, useState } from 'react';
// @ts-ignore
import { useIntl } from '@umijs/max';

const { Option } = Select;

const SUFFIXES = ['.json', '.txt', '.md', '.docx', '.xlsx', '.pptx', '.html', '.java', '.py', '.sql'];

const OutPutFile: React.FC<{
  value?: string;
  onChange?: (value: string) => void;
}> = ({ value = '', onChange }) => {
  const intl = useIntl();
  const [fileName, setFileName] = useState('');
  const [suffix, setSuffix] = useState('');
  const [customSuffixes, setCustomSuffixes] = useState<string[]>([]);

  // 初始化解析value
  useEffect(() => {
    if (value) {
      const lastDotIndex = value.lastIndexOf('.');
      if (lastDotIndex > -1) {
        const filePart = value.substring(0, lastDotIndex);
        const suffixPart = value.substring(lastDotIndex);
        setFileName(filePart);

        // 检查后缀是否在已知列表中
        if (SUFFIXES.includes(suffixPart)) {
          setSuffix(suffixPart);
        } else {
          // 不在列表中则添加到自定义后缀
          setSuffix(suffixPart);
          if (suffixPart && !customSuffixes.includes(suffixPart)) {
            setCustomSuffixes([...customSuffixes, suffixPart]);
          }
        }
      } else {
        // 没有后缀的情况
        setFileName(value);
        setSuffix('');
      }
    } else {
      setFileName('');
      setSuffix('');
    }
  }, [value]);

  const handleFileNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileName(e.target.value);
    onChange?.(e.target.value + suffix);
  };

  const handleSuffixChange = (value: string) => {
    setSuffix(value);
    onChange?.(fileName + value);
  };

  const allSuffixes = [...SUFFIXES, ...customSuffixes];

  const selectAfter = (
    <Select
      value={suffix}
      onChange={handleSuffixChange}
      style={{ width: 85 }}
      dropdownMatchSelectWidth={false}
      placeholder={intl.formatMessage({ id: 'taskOutline.selectSuffix' })}
      optionFilterProp="children"
    >
      <Option value="">{intl.formatMessage({ id: 'common.folder' })}</Option>
      {allSuffixes.map((s) => (
        <Option key={s} value={s}>
          {s}
        </Option>
      ))}
    </Select>
  );

  return (
    <div style={{ display: 'flex', width: '100%' }}>
      <Input
        value={fileName}
        onChange={handleFileNameChange}
        style={{ flex: 1, marginRight: 8 }}
        placeholder={intl.formatMessage({ id: 'form.input' })}
        addonAfter={selectAfter}
      />
    </div>
  );
};

export default OutPutFile;
