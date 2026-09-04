/* eslint-disable no-spaced-func */
/* eslint-disable func-call-spacing */
/* eslint-disable indent */

import React, { useState, Suspense, useRef, useEffect, createContext } from 'react';
import { SearchOutlined } from '@ant-design/icons';
// @ts-ignore
import { useIntl, useLocation, useNavigate } from '@umijs/max';
import { Input, Tabs } from 'antd';
import classNames from 'classnames';
import { trim, get } from 'lodash';

import AntdIcon from '@/components/AntdIcon';

import AllEmployees from './components/AllEmployees';
import FrequentEmployess from './components/FrequentEmployess';
import LateEmployess from './components/LateEmployess';

import { chatModeMap } from '@/constants/query';

import styles from './index.module.less';
import { IAgentCache } from '@/typescript/agent';

export const isInputMode = (chatMode?: (typeof chatModeMap)[keyof typeof chatModeMap]) => {
  if (!chatMode) return false;
  return chatMode === chatModeMap.expert;
};

export const EmployeeListContext = createContext<{
  chatMode?: (typeof chatModeMap)[keyof typeof chatModeMap];
}>({});

export interface EmployeeListProps {
  chatMode?: (typeof chatModeMap)[keyof typeof chatModeMap];
  style?: React.CSSProperties;
  onSelect?: (employee: any) => void;
  keyword?: string;
  renderActionIcon?: (employee: IAgentCache) => React.ReactNode;

  /** 输入框中已 @ 的数字员工标识，候选列表不再重复展示。 */
  excludedAgentIds?: string[];

  /** 隐藏全部/常用/最近分类，仅展示搜索框和员工列表。 */
  hideCategoryTabs?: boolean;

  /** 紧凑员工卡片内容间距，供输入框资源选择面板使用。 */
  compactCard?: boolean;

  /** 在资源选择面板中同时展示数字员工组。 */
  includeEmployeeGroups?: boolean;
}

export const isExcludedEmployee = (employee: IAgentCache, excludedAgentIds: string[] = []) => {
  const excludedIds = new Set(excludedAgentIds.filter(Boolean).map((item) => `${item}`));
  return [employee.agentId, employee.resourceId, employee.resourceCode, employee.id]
    .filter(Boolean)
    .some((item) => excludedIds.has(`${item}`));
};

const getSelectItems = (intl: ReturnType<typeof useIntl>) => [
  {
    label: intl.formatMessage({ id: 'employeeList.all' }),
    value: 'all',
    Comp: AllEmployees,
  },
  {
    label: intl.formatMessage({ id: 'employeeList.frequent' }),
    value: 'frequent',
    Comp: FrequentEmployess,
  },
  {
    label: intl.formatMessage({ id: 'employeeList.recent' }),
    value: 'late',
    Comp: LateEmployess,
  },
];

