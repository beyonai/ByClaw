import React, { memo, useEffect, useState } from 'react';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { useDispatch, useIntl, useNavigate, useSearchParams } from '@umijs/max';
import { Button, Input, Space, Spin, Tabs } from 'antd';
import { trim, debounce, noop } from 'lodash';
import useGlobal from '@/hooks/useGlobal';
import AllDigitalEmployees from './components/AllDigitalEmployees';
import EmployeeRelatedToMe from './components/EmployeeRelatedToMe';
import ResourceFilter, { IOnOkParams, getDefaultParams } from '@/components/Resources/components/ResourceFilter';
import EmployFormModal from '@/pages/manager/pages/digitalEmployeeMgr/components/EmployFormModal';

import classnames from 'classnames';

import styles from './index.module.less';

const buildDigitalEmployeeFilterParam = (_activeTab: string, filterParam?: IOnOkParams) => {
  const params: Record<string, any> = {};

  if (filterParam?.resourceStatus === '') {
    params.includeAllResourceStatus = true;
  } else if (filterParam?.resourceStatus !== undefined) {
    params.resourceStatus = filterParam.resourceStatus;
  }

  if (filterParam?.permission) {
    params.permission = filterParam.permission;
  }

  // 注："归属"控件已被 ResourceFilter 中 SHOW_BELONG_FILTER 暂时隐藏，
  // 故 belong / orgFilters 不再透传后端，避免无意义的死字段。

  return params;
};

