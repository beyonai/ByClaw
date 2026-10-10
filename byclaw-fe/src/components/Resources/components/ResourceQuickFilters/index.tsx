import { useIntl } from '@umijs/max';
import classnames from 'classnames';
import type { PropsWithChildren } from 'react';
import {
  digitalEmployeeTypeOptions,
  getResourceOwnerOptions,
  knowledgeResourceBizTypeOptions,
  permissionOptions,
  PERMISSION_APPLIED_BY_ME_VALUE,
  resourceBizTypeOptions,
} from '../../constants';
import { isAllResourceBizTypeSelected } from '../../utils';
import type { IOnOkParams } from '../ResourceFilter';
import styles from './index.module.less';

type QuickFilterParams = Pick<IOnOkParams, 'ownerType' | 'permission' | 'digitalEmployeeType' | 'resourceBizTypeList'>;

interface Props {
  className?: string;
  resourceType: string;
  activeTab: string;
  resourceBizTypeFilter?: boolean;
  value: QuickFilterParams;
  onChange: (param: QuickFilterParams) => void;
}

interface FilterGroupProps {
  title: string;
  options: { value: string; label: string }[];
  value?: string;
  onChange: (value: string) => void;
}

// 浏览页和管理页复用同一行布局与按钮样式，筛选值及查询逻辑仍由调用方维护。
export const ResourceQuickFilterBar = ({ className, children }: PropsWithChildren<{ className?: string }>) => (
  <div className={classnames(styles.container, className)}>{children}</div>
);

export const ResourceQuickFilterGroup = ({ title, options, value, onChange }: FilterGroupProps) => (
  <div className={styles.group} role="group" aria-label={title}>
    <span className={styles.title}>{title}</span>
    <div className={styles.options}>
      {options.map((item) => (
        <button
          type="button"
          key={item.value}
          className={classnames(styles.option, { [styles.active]: value === item.value })}
          aria-pressed={value === item.value}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  </div>
);

// 常用类型、来源和归属条件直接生效，分类仍由筛选弹层确认。
const ResourceQuickFilters = ({
  className,
  resourceType,
  activeTab,
  resourceBizTypeFilter = false,
  value,
  onChange,
}: Props) => {
  const intl = useIntl();
  const isDigitalEmployee = resourceType === 'DIG_EMPLOYEE';
  const showBizTypeFilter = resourceBizTypeFilter && (resourceType === 'TOOL' || resourceType === 'KG_DOC');
  const bizTypeOptions = resourceType === 'KG_DOC' ? knowledgeResourceBizTypeOptions : resourceBizTypeOptions;
  const selectedBizType = isAllResourceBizTypeSelected(value.resourceBizTypeList, resourceType)
    ? ''
    : value.resourceBizTypeList?.[0];
  const availableOnly = activeTab === 'personal' || (isDigitalEmployee && activeTab === 'available');
  const visiblePermissionOptions = availableOnly
    ? permissionOptions.filter((item) => item.value !== PERMISSION_APPLIED_BY_ME_VALUE)
    : permissionOptions;
  const selectedPermission =
    availableOnly && value.permission === PERMISSION_APPLIED_BY_ME_VALUE ? '' : value.permission || '';
  // 企业推荐只提供企业类型，隐藏的个人类型旧值按“全部”展示。
  const visibleEmployeeTypeOptions =
    activeTab === 'official'
      ? digitalEmployeeTypeOptions.filter((item) => !item.value || item.value.startsWith('ENTERPRISE_'))
      : digitalEmployeeTypeOptions;
  const selectedEmployeeType = visibleEmployeeTypeOptions.some((item) => item.value === value.digitalEmployeeType)
    ? value.digitalEmployeeType || ''
    : '';
  const groups: Array<{
    key: 'digitalEmployeeType' | 'ownerType' | 'permission';
    title: string;
    options: Array<{ label: string; value: string }>;
    selectedValue: string;
  }> = [];
  if (isDigitalEmployee) {
    groups.push({
      key: 'digitalEmployeeType',
      title: 'resource.type',
      options: visibleEmployeeTypeOptions,
      selectedValue: selectedEmployeeType,
    });
  } else if (availableOnly) {
    groups.push({
      key: 'ownerType',
      // 与业务类型同时展示时，个人/企业用“来源”区分，避免同一行出现两个“类型”。
      title: showBizTypeFilter ? 'resource.source' : 'resource.type',
      options: getResourceOwnerOptions(resourceType),
      selectedValue: value.ownerType || '',
    });
  }
  groups.push({
    key: 'permission',
    title: 'common.belong',
    options: visiblePermissionOptions,
    selectedValue: selectedPermission,
  });

  return (
    <ResourceQuickFilterBar className={className}>
      {showBizTypeFilter && (
        <ResourceQuickFilterGroup
          title={intl.formatMessage({ id: 'resource.type' })}
          options={bizTypeOptions.map((item) => ({ ...item, label: intl.formatMessage({ id: item.label }) }))}
          value={selectedBizType}
          onChange={(bizType) => onChange({ resourceBizTypeList: bizType ? [bizType] : [] })}
        />
      )}
      {groups.map((group) => (
        <ResourceQuickFilterGroup
          key={group.key}
          title={intl.formatMessage({ id: group.title })}
          options={group.options.map((item) => ({ ...item, label: intl.formatMessage({ id: item.label }) }))}
          value={group.selectedValue}
          onChange={(selectedValue) => onChange({ [group.key]: selectedValue })}
        />
      ))}
    </ResourceQuickFilterBar>
  );
};

export default ResourceQuickFilters;
