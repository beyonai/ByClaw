import AntdIcon from '@/components/AntdIcon';
import { Checkbox, Empty, Select } from 'antd';
import React, { useEffect, useState } from 'react';
// @ts-ignore
import { useIntl } from '@umijs/max';
import styles from './index.module.less';

interface FileOption {
  label: React.ReactNode;
  value: string;
}

interface FileGroup {
  label: React.ReactNode;
  title: string;
  options: FileOption[];
}

interface StepSelectProps {
  data: FileGroup[];
  value?: string[];
  onChange: (values: string[]) => void;
}

// 根据文件后缀获取对应图标
const getFileIcon = (fileName: string) => {
  const nameStr = typeof fileName === 'string' ? fileName : String(fileName);

  // 处理空值
  if (!nameStr.includes('.')) {
    return 'wenjianjia'; // 文件夹图标
  }

  const extension = nameStr.split('.').pop()?.toLowerCase();

  switch (extension) {
    case 'docx':
    case 'doc':
      return 'Word';
    case 'pdf':
      return 'PDF';
    case 'xlsx':
    case 'xls':
      return 'Excel';
    case 'txt':
      return 'jishiben';
    case 'ppt':
    case 'pptx':
      return 'PPT';
    case 'json':
      return 'json';
    case 'md':
      return 'markdown';
    case 'html':
      return 'html';
    case 'java':
      return 'java';
    case 'sql':
      return 'sql1';
    case 'py':
      return 'python';
    case 'png':
    case 'jpg':
    case 'jpeg':
      return 'Image';
    default:
      return 'wendang';
  }
};

const InPutSelect: React.FC<StepSelectProps> = ({ data = [], value = [], onChange }) => {
  const intl = useIntl();
  const [selectedValues, setSelectedValues] = useState<string[]>(value);

  useEffect(() => {
    setSelectedValues(value);
  }, [value]);

  const handleChange = (selected: string[]) => {
    setSelectedValues(selected);
    onChange(selected);
  };

  const dropdownRender = () => (
    <div className={styles.dropdownContainer}>
      {data.length > 0 ? (
        data.map((group, index) => (
          <div key={index} className={styles.groupContainer}>
            <div className={styles.groupTitle}>{group.label}</div>
            {group.options.length > 0 ? (
              group.options.map((option) => (
                <div key={option.value} className={styles.optionItem}>
                  <Checkbox
                    checked={selectedValues.includes(option.value)}
                    onChange={(e) => {
                      const { checked } = e.target;
                      const newValues = checked
                        ? [...selectedValues, option.value]
                        : selectedValues.filter((v) => v !== option.value);
                      handleChange(newValues);
                    }}
                  >
                    <AntdIcon
                      type={`icon-${getFileIcon(option.value as string)}`}
                      style={{ fontSize: 18, marginRight: 5 }}
                    />
                    <span>{option.label}</span>
                  </Checkbox>
                </div>
              ))
            ) : (
              <span className={styles.emptyGroup}>{intl.formatMessage({ id: 'taskOutline.noFileUploaded' })}</span>
            )}
          </div>
        ))
      ) : (
        <div className={styles.emptyWrapper}>
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={intl.formatMessage({ id: 'common.noData' })} />
        </div>
      )}
    </div>
  );

  return (
    <Select
      mode="multiple"
      value={selectedValues}
      onChange={handleChange}
      dropdownRender={dropdownRender}
      style={{ width: '100%' }}
      placeholder={intl.formatMessage({ id: 'common.selectFile' })}
      optionLabelProp="value"
      tagRender={(props) => {
        return (
          <span className={styles.tag}>
            {props.value}
            <span className={styles.tagCloseIcon} onClick={props.onClose}>
              ×
            </span>
          </span>
        );
      }}
    />
  );
};

export default InPutSelect;
