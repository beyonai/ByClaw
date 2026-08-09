import React, { memo } from 'react';

// @ts-ignore
import { Outlet } from '@umijs/max';

import Auth from '../auth';
import AntdProvider from '../components/provider/antd';

import styles from './index.module.less';

/**
 * 规范/文档类页面的独立布局。
 *
 * 不复用 pcLayout:那套带 Sider、会话态(sessionId/agentId)、多层抽屉,
 * 且 .content 是 overflow:hidden,滚动落在内层容器上 —— 文档页要的是
 * 一个自己说得清的滚动容器(锚点定位依赖它)。这里只留主题、语言、鉴权。
 */
const DocLayout = () => (
  <AntdProvider>
    <Auth>
      <div className={styles.docLayout}>
        <Outlet />
      </div>
    </Auth>
  </AntdProvider>
);

export default memo(DocLayout);
