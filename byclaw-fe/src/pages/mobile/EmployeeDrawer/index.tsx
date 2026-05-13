import React, { useEffect, useMemo, useState } from 'react';
// @ts-ignore
import { useDispatch, useSelector } from '@umijs/max';
import { Drawer, Button, Tabs, Spin } from 'antd';
import classnames from 'classnames';
import { compact, get, head, isEmpty, reduce } from 'lodash';

import { agentHandler } from '@/utils/agent';
import { dataItemTypeMap } from '@/components/PersonnelModel/const';
import AvatarCardItem from './AvatarCardItem';
import {
  IOnOkParams,
  CustomKeyValue,
  DeptKeyValue,
  AllKeyValue,
} from '@/pages/digitalEmployees/components/AllEmployessFilter';
import { getAllDigitalEmployeesV2 } from '@/service/digitalEmployees';
import Empty from '@/components/Empty';

import { IAgentCache, IAgent } from '@/typescript/agent';
import useGlobal from '@/hooks/useGlobal';
import { ArrowLeftOutlined, SearchOutlined } from '@ant-design/icons';

import styles from './index.module.less';

export const disableActionList: string[] = ['delete', 'unapply'];

type ICategory = {
  dirName: string;
  catalogId: number;
};

type IProps = {
  open: boolean;
  onClose: () => void;
  searchName?: string;
  applyStatus?: IOnOkParams;
};

const emptyApplyStatus: IOnOkParams = {
  status: AllKeyValue,
  belong: AllKeyValue,
};

