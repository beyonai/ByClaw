import React, { useEffect, useMemo, useRef, useState } from 'react';

import { SearchOutlined } from '@ant-design/icons';
// @ts-ignore
import { useIntl, useNavigate, useSearchParams } from '@umijs/max';
import type { TabsProps } from 'antd';
import { Button, Input } from 'antd';

import AntdIcon from '@/components/AntdIcon';
import CommonTabs from '@/components/CommonTabs';
import useKnowledgeStore from '@/models/useKnowledgeStore';
import { queryKnowledgeCapability, type KnowledgeCapability } from '@/service/knowledgeCenter';
import AddFolderModal from './components/AddFolderModal';
import BaseInfo from './components/BaseInfo';
import UploadFile from './components/UploadFile';
import DirectoryManage, { DirectoryManageRef } from './DirectoryManage';
import { PermissionManageRef } from './PermissionManage';
import { ResourceTypeMap } from '@/constants/resource';

import styles from './index.module.less';

const KnowledgeDetail: React.FC = () => {
  // 获取路由参数
  const [searchParams] = useSearchParams();
  const resourceId = searchParams.get('resourceId');
  const resourceBizType = searchParams.get('resourceBizType');
  const resourceSourcePkId = searchParams.get('resourceSourcePkId');
  const fromTab = searchParams.get('fromTab');
  const knowledgeCenterBackPath =
    fromTab === 'enterprise' || fromTab === 'personal' ? `/knowledgeCenter?tab=${fromTab}` : '/knowledgeCenter';

  const intl = useIntl();
  const navigate = useNavigate();

  const [tabKey, setTabKey] = useState('directoryManage');
  const [searchValue, setSearchValue] = useState<string>('');
  // 新建文件夹弹窗
  const [showAddFolder, setShowAddFolder] = useState(false);
  const [baseInfo, setBaseInfo] = useState<any>({});
  const [uploadLoading, setUploadLoading] = useState(false);
  const [knowledgeCapability, setKnowledgeCapability] = useState<KnowledgeCapability | null>(null);

  const { queryResourceDetail } = useKnowledgeStore();

  const directoryRef = useRef<DirectoryManageRef>(null);
  const permissionRef = useRef<PermissionManageRef>(null);

  const [folderPath, setFolderPath] = useState([
    { id: '-1', title: intl.formatMessage({ id: 'directoryManage.allFiles' }) },
  ]);

  const uploadDirectoryPath = useMemo(() => {
    const segments = folderPath
      .slice(1)
      .map((seg) => String(seg.title ?? '').trim())
      .filter(Boolean);
    if (segments.length === 0) return '/';
    return `/${segments.join('/')}`;
  }, [folderPath]);

  useEffect(() => {
    setBaseInfo({});
    setFolderPath([{ id: '-1', title: intl.formatMessage({ id: 'directoryManage.allFiles' }) }]);

    if (resourceId) {
      queryResourceDetail({
        resourceId,
        resourceBizType,
        resourceSourcePkId,
      }).then((res) => {
        if (res) {
          setBaseInfo(res);
        }
      });
    }
  }, [intl, queryResourceDetail, resourceId, resourceBizType, resourceSourcePkId]);

  useEffect(() => {
    queryKnowledgeCapability()
      .then((res: any) => {
        setKnowledgeCapability(res?.data || res || null);
      })
      .catch(() => {
        setKnowledgeCapability({
          knowledgeMode: 'THIRD_PARTY',
          allowKnowledgeBaseCreate: false,
          allowKnowledgeBaseEdit: false,
          allowKnowledgeBaseDelete: false,
          allowKnowledgeImport: true,
        });
      });
  }, []);

  const items: TabsProps['items'] = [
    {
      key: 'directoryManage',
      label: intl.formatMessage({ id: 'knowledgeDetail.directory' }),
      children: (
        <DirectoryManage
          ref={directoryRef}
          searchValue={searchValue}
          baseInfo={baseInfo}
          setShowAddFolder={setShowAddFolder}
          uploadLoading={uploadLoading}
          setUploadLoading={setUploadLoading}
          folderPath={folderPath}
          setFolderPath={setFolderPath}
        />
      ),
    },
    // {
    //   key: 'permissionManage',
    //   label: intl.formatMessage({ id: 'knowledgeDetail.permission' }),
    //   children: <PermissionManage ref={permissionRef} searchValue={searchValue} baseInfo={baseInfo} />,
    // },
  ];

  return (
    <div className={styles.knowledgeDetailContainer}>
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 26,
          zIndex: 2,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          cursor: 'pointer',
        }}
        onClick={() => {
          navigate(knowledgeCenterBackPath);
        }}
      >
        <AntdIcon type="icon-a-Leftzuo" style={{ fontSize: 20 }} />
        {intl.formatMessage({ id: 'layout.back' })}
      </div>
      <BaseInfo
        data={baseInfo}
        resourceId={resourceId || ''}
        allowKnowledgeBaseDelete={knowledgeCapability?.allowKnowledgeBaseDelete}
        backPath={knowledgeCenterBackPath}
      />
      <div className={styles.tabsContainer}>
        <CommonTabs
          activeKey={tabKey}
          onChange={(key) => setTabKey(key)}
          items={items}
          className="full-width full-height"
          tabBarExtraContent={{
            right: (
              <div className={styles.tabsRight}>
                <Input
                  value={searchValue}
                  placeholder={intl.formatMessage(
                    { id: 'common.searchPlaceholder' },
                    {
                      content: intl.formatMessage({
                        id: 'knowledgeDetail.keywords',
                      }),
                    }
                  )}
                  suffix={<SearchOutlined />}
                  onChange={(e) => {
                    setSearchValue(e.target.value);
                  }}
                  onPressEnter={() => {
                    if (tabKey === 'directoryManage') {
                      directoryRef.current?.getDirectoryList({
                        pageIndex: 1,
                        name: searchValue,
                      });
                    } else {
                      permissionRef.current?.getPermissionList({
                        pageIndex: 1,
                        keyWord: searchValue,
                      });
                    }
                  }}
                />
                {tabKey === 'directoryManage' && (
                  <>
                    {resourceBizType !== ResourceTypeMap.knowledgeBaseQa &&
                      resourceBizType !== ResourceTypeMap.knowledgeBaseTerm && (
                      <Button
                        icon={<AntdIcon type="icon-a-Folder-pluswenjianjia-tianjia" style={{ fontSize: 18 }} />}
                        onClick={() => setShowAddFolder(true)}
                      >
                        {intl.formatMessage({ id: 'knowledgeDetail.newFolder' })}
                      </Button>
                    )}
                    <UploadFile
                      baseInfo={baseInfo}
                      uploadLoading={uploadLoading}
                      setUploadLoading={setUploadLoading}
                      reload={() => {
                        directoryRef.current?.getDirectoryList({
                          pageIndex: 1,
                        });
                      }}
                      directoryPath={uploadDirectoryPath}
                    />
                  </>
                )}
              </div>
            ),
          }}
        />
      </div>
      {showAddFolder && (
        <AddFolderModal
          baseInfo={baseInfo}
          onCancel={() => setShowAddFolder(false)}
          reload={() => {
            directoryRef.current?.getDirectoryList({ pageIndex: 1 });
          }}
          parentDirectoryPath={uploadDirectoryPath}
        />
      )}
    </div>
  );
};

export default KnowledgeDetail;
