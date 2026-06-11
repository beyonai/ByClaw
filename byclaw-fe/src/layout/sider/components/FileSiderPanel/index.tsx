import React from 'react';
import { Empty, Spin } from 'antd';
import { useIntl, useLocation, useNavigate } from '@umijs/max';
import AntdIcon from '@/components/AntdIcon';
import FileBrowserPanel from '@/components/QueryInput/components/FileBrowserEntry/components/FileBrowserPanel';
import ActiveSiderAgentBar, { useActiveSiderAgent } from '@/layout/sider/components/ActiveSiderAgentBar';
import styles from './index.module.less';

const FileSiderPanel: React.FC = () => {
  const intl = useIntl();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const activeSiderAgent = useActiveSiderAgent();
  const isFilesPage = pathname.startsWith('/files');

  return (
    <div className={styles.container}>
      <ActiveSiderAgentBar agent={activeSiderAgent} />
      <div
        className={styles.router}
        onClick={() =>
          navigate(
            isFilesPage
              ? {
                pathname: '/chat',
              }
              : '/files',
            isFilesPage ? { state: { keepSiderActiveKey: 'file' } } : undefined
          )
        }
      >
        <AntdIcon type="icon-a-Data-fileshujuwenjian" />
        <span className={styles.middle}>{intl.formatMessage({ id: 'fileBrowserEntry.tab.files' })}</span>
        <AntdIcon
          type={isFilesPage ? 'icon-a-Leftzuo' : 'icon-a-Rightyou'}
          style={{ fontSize: 16, marginLeft: 'auto' }}
        />
      </div>
      <div className={styles.content}>
        {activeSiderAgent.resourceId ? (
          <React.Suspense fallback={<Spin />}>
            <FileBrowserPanel resourceId={activeSiderAgent.resourceId} mode="preview" />
          </React.Suspense>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
      </div>
    </div>
  );
};

export default FileSiderPanel;
