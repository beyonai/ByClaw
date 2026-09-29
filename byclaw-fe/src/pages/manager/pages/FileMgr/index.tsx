import React, { useMemo, useState } from 'react';
import { useIntl } from '@umijs/max';
import MainDrawer from '@/components/MainDrawer';
import GlobalContext, { Platform } from '@/layout/components/provider/global';
import FilesPage from '@/pages/files';
import { EventEmitter$Cls } from '@/utils/eventEmitter';
import styles from './index.module.less';

const FileMgr: React.FC = () => {
  const intl = useIntl();

  // 后台没有聊天布局，提供页面独立且稳定的事件总线，复用原文件模块和预览抽屉。
  // 不指定会话员工，沿用 FilesPage 的当前用户默认数字员工文件空间。
  const [eventEmitter] = useState(() => new EventEmitter$Cls());
  const context = useMemo(
    () => ({ platform: Platform.pc, sessionId: '', agentId: '', EventEmitter: eventEmitter }),
    [eventEmitter]
  );

  return (
    <GlobalContext.Provider value={context}>
      <div className={styles.container}>
        <h2 className={styles.title}>{intl.formatMessage({ id: 'menu.fileManagement' })}</h2>
        <div className={styles.workspace}>
          <div className={styles.files}>
            <FilesPage />
          </div>
          <MainDrawer />
        </div>
      </div>
    </GlobalContext.Provider>
  );
};

export default FileMgr;