export default function EmployeeDrawer(props: IProps) {
  const { open, onClose, searchName = '', applyStatus = emptyApplyStatus } = props;

  const dispatch = useDispatch();

  const { EventEmitter } = useGlobal();

  const abortControllerRef = React.useRef<AbortController>(null);

  const { employeesTypeList } = useSelector(({ employees }) => ({
    ...employees,
  }));

  const [curActiveLink, setCurActiveLink] = useState<string>('');
  const [sortType] = useState('focus');
  const [list, setList] = useState<IAgentCache[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // 创建按类别分组的员工数据
  const employeesByCategory = useMemo(() => {
    if (isEmpty(employeesTypeList)) return {};
    return reduce(
      employeesTypeList,
      (acc: any, category: any) => {
        acc[category.catalogId] = [...(list || [])].filter((employee: IAgentCache) => {
          if (employee.terminal && !['ALL', 'APP'].includes(employee.terminal)) {
            return false;
          }
          return `${employee.catalogId}` === `${category.catalogId}`;
        });
        return acc;
      },
      {} as Record<string, typeof list>
    );
  }, [list, employeesTypeList]);

  const myEmployeesTypeList = useMemo((): ICategory[] => {
    const keys = Object.keys(employeesByCategory);

    const res: any[] = [];
    keys.forEach((key) => {
      const l: any[] = get(employeesByCategory, key) || [];

      if (isEmpty(l)) return;

      const idx = employeesTypeList.findIndex((i: any) => `${i.catalogId}` === `${key}`);
      res[idx] = employeesTypeList[idx];
    });

    return compact(res);
  }, [employeesTypeList, employeesByCategory]);

  const myGetAllDigitalEmployeesV2 = React.useCallback(
    (searchName: string = '', applyStatus: IOnOkParams, orderField: string) => {
      const orgFilters = [];

      if (applyStatus.belong === DeptKeyValue || applyStatus.belong === CustomKeyValue) {
        let belongList: any[] = [];

        if (applyStatus.belong === DeptKeyValue) {
          belongList = applyStatus?.deptBelong || [];
        }
        if (applyStatus.belong === CustomKeyValue) {
          belongList = applyStatus?.customBelong || [];
        }

        orgFilters.push(
          ...compact(
            belongList.map((item) => {
              const payload = {
                type: applyStatus.belong,
              };
              if (item.type === dataItemTypeMap.org) {
                Object.assign(payload, {
                  objectId: item.orgId,
                  objectType: dataItemTypeMap.org,
                });
                return payload;
              }
              if (item.type === dataItemTypeMap.user) {
                Object.assign(payload, {
                  objectId: item.userId,
                  objectType: dataItemTypeMap.user,
                });
                return payload;
              }
              return null;
            }) || []
          )
        );
      } else {
        orgFilters.push({
          type: applyStatus.belong,
        });
      }

      if (abortControllerRef.current && !abortControllerRef.current?.signal?.aborted) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();

      return getAllDigitalEmployeesV2(
        {
          terminals: ['ALL', 'APP'], // 终端类型
          pageNum: 1, // 页码
          pageSize: 9999, // 页面大小
          keyword: searchName, // 关键字搜索
          catalogId: null, // 目录标识
          metaStatus: applyStatus.status, // 状态搜索
          orgFilters, // 组织归属维度
          orderField,
          orderBy: 'desc',
        },
        abortControllerRef.current
      ).then((res) => {
        setList(
          res?.list?.filter?.((item: IAgentCache) => !item.agentHomeUrl)?.map?.((item: IAgent) => agentHandler(item)) ||
            []
        );
      });
    },
    []
  );

  const getSearch = React.useCallback(
    (searchName: string = '', applyStatus: IOnOkParams, orderField: string = sortType) => {
      setIsLoading(true);

      return Promise.all([
        dispatch({
          type: 'employees/getDigitEmployDir',
        }),
        myGetAllDigitalEmployeesV2(searchName, applyStatus, orderField),
      ]).finally(() => {
        setIsLoading(false);
      });
    },
    [sortType]
  );

  useEffect(() => {
    const firstEmployeesType = head(myEmployeesTypeList);
    if (!firstEmployeesType) return;

    setCurActiveLink(`${firstEmployeesType?.catalogId}`);
  }, [myEmployeesTypeList]);

  useEffect(() => {
    const handler = (param: { unApplyList?: string[]; ApplyList?: string[] }) => {
      const { unApplyList = [], ApplyList = [] } = param || {};

      setList((prevList) => {
        return [
          ...prevList.map((item: IAgentCache) => {
            if (ApplyList.includes(`${item.id}`)) {
              return {
                ...item,
                approveStatus: 'S',
              };
            }
            if (unApplyList.includes(`${item.id}`)) {
              return {
                ...item,
                approveStatus: '',
                grantType: undefined,
                authorizeMe: false,
              };
            }
            return item;
          }),
        ];
      });
    };
    EventEmitter.on('beyond-update-employee', handler);
    return () => {
      EventEmitter.off('beyond-update-employee', handler);
    };
  }, [EventEmitter]);

  useEffect(() => {
    getSearch(searchName, applyStatus, sortType);
  }, []);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Employees"
      placement="bottom"
      footer={null}
      height="100%"
      styles={{
        body: {
          padding: 0,
        },
        header: {
          display: 'none',
        },
      }}
    >
      <div className="ub ub-ver gap8 full-height">
        <div className={classnames(styles.header, 'ub ub-ac gap8')}>
          <Button icon={<ArrowLeftOutlined style={{ fontSize: '18px' }} />} onClick={onClose} type="text" />
          <div className={classnames(styles.title, 'ellipsis ub-f1')}>数字员工</div>
          <Button icon={<SearchOutlined style={{ fontSize: '18px' }} />} type="text" style={{ visibility: 'hidden' }} />
        </div>
        <div className="ub-f1">
          <Spin spinning={isLoading} wrapperClassName={styles.spin}>
            <div className="full-height full-width ub ub-ver gap8">
              <div className="ub ub-ac gap8 full-width" style={{ padding: '0 16px' }}>
                <Tabs
                  className={classnames('ub-f1', styles.tabs)}
                  activeKey={curActiveLink}
                  items={myEmployeesTypeList.map((_) => {
                    return {
                      label: _.dirName,
                      key: `${_.catalogId}`,
                    };
                  })}
                  onChange={(activeKey) => {
                    setCurActiveLink(`${activeKey}`);
                  }}
                />
              </div>
              <div className="overflow-auto hideThumb ub-f1">
                {isEmpty(get(employeesByCategory, curActiveLink, [])) ? (
                  <div className="full-height full-width ub ub-ac ub-pc">
                    <Empty />
                  </div>
                ) : (
                  get(employeesByCategory, curActiveLink, []).map((employee: IAgentCache) => {
                    return <AvatarCardItem key={employee.agentId} employee={employee} onClose={onClose} />;
                  })
                )}
              </div>
            </div>
          </Spin>
        </div>
      </div>
    </Drawer>
  );
}
