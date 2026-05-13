// @ts-nocheck
/* eslint-disable function-paren-newline */
import React, { useState, useEffect, useMemo } from 'react';
import { Collapse, InputNumber, Checkbox, Switch } from 'antd';
import type { CheckboxValueType } from 'antd/es/checkbox/Group';
import { get, unionBy } from 'lodash';
import { useIntl } from '@umijs/max';
import { getDcSystemConfig, getDcSystemConfigListByStandType } from '@/pages/manager/service/session';
import { queryResourceListByDefaultType } from '@/pages/manager/service/DigitalEmployeeMgr';
import { skillHandler } from '../..';
import styles from './index.module.less';
import classNames from 'classnames';

const { Panel } = Collapse;

interface PrologueRef {
  fileUpload?: {
    enabled: boolean;
    allowedFileTypes: string[];
    maxFileSize: number;
    maxFileCount: number;
  };
}

function difference(previousValues: string[], currentValues: string[]) {
  const result: string[] = [];
  previousValues.forEach((v) => {
    if (!currentValues.includes(v)) {
      result.push(v);
    }
  });
  currentValues.forEach((v) => {
    if (!previousValues.includes(v)) {
      result.push(v);
    }
  });
  return result;
}

// 文件类型选项类型定义
interface FileTypeOption {
  label: string;
  value: string;
  isSelectAll?: boolean;
}

async function getFileTypes() {
  const res = await getDcSystemConfigListByStandType({
    standType: 'DIG_EMPLOYEE_FILE_UPLOAD_TYPE',
  });
  const data = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'ofd'];
  if (res?.code === 0 && Array.isArray(res.data)) {
    const fileTypes = res.data
      .map((item: { standCode?: string; standDisplayValue?: string }) => {
        const standCode = String(item?.standCode || '').replace(/^\./, '');
        if (!standCode) {
          return null;
        }
        return {
          label: item?.standDisplayValue || standCode,
          value: `.${standCode}`,
        };
      })
      .filter(Boolean);
    if (fileTypes.length) {
      return fileTypes;
    }
  }
  return data.map((item) => {
    const label = item.replace(/^\./, '');
    return {
      label,
      value: `.${label}`,
    };
  });
}

