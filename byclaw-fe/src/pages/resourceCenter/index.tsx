import React, { useState } from 'react';
import { Tabs } from 'antd';
import {
  AppstoreOutlined,
  DatabaseOutlined,
  EyeOutlined,
  FolderOutlined,
  ProductOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { useIntl } from '@umijs/max';
import Resources from '@/components/Resources';
import FilesPage from '@/pages/files';
import OntologyCenter from '@/pages/ontologyCenter';
import styles from './index.module.less';

type ResourceTabKey = 'knowledge' | 'tool' | 'view' | 'object' | 'ontology' | 'skill' | 'file';

const ResourceCenter: React.FC = () => {
  const intl = useIntl();
  const [activeKey, setActiveKey] = useState<ResourceTabKey>('skill');
  const [installedOnly, setInstalledOnly] = useState(false);

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
      key: 'ontology',
      label: intl.formatMessage({ id: 'common.resourceType.ontology' }),
      icon: <DatabaseOutlined />,
    },
    {
      key: 'view',
      label: intl.formatMessage({ id: 'common.viewName' }),
      icon: <EyeOutlined />,
    },
    {
      key: 'object',
      label: intl.formatMessage({ id: 'common.object' }),
      icon: <AppstoreOutlined />,
    },
    {
      key: 'file',
      label: intl.formatMessage({ id: 'common.file' }),
      icon: <FolderOutlined />,
    },
  ];

  const renderActiveContent = () => {
    const installedProps = { installedOnly, onInstalledOnlyChange: setInstalledOnly };
    if (activeKey === 'knowledge') return <Resources resourceType="KG_DOC" {...installedProps} />;
    if (activeKey === 'tool') return <Resources resourceType="TOOL" {...installedProps} />;
    if (activeKey === 'view') return <Resources resourceType="VIEW" {...installedProps} />;
    if (activeKey === 'object') return <Resources resourceType="OBJECT" {...installedProps} />;
    if (activeKey === 'ontology') return <OntologyCenter />;
    if (activeKey === 'skill') return <Resources resourceType="SKILL" {...installedProps} />;
    return <FilesPage />;
  };

  return (
    <div className={styles.resourceCenter}>
      <Tabs
        className={styles.resourceTabs}
        activeKey={activeKey}
        items={items}
        onChange={(key) => {
          const nextKey = key as ResourceTabKey;
          setActiveKey(nextKey);
          if (nextKey === 'ontology' || nextKey === 'file') {
            setInstalledOnly(false);
          }
        }}
      />
      <div className={styles.resourceContent}>{renderActiveContent()}</div>
    </div>
  );
};

export default ResourceCenter;
