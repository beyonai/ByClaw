import React, { useState } from 'react';
import { Tabs } from 'antd';
import { DatabaseOutlined, ProductOutlined, ToolOutlined } from '@ant-design/icons';
// import { FolderOutlined } from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import AntdIcon from '@/components/AntdIcon';
import Resources from '@/components/Resources';
// import FilesPage from '@/pages/files';
import ModelsPage from '@/pages/models';
import styles from './index.module.less';

type ResourceTabKey = 'knowledge' | 'tool' | 'skill' | 'model';

const ResourceCenter: React.FC = () => {
  const intl = useIntl();
  const [activeKey, setActiveKey] = useState<ResourceTabKey>('skill');
  const [myResourcesOnly, setMyResourcesOnly] = useState(false);

  const items = [
    {
      key: 'skill',
      label: intl.formatMessage({ id: 'common.skill' }),
      icon: <ProductOutlined />,
    },
    {
      key: 'knowledge',
      label: intl.formatMessage({ id: 'resource.knowledge' }),
      icon: <DatabaseOutlined />,
    },
    {
      key: 'tool',
      label: intl.formatMessage({ id: 'common.tool' }),
      icon: <ToolOutlined />,
    },
    {
      key: 'model',
      label: intl.formatMessage({ id: 'common.model' }),
      icon: <AntdIcon type="icon-a-Braindanao" />,
    },
    // 资源中心暂时停用文件模块，保留入口配置以便后续恢复。
    // {
    //   key: 'file',
    //   label: intl.formatMessage({ id: 'common.file' }),
    //   icon: <FolderOutlined />,
    // },
  ];

  const renderActiveContent = () => {
    const myResourceProps = { myResourcesOnly, onMyResourcesOnlyChange: setMyResourcesOnly };
    if (activeKey === 'knowledge') return <Resources resourceType="KG_DOC" {...myResourceProps} />;
    if (activeKey === 'tool') return <Resources resourceType="TOOL" {...myResourceProps} />;
    if (activeKey === 'skill') return <Resources resourceType="SKILL" {...myResourceProps} />;
    if (activeKey === 'model') return <ModelsPage />;
    // 文件面板与入口一起停用，避免兜底分支继续挂载文件模块。
    // return <FilesPage />;
    return null;
  };

  return (
    <div className={styles.resourceCenter}>
      {/* 我的资源使用独立管理布局，返回全部后再展示资源类型切换。 */}
      {!myResourcesOnly && (
        <Tabs
          className={styles.resourceTabs}
          activeKey={activeKey}
          items={items}
          onChange={(key) => {
            const nextKey = key as ResourceTabKey;
            setActiveKey(nextKey);
            setMyResourcesOnly(false);
          }}
        />
      )}
      <div className={styles.resourceContent}>{renderActiveContent()}</div>
    </div>
  );
};

export default ResourceCenter;
