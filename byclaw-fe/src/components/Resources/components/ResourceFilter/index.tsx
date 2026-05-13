import React from 'react';
import classnames from 'classnames';
import { Button, Dropdown } from 'antd';
import { get, isEmpty, pullAllBy } from 'lodash';
import { CloseOutlined, DownOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import PersonalSelect from '@/components/PersonalSelect';
import { dataItemTypeMap } from '@/components/PersonnelModel';
import RightItemRender from '@/components/OrgSelect/components/RightItemRender';
import { searchTypeMap } from '@/components/PersonnelModel/const';
import { IOrgCache } from '@/components/OrgSelect/MyOrgSelect';
import {
  RESOURCE_BIZ_TYPE_ALL_VALUE,
  BELONG_DEPT_VALUE,
  BELONG_COMPANY_VALUE,
  BELONG_ALL_VALUE,
  STATUS_ALL_VALUE,
  STATUS_IN_STOCK_VALUE,
  STATUS_CANCELLED_VALUE,
  PERMISSION_ALL_VALUE,
  PERMISSION_CREATED_BY_ME_VALUE,
  PERMISSION_AUTHORIZED_TO_ME_VALUE,
  PERMISSION_PENDING_MY_APPROVAL_VALUE,
  PERMISSION_APPLIED_BY_ME_VALUE,
  statusOptions,
  belongOptions,
  resourceBizTypeOptions,
  knowledgeResourceBizTypeOptions,
  permissionOptions,
} from '../../constants';
import { isAllResourceBizTypeSelected, normalizeResourceBizTypeList } from '../../utils';
import styles from './index.module.less';

export type IOnOkParams = {
  resourceStatus: string;
  belong?: string;
  deptBelong?: IOrgCache[];
  resourceBizTypeList?: string[];
  permission?: string;
  orgFilters?: Array<{
    type: string;
    objectId?: number;
    objectType?: 'ORG';
  }>;
};

export {
  BELONG_DEPT_VALUE,
  BELONG_COMPANY_VALUE,
  BELONG_ALL_VALUE,
  STATUS_ALL_VALUE,
  STATUS_IN_STOCK_VALUE,
  STATUS_CANCELLED_VALUE,
  statusOptions,
  belongOptions,
  PERMISSION_ALL_VALUE,
  PERMISSION_CREATED_BY_ME_VALUE,
  PERMISSION_AUTHORIZED_TO_ME_VALUE,
  PERMISSION_PENDING_MY_APPROVAL_VALUE,
  PERMISSION_APPLIED_BY_ME_VALUE,
};

// 暂时隐藏企业 tab 下筛选框的"归属"项；后续恢复时把使用处的 `SHOW_BELONG_FILTER &&`
// 替换回 `activeTab !== 'personal' &&` 即可。
const SHOW_BELONG_FILTER = false;

export const getDefaultParams = (defaultParam: Partial<IOnOkParams> = {}) => {
  return {
    resourceStatus: STATUS_IN_STOCK_VALUE,
    belong: BELONG_ALL_VALUE,
    deptBelong: [],
    resourceBizTypeList: [],
    permission: '',
    ...defaultParam,
  };
};

function filterReducer(state: IOnOkParams, action: { type: string; item: Partial<IOnOkParams> }) {
  switch (action.type) {
    case 'update':
      return { ...state, ...action.item };
    default:
      throw new Error();
  }
}

const ResourceFilterForm = ({
  onOk,
  defaultParam,
  activeTab,
  resourceType,
}: {
  onOk: (param: IOnOkParams) => void;
  defaultParam: IOnOkParams;
  resourceType?: string;
  activeTab?: string;
}) => {
  const intl = useIntl();
  const [filterParam, setFilterParam] = React.useReducer(filterReducer, getDefaultParams(defaultParam));
  const [showPersonnelModel, setShowPersonnelModel] = React.useState(false);

  const {
    resourceStatus: filterStatus,
    belong: filterBelong,
    deptBelong: deptSelectValue,
    resourceBizTypeList: filterResourceBizTypeList,
    permission: filterPermission,
  } = filterParam;
  const typeOptions = resourceType === 'KG_DOC' ? knowledgeResourceBizTypeOptions : resourceBizTypeOptions;
  const showTypeFilter = resourceType === 'TOOL' || resourceType === 'KG_DOC';
  const normalizedResourceBizTypeList = normalizeResourceBizTypeList(filterResourceBizTypeList, resourceType);

  // 个人 tab 下不展示"待我审核""我申请中"两个权限选项——这两项语义只在企业 tab 下成立。
  const visiblePermissionOptions = React.useMemo(
    () =>
      activeTab === 'personal'
        ? permissionOptions.filter(
          (opt) => opt.value !== PERMISSION_PENDING_MY_APPROVAL_VALUE && opt.value !== PERMISSION_APPLIED_BY_ME_VALUE
        )
        : permissionOptions,
    [activeTab]
  );

  // 切到 personal tab 时，如果残留 forbidden 权限值，自动复位为 ""，避免 UI 与 state 不一致。
  React.useEffect(() => {
    if (
      activeTab === 'personal' &&
      (filterPermission === PERMISSION_PENDING_MY_APPROVAL_VALUE || filterPermission === PERMISSION_APPLIED_BY_ME_VALUE)
    ) {
      setFilterParam({ type: 'update', item: { permission: '' } });
    }
  }, [activeTab, filterPermission]);
  const buildOrgFilters = () => {
    if (filterBelong !== BELONG_DEPT_VALUE) {
      return [];
    }

    return (deptSelectValue || [])
      .map((item) => {
        const objectId = Number(item?.orgId ?? `${item?.id || ''}`.split('_').pop());
        if (Number.isNaN(objectId)) {
          return undefined;
        }

        return {
          type: BELONG_DEPT_VALUE,
          objectId,
          objectType: 'ORG' as const,
        };
      })
      .filter(Boolean) as NonNullable<IOnOkParams['orgFilters']>;
  };
  const buildSubmitParams = () => {
    const baseParams = {
      resourceStatus: filterStatus,
      permission: filterPermission,
    };
    const belongParams =
      activeTab === 'personal'
        ? {}
        : {
          belong: filterBelong,
          deptBelong: deptSelectValue,
          orgFilters: buildOrgFilters(),
        };

    if (activeTab === 'personal') {
      return {
        ...baseParams,
        deptBelong: [],
        ...(showTypeFilter ? { resourceBizTypeList: normalizedResourceBizTypeList } : {}),
      };
    }

    if (showTypeFilter) {
      return {
        ...baseParams,
        ...belongParams,
        resourceBizTypeList: normalizedResourceBizTypeList,
      };
    }

    return {
      ...baseParams,
      ...belongParams,
    };
  };

  return (
    <>
      <div className={classnames(styles.container, 'ub gap16 ub-ver')}>
        {/* 筛选-类型 */}
        {showTypeFilter && (
          <div className="ub ub-ver gap8">
            <p className={styles.filterTitle}>{intl.formatMessage({ id: 'resource.type' })}</p>
            <div className="ub gap8 ub-wrap">
              {typeOptions.map((item) => (
                <div
                  key={item.value}
                  className={classnames(styles.statusItem, 'ub ub-ac pointer', {
                    [styles.active]:
                      item.value === RESOURCE_BIZ_TYPE_ALL_VALUE
                        ? isAllResourceBizTypeSelected(filterResourceBizTypeList, resourceType)
                        : !isAllResourceBizTypeSelected(filterResourceBizTypeList, resourceType) &&
                          filterResourceBizTypeList?.[0] === item.value,
                  })}
                  onClick={() => {
                    setFilterParam({
                      type: 'update',
                      item: {
                        resourceBizTypeList: item.value === RESOURCE_BIZ_TYPE_ALL_VALUE ? [] : [item.value],
                      },
                    });
                  }}
                >
                  {intl.formatMessage({ id: item.label })}
                </div>
              ))}
            </div>
          </div>
        )}
        {/* 筛选-状态 */}
        <div className="ub ub-ver gap8">
          <p className={styles.filterTitle}>{intl.formatMessage({ id: 'common.status' })}</p>
          <div className="ub gap8 ub-wrap">
            {statusOptions.map((item) => (
              <div
                key={item.value}
                className={classnames(styles.statusItem, 'ub ub-ac pointer', {
                  [styles.active]: filterStatus === item.value,
                })}
                onClick={() => {
                  setFilterParam({
                    type: 'update',
                    item: {
                      resourceStatus: item.value,
                    },
                  });
                }}
              >
                {intl.formatMessage({ id: item.label })}
              </div>
            ))}
          </div>
        </div>

        {/* 筛选-权限 */}
        <div className="ub ub-ver gap8">
          <p className={styles.filterTitle}>{intl.formatMessage({ id: 'resource.permission' })}</p>
          <div className="ub gap8 ub-wrap">
            {visiblePermissionOptions.map((item) => (
              <div
                key={item.value}
                className={classnames(styles.statusItem, 'ub ub-ac pointer', {
                  [styles.active]: filterPermission === item.value,
                })}
                onClick={() => {
                  setFilterParam({
                    type: 'update',
                    item: {
                      permission: item.value,
                    },
                  });
                }}
              >
                {intl.formatMessage({ id: item.label })}
              </div>
            ))}
          </div>
        </div>

        {/* 筛选-归属（暂时隐藏，详见文件顶部 SHOW_BELONG_FILTER 注释） */}
        {SHOW_BELONG_FILTER && activeTab !== 'personal' && (
          <>
            <div className="ub ub-ver gap8">
              <p className={styles.filterTitle}>{intl.formatMessage({ id: 'common.belong' })}</p>
              <div className="ub gap8 ub-wrap">
                {belongOptions.map((item) => (
                  <div
                    key={item.value}
                    className={classnames(styles.belongItem, 'ub ub-ac pointer', {
                      [styles.active]: filterBelong === item.value,
                    })}
                    onClick={() => {
                      setFilterParam({
                        type: 'update',
                        item: {
                          belong: item.value,
                        },
                      });
                      if (item.value === BELONG_DEPT_VALUE) {
                        setShowPersonnelModel(true);
                      }
                    }}
                  >
                    {intl.formatMessage({ id: item.label })}
                  </div>
                ))}
              </div>
            </div>
            {filterBelong === BELONG_DEPT_VALUE && (
              <div
                className={classnames(styles.customFilter, 'ub ub-wrap gap8 pointer hideThumb')}
                onClick={() => {
                  setShowPersonnelModel(true);
                }}
              >
                {isEmpty(deptSelectValue) && (
                  <p className={styles.placeholderText}>{intl.formatMessage({ id: 'resource.selectOrgScope' })}</p>
                )}
                {!isEmpty(deptSelectValue) &&
                  deptSelectValue?.map((item) => {
                    return (
                      <div key={item?.id} className={classnames(styles.listItem, 'ub ub-ac gap6')}>
                        <RightItemRender item={item} />
                        <CloseOutlined
                          className={classnames(styles.closeBtn, 'pointer')}
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();

                            const myDeptSelectValue = [...deptSelectValue];
                            pullAllBy(myDeptSelectValue, [item], 'id');
                            setFilterParam({
                              type: 'update',
                              item: {
                                deptBelong: myDeptSelectValue,
                              },
                            });
                          }}
                        />
                      </div>
                    );
                  })}
              </div>
            )}
          </>
        )}
        <div className="ub ub-ac ub-pe gap8">
          <Button
            size="small"
            onClick={() => {
              if (activeTab === 'personal') {
                setFilterParam({
                  type: 'update',
                  item: {
                    resourceStatus: STATUS_IN_STOCK_VALUE,
                    permission: '',
                  },
                });
              } else if (resourceType === 'TOOL') {
                setFilterParam({
                  type: 'update',
                  item: {
                    resourceStatus: STATUS_IN_STOCK_VALUE,
                    belong: BELONG_ALL_VALUE,
                    deptBelong: [],
                    resourceBizTypeList: [],
                    permission: '',
                  },
                });
              } else {
                setFilterParam({
                  type: 'update',
                  item: {
                    resourceStatus: STATUS_IN_STOCK_VALUE,
                    belong: BELONG_ALL_VALUE,
                    deptBelong: [],
                    resourceBizTypeList: [],
                    permission: '',
                  },
                });
              }
            }}
          >
            {intl.formatMessage({ id: 'common.reset' })}
          </Button>
          <Button
            size="small"
            type="primary"
            onClick={() => {
              onOk(buildSubmitParams());
            }}
          >
            {intl.formatMessage({ id: 'common.confirm' })}
          </Button>
        </div>
      </div>
      <PersonalSelect
        destroyOnHidden
        visible={showPersonnelModel}
        onCancel={() => {
          setShowPersonnelModel(false);
        }}
        onOk={(vals: Record<string, unknown>[]) => {
          setShowPersonnelModel(false);
          setFilterParam({
            type: 'update',
            item: {
              deptBelong: (vals || []).map((item) => ({
                ...item,
                id: item?.id || `${dataItemTypeMap.org.toLowerCase()}_${item?.orgId}`,
                name: item?.name || item?.orgName,
                type: dataItemTypeMap.org,
                orgId: item?.orgId,
                orgLevel: item?.orgLevel,
                orgName: item?.orgName,
                parentOrgId: item?.parentOrgId,
                pathCode: item?.pathCode,
              })) as IOrgCache[],
            },
          });
        }}
        confirmLoading={false}
        selectedValue={deptSelectValue}
        disabledList={[dataItemTypeMap.user, dataItemTypeMap.agent]}
        searchTypeMapList={[searchTypeMap.org]}
        maxSelectCount={null}
      />
    </>
  );
};

