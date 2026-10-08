import { useIntl } from '@umijs/max';
import classnames from 'classnames';
import {
  digitalEmployeeTypeOptions,
  getResourceOwnerOptions,
  permissionOptions,
  PERMISSION_APPLIED_BY_ME_VALUE,
} from '../../constants';
import type { IOnOkParams } from '../ResourceFilter';
import styles from './index.module.less';

type QuickFilterParams = Pick<IOnOkParams, 'ownerType' | 'permission' | 'digitalEmployeeType'>;

interface Props {
  className?: string;
  resourceType: string;
  activeTab: string;
  value: QuickFilterParams;
  onChange: (param: QuickFilterParams) => void;
}

// 常用类型和归属条件直接生效，分类与业务类型仍由原筛选弹层确认。
const ResourceQuickFilters = ({ className, resourceType, activeTab, value, onChange }: Props) => {
  const intl = useIntl();
  const isDigitalEmployee = resourceType === 'DIG_EMPLOYEE';
  const availableOnly = activeTab === 'personal' || (isDigitalEmployee && activeTab === 'available');
  const visiblePermissionOptions = availableOnly
    ? permissionOptions.filter((item) => item.value !== PERMISSION_APPLIED_BY_ME_VALUE)
    : permissionOptions;
  const selectedPermission =
    availableOnly && value.permission === PERMISSION_APPLIED_BY_ME_VALUE ? '' : value.permission || '';
  const groups = [
    // 企业推荐固定展示企业员工和员工组，不再提供类型筛选；可用与收藏页保留原选项。
    ...(isDigitalEmployee && activeTab !== 'official'
      ? [
          {
            key: 'digitalEmployeeType' as const,
            title: 'resource.type',
            options: digitalEmployeeTypeOptions,
            selectedValue: value.digitalEmployeeType || '',
          },
        ]
      : !isDigitalEmployee && availableOnly
      ? [
          {
            key: 'ownerType' as const,
            title: 'resource.type',
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
