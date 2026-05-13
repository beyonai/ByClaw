import React, { useEffect, useState, useCallback, createContext } from 'react';
import { debounce } from 'lodash';
import { message, Radio } from 'antd';
import { useDispatch, useIntl } from '@umijs/max';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import OrganizationInfoModal from './components/OrganizationInfoModal';
import OrganizationTree from '@/pages/manager/components/OrganizationTree';
import OrganizationInfo from './OrganizationInfo';
import OrganizationMembers from './OrganizationMembers';
import KnowledgeBaseAuthor from '@/pages/manager/components/KnowledgeBaseAuthor';
import DigitalEmployeeAuthor from '@/pages/manager/components/DigitalEmployeeAuthor';
import DataPermissionModal from './components/DataPermissionModal';
import styles from './index.module.less';

export const OrgMgrContext = createContext({});

const OrgMgr = () => {
  const dispatch = useDispatch();
  const intl = useIntl();

  const [selectedOrg, setSelectedOrg] = useState(null);
  const [visible, setVisible] = useState(false);
  const [type, setType] = useState('add');
  const [info, setInfo] = useState({});
  const [collapsed, setCollapsed] = useState(false);
  const [treeData, setTreeData] = useState([]);
  const [searchValue, setSearchValue] = useState('');
  //  知识库弹窗
  const [baseVisible, setBaseVisible] = useState(false);
  // 数字员工弹窗
  const [employeeVisible, setEmployeeVisible] = useState(false);
  // 弹窗入参
  const [initParams, setInitParams] = useState({});
  // 数据权限详情
  const [redList, setRedList] = useState([]);
  // 数据权限
  const [dataPermissionVisible, setDataPermissionVisible] = useState(false);
  const [isMyOrg, setIsMyOrg] = useState(false); // 是否勾选我的
  const [canEdit, setCanEdit] = useState(false);

  const [activeTab, setActiveTab] = useState('org');
  const [userInfo, setUserInfo] = useState({ orgIds: [], userType: '' });

  const getIsOrgManager = useCallback(() => {
    setCanEdit(false);
    dispatch({
      type: 'orgMgr/getIsOrgManager',
      success: (res) => {
        const { data } = res || {};
        const { orgIds, userType } = data || {};
        setUserInfo({ orgIds, userType });
        if (
          userType === 'PLAT_MAN' ||
          userType === 'PLAT_DEVOPS' ||
          (orgIds && selectedOrg?.orgId && orgIds.includes(selectedOrg.orgId))
        ) {
          setCanEdit(true);
        }
      },
      fail: (res) => {
        message.warning(res?.msg);
      },
    });
  }, [dispatch, selectedOrg?.orgId]);

  const getTree = () => {
    dispatch({
      type: 'orgMgr/getOrgTree',
      payload: {
        keyword: searchValue,
        ...(searchValue?.length > 0 ? { containsParent: true } : {}),
        ...(isMyOrg ? { myFlag: 1 } : {}),
      },
      success: (res) => {
        const { data = [] } = res || {};
        setTreeData(Array.isArray(data) ? data : []);
        if (!selectedOrg?.orgId) {
          setSelectedOrg((Array.isArray(data) ? data : [])?.find((item) => item.parentOrgId === -1) || {});
        }
      },
      fail: (res) => {
        message.warning(res?.msg);
      },
    });
  };

  useEffect(() => {
    const debouncedFn = debounce(() => {
      getTree();
    }, 300);
    debouncedFn();
    return () => {
      debouncedFn.cancel(); // 如果使用 lodash 的 debounce
    };
  }, [searchValue, isMyOrg]);

  useEffect(() => {
    getIsOrgManager();
  }, [getIsOrgManager]);

  return (
    <OrgMgrContext.Provider
      value={{
        selectedOrg,
      }}
    >
      <div className={styles.container}>
        {!collapsed && (
          <div className={styles.sider}>
            {/* <div className={'ub ub-ac ub-pc'}>
              <Radio.Group
                onChange={(e) => {
                setActiveTab(e.target.value)
              }}
                value={activeTab}>
                <Radio.Button value="org">组织</Radio.Button>
                <Radio.Button value="post">岗位</Radio.Button>
                <Radio.Button value="member">员工</Radio.Button>
              </Radio.Group>
            </div> */}
            <div style={{ display: activeTab === 'org' ? 'block' : 'none' }} className="full-height">
              <OrganizationTree
                treeData={treeData}
                selectedOrg={selectedOrg}
                setSelectedOrg={setSelectedOrg}
                onSelect={(val) => {
                  const node = treeData.find((item) => item.orgId === val);
                  setSelectedOrg(node);
                }}
                canEdit={canEdit}
                setVisible={setVisible}
                setType={setType}
                setInfo={setInfo}
                getTree={getTree}
                setTreeData={(vals) => {
                  if (!vals.find((item) => item.orgId === selectedOrg?.orgId)) {
                    setSelectedOrg(vals?.find((item) => item.parentOrgId === -1) || {});
                  }
                  setTreeData(vals);
                }}
                setSearchValue={setSearchValue}
                onChange={(e) => setIsMyOrg(e.target.checked)}
              />
            </div>
          </div>
        )}
        <div className={styles.content}>
          <div className={styles.trigger} onClick={() => setCollapsed(!collapsed)}>
            <div className={styles.triggerTop} />
            <div
              style={{
                background: '#e6ebf0',
                height: 50,
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
              }}
            >
              {collapsed ? <RightOutlined /> : <LeftOutlined />}
            </div>
            <div className={styles.triggerBottom} />
          </div>
          <div className={styles.infoContainer}>
            <div className={styles.organization}>
              <OrganizationInfo
                selectedOrg={selectedOrg}
                setVisible={setVisible}
                setType={setType}
                setInfo={setInfo}
                treeData={treeData}
                // setBaseVisible={setBaseVisible}
                // setEmployeeVisible={setEmployeeVisible}
                // setInitParams={setInitParams}
                setRedList={setRedList}
                setDataPermissionVisible={setDataPermissionVisible}
              />
            </div>
            <div className={styles.member}>
              <OrganizationMembers
                selectedOrg={selectedOrg}
                record={info}
                setBaseVisible={setBaseVisible}
                setEmployeeVisible={setEmployeeVisible}
                setInitParams={setInitParams}
                canEdit={canEdit}
                userInfo={userInfo}
              />
            </div>
          </div>
        </div>
        {visible && (
          <OrganizationInfoModal
            visible={visible}
            type={type}
            record={info}
            onCancel={() => {
              setVisible(false);
            }}
            onOk={() => {
              setVisible(false);
              getTree();
              setSelectedOrg({ ...selectedOrg });
            }}
          />
        )}
        {baseVisible && (
          <KnowledgeBaseAuthor
            drawerTitle={intl.formatMessage({
              id: 'orgMgr.members.relatedResource',
            })}
            visible={baseVisible}
            initParams={initParams}
            onCancel={() => {
              setBaseVisible(false);
            }}
          />
        )}
        {employeeVisible && (
          <DigitalEmployeeAuthor
            drawerTitle={intl.formatMessage({
              id: 'orgMgr.members.relatedEmployee',
            })}
            visible={employeeVisible}
            initParams={initParams}
            onCancel={() => {
              setEmployeeVisible(false);
            }}
          />
        )}
        {/* 数据权限 */}
        {dataPermissionVisible && (
          <DataPermissionModal
            visible={dataPermissionVisible}
            redList={redList}
            selectedOrg={selectedOrg}
            onCancel={() => {
              setDataPermissionVisible(false);
            }}
          />
        )}
      </div>
    </OrgMgrContext.Provider>
  );
};

export default OrgMgr;