const DigitalEmployeesPage: React.FC = () => {
  const intl = useIntl();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { EventEmitter } = useGlobal();
  const [searchParams, setSearchParams] = useSearchParams();

  const [isLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<string>(() => {
    const tabFromUrl = searchParams.get('tab');
    return tabFromUrl === 'personal' || tabFromUrl === 'enterprise' || tabFromUrl === 'skillSquare'
      ? tabFromUrl
      : 'personal';
  });
  const [keywords, setKeywords] = useState<Record<string, string>>({});
  const [dropdownParam, setDropdownParam] = useState<IOnOkParams>(getDefaultParams());
  const [employeeModalOpen, setEmployeeModalOpen] = useState(false);

  const AllDigitalEmployeesRef = React.useRef<any>(null);
  const EmployeeRelatedToMeRef = React.useRef<any>(null);
  const SkillSquareRef = React.useRef<any>(null);

  // 监听引导模式事件
  useEffect(() => {
    const handleGuideFindTabEnter = (data: { key: string }) => {
      if (data.key) {
        setActiveTab(data.key);
      }
    };

    EventEmitter.on('guide-find-tab-enter', handleGuideFindTabEnter);

    return () => {
      EventEmitter.off('guide-find-tab-enter', handleGuideFindTabEnter);
    };
  }, [EventEmitter]);

  useEffect(() => {
    const tabFromUrl = searchParams.get('tab');
    if (
      (tabFromUrl === 'personal' || tabFromUrl === 'enterprise' || tabFromUrl === 'skillSquare') &&
      tabFromUrl !== activeTab
    ) {
      setActiveTab(tabFromUrl);
    }
  }, [activeTab, searchParams]);

  useEffect(() => {
    const nextSearchParams = new URLSearchParams(searchParams);
    if (nextSearchParams.get('tab') !== activeTab) {
      nextSearchParams.set('tab', activeTab);
      setSearchParams(nextSearchParams);
    }
  }, [activeTab, searchParams, setSearchParams]);

  const getSearch = React.useCallback(
    debounce((otherParam?: any) => {
      if (activeTab === 'personal') {
        return EmployeeRelatedToMeRef.current?.getSearch?.(keywords.personal, otherParam || dropdownParam);
      }
      if (activeTab === 'enterprise') {
        return AllDigitalEmployeesRef.current?.getSearch?.(keywords.enterprise, otherParam || dropdownParam);
      }
      if (activeTab === 'skillSquare') {
        return SkillSquareRef.current?.getSearch?.(keywords.skillSquare);
      }
      return noop;
    }, 500),
    [activeTab, keywords, dropdownParam]
  );

  useEffect(() => {
    const handleRefreshList = () => {
      getSearch();
    };
    EventEmitter.on('digitalEmployees-refresh-list', handleRefreshList);
    return () => {
      EventEmitter.off('digitalEmployees-refresh-list', handleRefreshList);
    };
  }, [EventEmitter, getSearch]);

  useEffect(() => {
    dispatch({
      type: 'employees/getAllDigitalEmployees',
    });
  }, []);

  const tabBarExtraContent = (
    <Space>
      <ResourceFilter
        onOk={(param: any) => {
          setDropdownParam(param);
          getSearch(param);
        }}
        defaultParam={dropdownParam}
        activeTab={activeTab}
      />
      <Input
        suffix={
          <SearchOutlined
            onClick={() => {
              getSearch();
            }}
          />
        }
        placeholder={intl.formatMessage({ id: 'common.inputKeyword' })}
        className={styles.searchInput}
        onChange={(e) => {
          setKeywords({ ...keywords, [activeTab]: trim(e.target.value) });
        }}
        value={keywords[activeTab] ?? ''}
        onPressEnter={() => {
          // debugger;
          getSearch();
        }}
      />
      <Button
        type="primary"
        icon={<PlusOutlined />}
        onClick={() => {
          if (activeTab === 'enterprise') {
            setEmployeeModalOpen(true);
            return;
          }

          const searchParams = new URLSearchParams({
            ownerType: activeTab,
          });
          const selectedCatalogId = EmployeeRelatedToMeRef.current?.getCurrentCatalogId?.();
          if (selectedCatalogId) {
            searchParams.set('catalogId', `${selectedCatalogId}`);
          }

          sessionStorage.setItem('EmployeeDetail_prevRoute', `${window.location.pathname}${window.location.search}`);
          navigate(`/digitalEmployeesCreate?${searchParams.toString()}`);
        }}
        id="guideStep2-6"
      >
        {activeTab === 'personal'
          ? intl.formatMessage({ id: 'digitalEmployees.createPersonal' })
          : intl.formatMessage({ id: 'digitalEmployees.create' })}
      </Button>
    </Space>
  );

  return (
    <div className={classnames(styles.container, 'full-height ub ub-ver')}>
      <Spin
        spinning={isLoading}
        wrapperClassName={styles.spinningWrapper}
        tip={intl.formatMessage({ id: 'common.loading' })}
      >
        <Tabs
          className={classnames(styles.tabs, 'full-height')}
          activeKey={activeTab}
          tabBarExtraContent={tabBarExtraContent}
          onChange={(key) => {
            const nextTab = key;
            const nextSearchParams = new URLSearchParams(searchParams);
            setDropdownParam(getDefaultParams());
            nextSearchParams.set('tab', nextTab);
            setActiveTab(nextTab);
            setSearchParams(nextSearchParams);
          }}
        >
          <Tabs.TabPane tab={intl.formatMessage({ id: 'digitalEmployees.myCreations' })} key="personal">
            <EmployeeRelatedToMe
              searchName={keywords.personal}
              dropdownParam={dropdownParam}
              buildFilterParam={buildDigitalEmployeeFilterParam}
              ref={EmployeeRelatedToMeRef}
            />
          </Tabs.TabPane>
          <Tabs.TabPane tab={intl.formatMessage({ id: 'digitalEmployees.employeeMarket' })} key="enterprise">
            <AllDigitalEmployees
              searchName={keywords.enterprise}
              dropdownParam={dropdownParam}
              buildFilterParam={buildDigitalEmployeeFilterParam}
              ref={AllDigitalEmployeesRef}
            />
          </Tabs.TabPane>
        </Tabs>
      </Spin>
      <EmployFormModal
        open={employeeModalOpen}
        type="add"
        catalogId={AllDigitalEmployeesRef.current?.getCurrentCatalogId?.()}
        onCancel={() => setEmployeeModalOpen(false)}
        reload={getSearch}
      />
    </div>
  );
};

const DigitalEmployeesPageMemo = memo(DigitalEmployeesPage);

export default function () {
  return (
    <div style={{ height: 'calc(100vh - 16px)' }}>
      <DigitalEmployeesPageMemo />
    </div>
  );
}
