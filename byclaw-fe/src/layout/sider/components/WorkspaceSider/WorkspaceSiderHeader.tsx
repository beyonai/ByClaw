import React, { useState } from 'react';
import { SearchOutlined } from '@ant-design/icons';
import { Modal, Tooltip } from 'antd';
// @ts-ignore
import { useIntl } from '@umijs/max';
import ResourcePanelToggleIcon from '@/components/ChatLayoutComp/ChatResourceWorkspace/ResourcePanelToggleIcon';
import Search from '@/layout/header/components/Search';
import { getPublicPath } from '@/utils';
import { getSystemConfigByStorage } from '@/utils/system';
import styles from './index.module.less';

interface WorkspaceSiderHeaderProps {
  onCollapse?: () => void;
}

const WorkspaceSiderHeader: React.FC<WorkspaceSiderHeaderProps> = ({ onCollapse }) => {
  const intl = useIntl();
  const [showSearch, setShowSearch] = useState(false);
  const systemTitle = getSystemConfigByStorage().title || intl.formatMessage({ id: 'messageList.defaultAIName' });
  const searchLabel = intl.formatMessage({ id: 'layouHeader.search' });
  const collapseLabel = intl.formatMessage({ id: 'workspaceSider.collapseSidebar' });
  const systemLogo = `${getPublicPath()}beyond/favicon.svg`;

  return (
    <div className={styles.workspaceHeader}>
      <div className={styles.workspaceBrand} title={systemTitle}>
        <img className={styles.workspaceLogo} src={systemLogo} alt={systemTitle} />
        <span className={styles.workspaceName}>{systemTitle}</span>
      </div>
      <Tooltip title={searchLabel} placement="bottom">
        <button
          type="button"
          className={styles.globalSearchTrigger}
          aria-label={searchLabel}
          onClick={() => setShowSearch(true)}
        >
          <SearchOutlined className={styles.globalSearchIcon} />
        </button>
      </Tooltip>
      <Tooltip title={collapseLabel} placement="bottom">
        <button
          type="button"
          className={`${styles.globalSearchTrigger} ${styles.sidebarToggleTrigger}`}
          aria-label={collapseLabel}
          onClick={onCollapse}
        >
          <ResourcePanelToggleIcon className={styles.sidebarToggleIcon} />
        </button>
      </Tooltip>
      {showSearch && (
        <Modal
          open
          title=""
          closable={false}
          onCancel={() => setShowSearch(false)}
          style={{ top: 32 }}
          styles={{
            header: { display: 'none' },
            footer: { display: 'none' },
            content: { padding: 16 },
          }}
          width="66vw"
          destroyOnClose
        >
          <Search showSearch displayInModal setShowSearch={setShowSearch} />
        </Modal>
      )}
    </div>
  );
};

export default WorkspaceSiderHeader;
