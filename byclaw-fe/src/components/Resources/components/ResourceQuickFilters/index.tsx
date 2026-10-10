import { useIntl } from '@umijs/max';
import classnames from 'classnames';
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
  const groups = [
    ...(isDigitalEmployee
      ? [
        {
          key: 'digitalEmployeeType' as const,
          title: 'resource.type',
          options: visibleEmployeeTypeOptions,
          selectedValue: selectedEmployeeType,
        },
      ]
      : !isDigitalEmployee && availableOnly
        ? [
          {
            key: 'ownerType' as const,
            // 与业务类型同时展示时，个人/企业用“来源”区分，避免同一行出现两个“类型”。
            title: showBizTypeFilter ? 'resource.source' : 'resource.type',
            options: getResourceOwnerOptions(resourceType),
            selectedValue: value.ownerType || '',
          },
        ]
        : []),
    {
      key: 'permission' as const,
      title: 'common.belong',
      options: visiblePermissionOptions,
      selectedValue: selectedPermission,
    },
  ];

  return (
    <div className={classnames(styles.container, className)}>
      {showBizTypeFilter && (
        <div className={styles.group} role="group" aria-label={intl.formatMessage({ id: 'resource.type' })}>
          <span className={styles.title}>{intl.formatMessage({ id: 'resource.type' })}</span>
          <div className={styles.options}>
            {bizTypeOptions.map((item) => (
              <button
                type="button"
                key={item.value}
                className={classnames(styles.option, { [styles.active]: selectedBizType === item.value })}
                aria-pressed={selectedBizType === item.value}
                onClick={() => onChange({ resourceBizTypeList: item.value ? [item.value] : [] })}
              >
                {intl.formatMessage({ id: item.label })}
              </button>
            ))}
          </div>
        </div>
      )}
      {groups.map((group) => (
        <div key={group.key} className={styles.group} role="group" aria-label={intl.formatMessage({ id: group.title })}>
          <span className={styles.title}>{intl.formatMessage({ id: group.title })}</span>
          <div className={styles.options}>
            {group.options.map((item) => (
              <button
                type="button"
                key={item.value}
                className={classnames(styles.option, { [styles.active]: group.selectedValue === item.value })}
                aria-pressed={group.selectedValue === item.value}
                onClick={() => onChange({ [group.key]: item.value })}
              >
                {intl.formatMessage({ id: item.label })}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

export default ResourceQuickFilters;