const UploadFileConfig = (props: {
  prologueRef: React.RefObject<PrologueRef>;
  isReadOnly?: boolean;
  setSkills?: React.Dispatch<React.SetStateAction<never[]>>;
  isOutsideSkills?: boolean;
}) => {
  const { prologueRef, isReadOnly, setSkills, isOutsideSkills } = props;
  const intl = useIntl();

  const [loading, setLoading] = useState(false);

  // 初始化状态，从prologueRef获取或使用默认值
  const getInitialState = () => {
    const fileUpload = prologueRef.current?.fileUpload;
    return {
      enabled: fileUpload?.enabled ?? false,
      maxFileSize: fileUpload?.maxFileSize ?? 50,
      maxFileCount: fileUpload?.maxFileCount ?? 5,
      allowedFileTypes: fileUpload?.allowedFileTypes ?? [],
    };
  };

  const [state, setState] = useState(getInitialState);
  const [fileTypeOptions, setFileTypeOptions] = useState<FileTypeOption[]>([]);
  const [isExpanded, setIsExpanded] = useState(state.enabled);

  const [limitMaxFileSize, setLimitMaxFileSize] = useState(100);
  const [limitMaxFileCount, setLimitMaxFileCount] = useState(20);

  // 当prologueRef变化时同步状态
  useEffect(() => {
    const newState = getInitialState();
    setState(newState);
    setIsExpanded(newState.enabled);
  }, [prologueRef.current]);

  // 更新prologueRef.current
  const updatePrologueRef = (updates: Partial<typeof state>) => {
    const newState = { ...state, ...updates };
    setState(newState);

    if (prologueRef.current) {
      prologueRef.current.fileUpload = {
        enabled: newState.enabled,
        maxFileSize: newState.maxFileSize,
        maxFileCount: newState.maxFileCount,
        allowedFileTypes: newState.allowedFileTypes,
      };
    }
  };

  useEffect(() => {
    getFileTypes().then(setFileTypeOptions);
    getDcSystemConfig({ paramCode: 'DIG_EMPLOYEE_FILE_UPLOAD_CONFIG' }).then((res) => {
      try {
        const config = JSON.parse(res.paramValue);
        // 查询超级助手的配置，每个数字员工的文件大小和文件数量不能超过超级助手的配置
        const maxFileSize = config.maxFileSize || 100;
        const maxFileCount = config.maxFileCount || 20;
        setLimitMaxFileSize(maxFileSize);
        setLimitMaxFileCount(maxFileCount);
      } catch (error) {
        console.error(error);
      }
    });
  }, []);

  useEffect(() => {
    const updateState: Partial<typeof state> = {};
    if (state.maxFileSize > limitMaxFileSize) {
      updateState.maxFileSize = limitMaxFileSize;
    }
    if (state.maxFileCount > limitMaxFileCount) {
      updateState.maxFileCount = limitMaxFileCount;
    }
    if (Object.keys(updateState).length > 0) {
      updatePrologueRef(updateState);
    }
  }, [state.maxFileSize, state.maxFileCount, limitMaxFileSize, limitMaxFileCount]);

  const myQqueryResourceListByDefaultType = React.useCallback(() => {
    setLoading(true);
    return queryResourceListByDefaultType({
      defaultType: 'FILE_AGENT',
    })
      .then((res) => {
        return (get(res, 'data') || []).map(skillHandler);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  // 处理启用/关闭切换
  const handleEnableChange = (checked: boolean) => {
    if (checked && typeof setSkills === 'function') {
      myQqueryResourceListByDefaultType()
        .then((res) => {
          setSkills((prevList) => {
            return unionBy(prevList, res, 'resourceId');
          });
        })
        .finally(() => {
          updatePrologueRef({ enabled: checked });
          setIsExpanded(checked);
        });
    } else {
      updatePrologueRef({ enabled: checked });
      setIsExpanded(checked);
    }
  };

  // 处理文件大小变化
  const handleFileSizeChange = (value: number | null) => {
    if (value !== null) {
      updatePrologueRef({ maxFileSize: value });
    }
  };

  // 处理文件数量变化
  const handleFileCountChange = (value: number | null) => {
    if (value !== null) {
      updatePrologueRef({ maxFileCount: value });
    }
  };

  const isAllSelected = state.allowedFileTypes.length === fileTypeOptions.length;

  // 构建文件类型选项，包含"全选"
  const allFileTypeOptions: FileTypeOption[] = useMemo(
    () =>
      fileTypeOptions.length
        ? [
          { label: intl.formatMessage({ id: 'common.all' }), value: '__selectAll__', isSelectAll: true },
          ...fileTypeOptions,
        ]
        : [],
    [intl, fileTypeOptions]
  );

  // 获取当前选中的值（包含全选）
  const getCurrentCheckedValues = () => {
    const values = [...state.allowedFileTypes];
    if (isAllSelected) {
      values.push('__selectAll__');
    }
    return values;
  };

  // 处理文件类型选择变化（包含全选逻辑）
  const handleFileTypeChangeWithSelectAll = (checkedValues: CheckboxValueType[]) => {
    const previousValues = getCurrentCheckedValues();
    const currentValues = checkedValues.map((v) => String(v));

    const diffValues = difference(previousValues, currentValues);
    if (diffValues.includes('__selectAll__')) {
      updatePrologueRef(
        currentValues.includes('__selectAll__')
          ? {
            allowedFileTypes: fileTypeOptions.map((item) => item.value),
          }
          : {
            allowedFileTypes: [],
          }
      );
      return;
    }
    updatePrologueRef({
      allowedFileTypes: currentValues.filter((v) => v !== '__selectAll__'),
    });
  };

  return (
    <div className={classNames(styles.uploadFileConfig, isOutsideSkills ? styles.formWrap : undefined)}>
      <Collapse
        ghost
        bordered={false}
        className={styles.configCollapse}
        expandIconPosition="end"
        activeKey={isExpanded ? ['1'] : []}
        onChange={(key) => {
          setIsExpanded(key.includes('1'));
        }}
      >
        <Panel
          key="1"
          header={
            <div
              className={styles.configHeader}
              style={isOutsideSkills ? { paddingRight: 36, justifyContent: 'space-between' } : undefined}
            >
              <span className={classNames(styles.configLabel, isOutsideSkills ? styles.formLabel : undefined)}>
                {intl.formatMessage({ id: 'file.uploadConfig' })}
              </span>
              <div onClick={(e) => e.stopPropagation()}>
                <Switch checked={state.enabled} onChange={handleEnableChange} disabled={isReadOnly} loading={loading} />
              </div>
            </div>
          }
        >
          <div className={styles.configContent}>
            {/* 文件大小 */}
            <div className={styles.configItem}>
              <span className={styles.configLabel}>{intl.formatMessage({ id: 'file.size' })}</span>
              <InputNumber
                min={1}
                max={limitMaxFileSize}
                value={state.maxFileSize}
                onChange={handleFileSizeChange}
                className={styles.configInput}
                disabled={isReadOnly}
              />
              <span>MB</span>
            </div>

            {/* 文件数量 */}
            <div className={styles.configItem}>
              <span className={styles.configLabel}>{intl.formatMessage({ id: 'file.count' })}</span>
              <InputNumber
                min={1}
                max={limitMaxFileCount}
                value={state.maxFileCount}
                onChange={handleFileCountChange}
                className={styles.configInput}
                disabled={isReadOnly}
              />
            </div>

            {/* 文件类型 */}
            <div className={styles.configItem}>
              <span className={styles.configLabel}>{intl.formatMessage({ id: 'file.type' })}</span>
              <div className={styles.fileTypeContainer}>
                <Checkbox.Group
                  value={getCurrentCheckedValues()}
                  onChange={handleFileTypeChangeWithSelectAll}
                  className={styles.fileTypeGroup}
                  disabled={isReadOnly}
                >
                  {allFileTypeOptions.map((item) => (
                    <Checkbox
                      key={item.value}
                      value={item.value}
                      indeterminate={item.isSelectAll && state.allowedFileTypes.length > 0 && !isAllSelected}
                    >
                      {item.label}
                    </Checkbox>
                  ))}
                </Checkbox.Group>
              </div>
            </div>
          </div>
        </Panel>
      </Collapse>
    </div>
  );
};

export default UploadFileConfig;
