import React from 'react';
import { Empty, Spin } from 'antd';
import FileBrowserPanel from '@/components/QueryInput/components/FileBrowserEntry/components/FileBrowserPanel';
import { useActiveSiderAgent } from '@/layout/sider/components/ActiveSiderAgentBar';
import styles from './index.module.less';

const FilesPage: React.FC = () => {
  const activeSiderAgent = useActiveSiderAgent();

  return (
    <div className={styles.container}>
      {/* <div className={styles.header}>
        <ActiveSiderAgentBar agent={activeSiderAgent} />
      </div> */}
      <div className={styles.content}>
        {activeSiderAgent.resourceId ? (
          <React.Suspense fallback={<Spin />}>
            <FileBrowserPanel resourceId={activeSiderAgent.resourceId} />
          </React.Suspense>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
      </div>
    </div>
  );
};

export default FilesPage;
