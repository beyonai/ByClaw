import React, { useEffect, useState, useRef } from 'react';
import { useDispatch, useIntl } from '@umijs/max';
import { Button, Dropdown, Input, Tabs, Avatar } from 'antd';
import { head, get } from 'lodash';
import AntdIcon from '@/pages/manager/components/AntdIcon';
import AuthListDrawer from '@/pages/manager/components/AuthListDrawer';
import styles from './index.module.less';
import OrganizationMembersModal from '../components/OrganizationMembersModal';
import PersonalSelect from '../components/PersonalSelect';
import OrgMembers from './OrgMember';
import TreeFilter from '@/pages/manager/pages/OrgMgr/components/TreeFilter';
import FieldFilter from '@/pages/manager/pages/OrgMgr/components/TreeFilter/FieldFilter';
import SourceFilter from '@/pages/manager/pages/OrgMgr/components/TreeFilter/SourceFilter';
import NewResource from './NewResource';
import defResourceIcon from '@/pages/manager/assets/defResourceIcon.png';

const OrganizationMembers = ({ selectedOrg, setEmployeeVisible, setBaseVisible, setInitParams, canEdit, userInfo }) => {
  const dispatch = useDispatch();
  const intl = useIntl();
  const renderCountRef = useRef(0);

  const typeOptions = [
    {
      label: intl.formatMessage({ id: 'orgMgr.typeOptions.manage' }),
      key: 1,
      keypath: '1',
    },
    {
      label: intl.formatMessage({ id: 'orgMgr.typeOptions.use' }),
      key: 2,
      keypath: '2',
    },
  ];

  const emptyArr = [];

  // 成员信息弹窗
  const [visible, setVisible] = useState(false);
  const [type, setType] = useState('add');
  const [searchValue, setSearchValue] = useState('');
  const [selectValue, setSelectValue] = useState([head(typeOptions)]);
  const [info, setInfo] = useState({});
  // 角色列表
  const [roleList, setRoleList] = useState([]);
  // 岗位列表
  const [positionList, setPositionList] = useState([]);
  // 成员选择
  const [menberSelectVisible, setMenberSelectVisible] = useState(false);
  const [activeTab, setActiveTab] = useState('orgMember');
  const [authInfo, setAuthInfo] = useState({});
  const [authType, setAuthType] = useState();

  const [fieldSelect, setFieldSelect] = useState([]);
  const [sourceSelect, setSourceSelect] = useState([]);

  const orgMemberRef = useRef(null);
  const digitalEmpolyeeRef = useRef(null);
  const digitalResourceRef = useRef(null);

  renderCountRef.current += 1;

  const sourceValue = React.useMemo(() => {
    return sourceSelect.map((i) => i.key);
  }, [sourceSelect]);
  const fieldValue = React.useMemo(() => {
    return fieldSelect.map((i) => i.key);
  }, [fieldSelect]);

  const mySelectValue = React.useMemo(() => {
    return get(head(selectValue), 'key');
  }, [selectValue]);

  useEffect(() => {
    // 岗位
    dispatch({
      type: 'memberMgr/searchPositionList',
      payload: {
        pageNum: 1,
        pageSize: 999,
        keyword: '',
      },
      success: (res) => {
        const { rows = [] } = res?.data || {};
        setPositionList(rows);
      },
      fail: (res) => {
        window.console.warn(res?.msg || 'searchPositionList failed');
      },
    });
    // 角色
    dispatch({
      type: 'sessionMgr/getDcSystemConfigListByStandType',
      payload: { standType: 'USER_TYPE' },
    }).then((res) => {
      const resData = Array.isArray(res) ? res : res?.data;
      if (Array.isArray(resData)) {
        setRoleList(
          (resData || []).map((item) => ({
            ...item,
            standCode: item.standCode || item.paramValue || item.paramEnName,
            standDisplayValue: item.standDisplayValue || item.paramName || item.paramDesc,
          }))
        );
      } else {
        window.console.warn(res?.msg || 'get USER_TYPE config failed');
      }
    });
  }, [dispatch]);

  const handleSearch = () => {
    if (activeTab === 'orgMember') {
      orgMemberRef.current?.getUsersByOrgId({
        // keyword: searchValue,
        pageNum: 1,
      });
    } else {
      digitalResourceRef.current?.getListOwnResource({
        // resourceName: searchValue,
        pageNum: 1,
      });
    }
  };

  const sourceTypes = React.useMemo(() => {
    const types = emptyArr;

    if (activeTab === 'employee') {
      types.push('DIG_EMPLOYEE');
    }
    if (activeTab === 'knowledge') {
      types.push(...['KG_DOC', 'KG_QA', 'KG_TERM']);
    }
    if (activeTab === 'skill') {
      types.push(...['MCP', 'TOOL', 'TOOLKIT', 'AGENT']);
    }
    return types;
  }, [activeTab]);

  React.useEffect(() => {
    setSourceSelect([]);
  }, [sourceTypes, selectedOrg?.orgId]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.title}>
          <Tabs
            items={[
              {
                key: 'orgMember',
                label: intl.formatMessage({ id: 'orgMgr.members.title' }),
              },
              {
                key: 'employee',
                label: intl.formatMessage({ id: 'orgMgr.tabs.employee' }),
              },
              {
                key: 'knowledge',
                label: intl.formatMessage({ id: 'orgMgr.tabs.knowledge' }),
              },
              {
                key: 'tool',
                label: intl.formatMessage({ id: 'orgMgr.tabs.tool' }),
              },
              {
                key: 'view',
                label: intl.formatMessage({ id: 'orgMgr.tabs.view' }),
              },
              {
                key: 'object',
                label: intl.formatMessage({ id: 'orgMgr.tabs.object' }),
              },
            ]}
            onChange={(key) => {
              setActiveTab(key);
              setSearchValue('');
              setSelectValue([head(typeOptions)]);
            }}
          />
        </div>
        <div className={styles.btn}>
          {activeTab === 'orgMember' && (
            <Dropdown
              menu={{
                items: [
                  {
                    key: '1',
                    label: intl.formatMessage({
                      id: 'orgMgr.members.addCustom',
                    }),
                  },
                  {
                    key: '2',
                    label: intl.formatMessage({
                      id: 'orgMgr.members.addFromOrg',
                    }),
                  },
                ],
                onClick: ({ key }) => {
                  if (key === '1') {
                    setInfo({});
                    setVisible(true);
                    setType('add');
                  }
                  if (key === '2') {
                    setMenberSelectVisible(true);
                  }
                },
              }}
            >
              <Button icon={<AntdIcon type="icon-a-People-plustianjiarenqun" />} type="primary" className="ub ub-ac">
                {intl.formatMessage({ id: 'orgMgr.members.add' })}
              </Button>
            </Dropdown>
          )}
          <Input
            suffix={<AntdIcon type="icon-a-Searchsousuo" onClick={() => handleSearch()} />}
            style={{ width: 216 }}
            placeholder={intl.formatMessage({ id: 'orgMgr.members.search' })}
            value={searchValue}
            onChange={(e) => {
              setSearchValue(e.target.value);
            }}
            onPressEnter={() => handleSearch()}
          />
        </div>
      </div>
      {activeTab !== 'orgMember' && (
        <div className={styles.filter}>
          <TreeFilter
            title={intl.formatMessage({ id: 'orgMgr.filter.type' })}
            treeData={typeOptions}
            selectedList={selectValue}
            onOk={(v) => setSelectValue(v)}
            mode="radio"
          />
          <FieldFilter
            selectedList={fieldSelect}
            onOk={(v) => {
              setSourceSelect([]);
              setFieldSelect(v);
            }}
          />
          {/* <SourceFilter
              selectedList={sourceSelect}
              onOk={(v) => setSourceSelect(v)}
              sourceTypes={sourceTypes}
              catalogIds={fieldValue}
              orgId={selectedOrg?.orgId}
            /> */}
        </div>
      )}
      {activeTab === 'orgMember' && (
        <OrgMembers
          ref={orgMemberRef}
          selectedOrg={selectedOrg}
          setEmployeeVisible={setEmployeeVisible}
          setBaseVisible={setBaseVisible}
          setInitParams={setInitParams}
          searchValue={searchValue}
          setVisible={setVisible}
          info={info}
          setInfo={setInfo}
          setType={setType}
          roleList={roleList}
          positionList={positionList}
          canEdit={canEdit}
          userInfo={userInfo}
        />
      )}
      {activeTab !== 'orgMember' && (
        <NewResource
          ref={digitalResourceRef}
          selectedOrg={selectedOrg}
          searchValue={searchValue}
          setAuthType={setAuthType}
          setAuthInfo={setAuthInfo}
          canEdit={canEdit}
          selectValue={mySelectValue}
          fieldValue={fieldValue}
          sourceValue={sourceValue}
          activeTab={activeTab}
        />
      )}
      {visible && (
        <OrganizationMembersModal
          visible={visible}
          onCancel={() => {
            setVisible(false);
            setInfo({});
          }}
          selectedOrg={selectedOrg}
          type={type}
          record={info}
          positionList={positionList}
          onOk={() => {
            setVisible(false);
            orgMemberRef.current?.getUsersByOrgId({ pageNum: 1 });
          }}
          roleList={roleList}
        />
      )}
      {menberSelectVisible && (
        <PersonalSelect
          visible={menberSelectVisible}
          selectedOrg={selectedOrg}
          onCancel={() => {
            setMenberSelectVisible(false);
          }}
          reload={() => {
            orgMemberRef.current?.getUsersByOrgId();
          }}
          positionList={positionList}
          roleList={roleList}
        />
      )}
      {authType && (
        <AuthListDrawer
          record={authInfo}
          selectedOrg={selectedOrg}
          onCancel={() => setAuthType(undefined)}
          authType={authType}
          needCheckPublish={authType === 'useAuth'}
          headerInfo={
            authInfo?.digitalEmpolyee
              ? {
                title: authInfo.name,
                content: authInfo.intro,
                icon: (
                  <Avatar
                    size={32}
                    src={
                      authInfo?.avatar
                        ? `/aiFactoryServer${authInfo.avatar}`
                        : `${_PUBLIC_PATH_}image/head/small/head5.png`
                    }
                    style={{ marginRight: 8 }}
                  />
                ),
              }
              : {
                title: authInfo.resourceName,
                content: authInfo.description,
                icon: (
                  <img
                    src={authInfo?.resourceLogoUrl ? `/aiFactoryServer${authInfo.resourceLogoUrl}` : defResourceIcon}
                    alt="logo"
                    style={{ width: 32, height: 32, marginRight: 8 }}
                  />
                ),
              }
          }
          showBlack={authType === 'useAuth'}
          onlyView={authType === 'useAuth'}
          onlyUser={authType === 'mgrAuth'}
          showPost={false}
        />
      )}
    </div>
  );
};

export default OrganizationMembers;
