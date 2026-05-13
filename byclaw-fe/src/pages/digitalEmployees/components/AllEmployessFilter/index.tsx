import React from 'react';
import classnames from 'classnames';
import { Button } from 'antd';
import { get, isEmpty, pullAllBy } from 'lodash';
import { CloseOutlined } from '@ant-design/icons';
// @ts-ignore
import { getIntl, useIntl } from '@umijs/max';

import PersonalSelect from '@/components/PersonalSelect';
import { dataItemTypeMap } from '@/components/PersonnelModel';
import RightItemRender from '@/components/OrgSelect/components/RightItemRender';
import { searchTypeMap } from '@/components/PersonnelModel/const';
import MyOrgSelect, { IOrgCache } from '@/components/OrgSelect/MyOrgSelect';

import styles from './index.module.less';

export type IOnOkParams = {
  status: string;
  belong: string;
  customBelong?: Record<string, unknown>[];
  deptBelong?: IOrgCache[];
};

export const CustomKeyValue = 'CUSTOM';
export const DeptKeyValue = 'DEPT';
export const AllKeyValue = 'ALL';

export const statusOptions = [
  {
    label: getIntl().formatMessage({ id: 'common.all' }),
    value: AllKeyValue,
  },
  {
    label: getIntl().formatMessage({ id: 'common.authorized' }),
    value: 'AUTHORIZED',
  },
  // {
  //   label: getIntl().formatMessage({ id: 'common.approved' }),
  //   value: 'APPROVED',
  // },
  // {
  //   label: getIntl().formatMessage({ id: 'common.auditing' }),
  //   value: 'AUDITING',
  // },
  // {
  //   label: getIntl().formatMessage({ id: 'common.applicable' }),
  //   value: 'APPLY_AVAILABLE',
  // },
];

export const belongOptions = [
  {
    label: getIntl().formatMessage({ id: 'common.all' }),
    value: AllKeyValue,
  },
  {
    label: getIntl().formatMessage({ id: 'digitalEmployees.filter.belong.company' }),
    value: 'COMPANY',
  },
  {
    label: getIntl().formatMessage({ id: 'digitalEmployees.filter.belong.dept' }),
    value: DeptKeyValue,
  },
  // {
  //   label: getIntl().formatMessage({ id: 'digitalEmployees.filter.belong.custom' }),
  //   value: CustomKeyValue,
  // },
];

export const getDefaultParams = (defaultParam: Partial<IOnOkParams> = {}) => {
  return {
    status: get(statusOptions, '0.value'),
    belong: get(belongOptions, '1.value'),
    customBelong: [],
    deptBelong: [],
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

const AllEmployessFilter = ({
  onOk,
  defaultParam,
}: {
  onOk: (param: IOnOkParams) => void;
  defaultParam: IOnOkParams;
}) => {
  const intl = useIntl();
  const [filterParam, setFilterParam] = React.useReducer(filterReducer, getDefaultParams(defaultParam));
  const [showOrgModal, setShowOrgModal] = React.useState(false);
  const [showPersonnelModel, setShowPersonnelModel] = React.useState(false);

  const {
    status: filterStatus,
    belong: filterBelong,
    customBelong: personalSelectValue,
    deptBelong: deptSelectValue,
  } = filterParam;

  return (
    <>
      <div className={classnames(styles.container, 'ub gap16 ub-ver')}>
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
                      status: item.value,
                    },
                  });
                }}
              >
                {item.label}
              </div>
            ))}
          </div>
        </div>
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
                }}
              >
                {item.label}
              </div>
            ))}
          </div>
        </div>
        {filterBelong === DeptKeyValue && (
          <div
            className={classnames(styles.customFilter, 'ub ub-wrap gap8 pointer hideThumb')}
            onClick={() => {
              setShowOrgModal(true);
            }}
          >
            {isEmpty(deptSelectValue) && (
              <p style={{ color: '#ced3d9' }}>{intl.formatMessage({ id: 'digitalEmployees.filter.selectOrgScope' })}</p>
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
        {filterBelong === CustomKeyValue && (
          <div
            className={classnames(styles.customFilter, 'ub ub-wrap gap8 pointer hideThumb')}
            onClick={() => {
              setShowPersonnelModel(true);
            }}
          >
            {isEmpty(personalSelectValue) && (
              <p style={{ color: '#ced3d9' }}>
                {intl.formatMessage({ id: 'digitalEmployees.filter.selectCustomScope' })}
              </p>
            )}
            {!isEmpty(personalSelectValue) &&
              personalSelectValue?.map((item) => {
                return (
                  <div key={item?.id} className={classnames(styles.listItem, 'ub ub-ac gap6')}>
                    <RightItemRender item={item} />
                    <CloseOutlined
                      className={classnames(styles.closeBtn, 'pointer')}
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();

                        const myPersonalSelectValue = [...personalSelectValue];
                        pullAllBy(myPersonalSelectValue, [item], 'id');
                        setFilterParam({
                          type: 'update',
                          item: {
                            customBelong: myPersonalSelectValue,
                          },
                        });
                      }}
                    />
                  </div>
                );
              })}
          </div>
        )}
        <div className="ub ub-ac ub-pe gap8">
          <Button
            size="small"
            onClick={() => {
              setFilterParam({
                type: 'update',
                item: {
                  status: AllKeyValue,
                  belong: AllKeyValue,
                  customBelong: [],
                },
              });
            }}
          >
            {intl.formatMessage({ id: 'common.reset' })}
          </Button>
          <Button
            size="small"
            type="primary"
            onClick={() => {
              onOk({
                status: filterStatus,
                belong: filterBelong,
                customBelong: personalSelectValue,
                deptBelong: deptSelectValue,
              });
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
              customBelong: vals || [],
            },
          });
        }}
        confirmLoading={false}
        selectedValue={personalSelectValue}
        disabledList={[dataItemTypeMap.user, dataItemTypeMap.agent]}
        searchTypeMapList={[searchTypeMap.org]}
        maxSelectCount={null}
      />
      <MyOrgSelect
        open={showOrgModal}
        onClose={() => setShowOrgModal(false)}
        selecteValue={deptSelectValue}
        onOK={(vals: IOrgCache[]) => {
          setFilterParam({
            type: 'update',
            item: {
              deptBelong: vals || [],
            },
          });
        }}
      />
    </>
  );
};

export default AllEmployessFilter;