interface ResourceFilterWithDropdownProps {
  onOk: (param: IOnOkParams) => void;
  defaultParam: IOnOkParams;
  activeTab?: string;
  resourceType?: string;
}

const ResourceFilter: React.FC<ResourceFilterWithDropdownProps> = ({ onOk, defaultParam, activeTab, resourceType }) => {
  const intl = useIntl();
  const [dropdownOpen, setDropdownOpen] = React.useState(false);

  return (
    <Dropdown
      destroyOnHidden
      popupRender={() => (
        <ResourceFilterForm
          resourceType={resourceType}
          onOk={(param: IOnOkParams) => {
            onOk(param);
            setDropdownOpen(false);
          }}
          defaultParam={defaultParam}
          activeTab={activeTab}
        />
      )}
      getPopupContainer={() => window.document.body}
      trigger={['click']}
      open={dropdownOpen}
      onOpenChange={(isOpen) => {
        setDropdownOpen(isOpen);
      }}
    >
      <div className={classnames(styles.relatedToMeDropdown, 'ub ub-ac ub-pj gap8 pointer')}>
        <div className="textEllipsis ub ub-f1 gap6">
          {/* 筛选-类型 */}
          {(resourceType === 'TOOL' || resourceType === 'KG_DOC') && (
            <div className={styles.selectedItem}>
              {intl.formatMessage({ id: 'resource.type' })}：
              {(() => {
                const bizTypeList = get(defaultParam, 'resourceBizTypeList');
                if (isAllResourceBizTypeSelected(bizTypeList, resourceType)) {
                  return intl.formatMessage({ id: 'common.all' });
                }
                const currentTypeOptions =
                  resourceType === 'KG_DOC' ? knowledgeResourceBizTypeOptions : resourceBizTypeOptions;
                const selectedOption = currentTypeOptions.find((item) => item.value === bizTypeList?.[0]);
                return selectedOption
                  ? intl.formatMessage({ id: selectedOption.label })
                  : intl.formatMessage({ id: 'common.all' });
              })()}
            </div>
          )}
          {/* 筛选-状态 */}
          <div className={styles.selectedItem}>
            {intl.formatMessage({ id: 'common.status' })}：
            {(() => {
              const selectedOption = statusOptions.find((item) => item.value === get(defaultParam, 'resourceStatus'));
              return selectedOption
                ? intl.formatMessage({ id: selectedOption.label })
                : intl.formatMessage({ id: 'resource.statusActive' });
            })()}
          </div>
          {/* 筛选-权限 */}
          <div className={styles.selectedItem}>
            {intl.formatMessage({ id: 'resource.permission' })}：
            {(() => {
              const currentPermission = get(defaultParam, 'permission');
              // personal tab 下"待我审核 / 我申请中"两个值不展示——若残留按"全部"回显
              const isHiddenInPersonal =
                activeTab === 'personal' &&
                (currentPermission === PERMISSION_PENDING_MY_APPROVAL_VALUE ||
                  currentPermission === PERMISSION_APPLIED_BY_ME_VALUE);
              if (isHiddenInPersonal) {
                return intl.formatMessage({ id: 'common.all' });
              }
              const selectedOption = permissionOptions.find((item) => item.value === currentPermission);
              return selectedOption
                ? intl.formatMessage({ id: selectedOption.label })
                : intl.formatMessage({ id: 'common.all' });
            })()}
          </div>
          {/* 筛选-归属（暂时隐藏，详见文件顶部 SHOW_BELONG_FILTER 注释） */}
          {SHOW_BELONG_FILTER && activeTab !== 'personal' && (
            <div className={styles.selectedItem}>
              {intl.formatMessage({ id: 'common.belong' })}：
              {(() => {
                const selectedOption = belongOptions.find((item) => item.value === get(defaultParam, 'belong'));
                return selectedOption
                  ? intl.formatMessage({ id: selectedOption.label })
                  : intl.formatMessage({ id: 'common.all' });
              })()}
            </div>
          )}
        </div>
        <DownOutlined />
      </div>
    </Dropdown>
  );
};

export default ResourceFilter;