const EmployeeList: React.FC<EmployeeListProps> = (props) => {
  const { chatMode, style, keyword, hideCategoryTabs = false, compactCard = false } = props;

  const intl = useIntl();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const CompRef = useRef<any>({});
  const isFirstRender = useRef(true);
  const searchDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const SelectItems = React.useMemo(() => getSelectItems(intl), [intl]);

  const isInput = isInputMode(chatMode);
  const isDigitalEmployeesPage = pathname.startsWith('/digitalEmployees');

  const [searchName, setSearchName] = useState(() => {
    const s: Record<string, string> = {};
    SelectItems.forEach((item) => {
      s[item.value] = '';
    });

    return s;
  });
  const [selectedKeys, setSelectedKeys] = useState(get(SelectItems, '0.value'));

  const getSearch = () => {
    const comp = CompRef.current?.[selectedKeys];
    if (comp && typeof comp.getSearch === 'function') {
      comp.getSearch(searchName[selectedKeys]);
    }
  };

  useEffect(() => {
    if (keyword !== undefined) {
      setSearchName(
        SelectItems.reduce((acc, item) => {
          acc[item.value] = keyword;
          return acc;
        }, {} as Record<string, string>)
      );
      if (!isFirstRender.current || keyword) {
        const comp = CompRef.current?.[selectedKeys];
        if (comp && typeof comp.getSearch === 'function') {
          comp.getSearch(keyword);
        }
      }
    }
    isFirstRender.current = false;
  }, [keyword, selectedKeys]);

  useEffect(
    () => () => {
      if (searchDebounceTimerRef.current) {
        clearTimeout(searchDebounceTimerRef.current);
        searchDebounceTimerRef.current = null;
      }
    },
    []
  );

  return (
    <div
      className={classNames(styles.employeesSider, styles.list, { [styles.compactCard]: compactCard })}
      style={style}
    >
      {!isInput && (
        <div className="ub ub-ac gap12">
          <div
            className={classNames(styles.discoverAgent, 'ub ub-ac ub-pj pointer mb-8 gap2')}
            style={{ background: 'linear-gradient(90deg, #3150ff0f 0%, #c067ff0f 100%)' }}
            onClick={() =>
              navigate(
                isDigitalEmployeesPage
                  ? {
                      pathname: '/chat',
                    }
                  : '/digitalEmployees',
                isDigitalEmployeesPage ? { state: { keepSiderActiveKey: 'agent' } } : undefined
              )
            }
          >
            <AntdIcon className={classNames('mr-6', styles.icon)} type="icon-faxian" />
            <span style={{ fontWeight: 'bold', fontSize: 13 }}>{intl.formatMessage({ id: 'sider.findAgent' })}</span>
            <AntdIcon
              type={isDigitalEmployeesPage ? 'icon-a-Leftzuo' : 'icon-a-Rightyou'}
              style={{ fontSize: 16, marginLeft: 'auto' }}
            />
          </div>
        </div>
      )}
      <div className="ub-ac gap8 mb-8" style={{ display: 'flex' }}>
        <Input
          value={searchName[selectedKeys]}
          suffix={<SearchOutlined onClick={() => getSearch()} />}
          placeholder={intl.formatMessage(
            {
              id: 'form.inputPlaceholder',
            },
            {
              content: intl.formatMessage({
                id: 'knowledgeDetail.keywords',
              }),
            }
          )}
          onChange={(e) => {
            const nextSearchName = trim(e.target.value);
            setSearchName((prev) => {
              return {
                ...prev,
                [selectedKeys]: nextSearchName,
              };
            });
            // 用户继续编辑 @ 带入的关键词时自动防抖搜索，避免每次按键都立即请求。
            if (searchDebounceTimerRef.current) {
              clearTimeout(searchDebounceTimerRef.current);
            }
            searchDebounceTimerRef.current = setTimeout(() => {
              const comp = CompRef.current?.[selectedKeys];
              if (comp && typeof comp.getSearch === 'function') {
                comp.getSearch(nextSearchName);
              }
              searchDebounceTimerRef.current = null;
            }, 400);
          }}
          onPressEnter={() => getSearch()}
        />
      </div>
      {!hideCategoryTabs && !isInput && (
        <div className="ub-ac gap8 mb-8" style={{ display: 'flex' }}>
          {SelectItems.map((item) => {
            return (
              <div
                className={classNames(styles.typeItem, {
                  [styles.active]: selectedKeys === item.value,
                })}
                onClick={() => setSelectedKeys(item.value)}
                key={item.value}
              >
                {item.label}
              </div>
            );
          })}
        </div>
      )}
      <div id="guideStep2-3" className="ub-f1 ub ub-ver">
        <EmployeeListContext.Provider value={{ chatMode }}>
          <Tabs activeKey={selectedKeys} tabBarStyle={{ display: 'none' }} className={classNames('full-height')}>
            {SelectItems.map((item) => {
              const { value, Comp } = item;
              return (
                <Tabs.TabPane key={value} tabKey={value}>
                  <Suspense fallback="loading...">
                    <Comp
                      {...props}
                      searchName={searchName[value]}
                      ref={(ref) => {
                        CompRef.current[value] = ref;
                      }}
                    />
                  </Suspense>
                </Tabs.TabPane>
              );
            })}
          </Tabs>
        </EmployeeListContext.Provider>
      </div>
    </div>
  );
};

export default EmployeeList;
