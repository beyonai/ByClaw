// @ts-nocheck
import React, { memo, useEffect } from 'react';

import { Outlet, useDispatch, useLocation } from '@umijs/max';
import { getLocale } from '@umijs/max';
import dayjs from 'dayjs';
import 'dayjs/locale/en';
import 'dayjs/locale/zh-cn';

import Auth from '@/layout/auth';
import AntdProvider from '@/pages/manager/layout/provider/antd';
import Sider from './sider';
import antdManagerTheme from '@/styles/antdManagerTheme';

import styles from './index.module.less';

const hideLayoutRoutes: Record<string, boolean> = {
  '/manager/resource/employeeDetail': true,
};

function setLanguage() {
  const locale = getLocale();
  if (locale === 'zh-CN') {
    dayjs.locale('zh-cn');
  } else {
    dayjs.locale('en');
  }
}

const ManagerLayout: React.FC = () => {
  const dispatch = useDispatch();
  const location = useLocation();
  const { pathname } = location;

  useEffect(() => {
    setLanguage();
  }, []);

  useEffect(() => {
    dispatch({
      type: 'menu/getBlockedPaths',
      payload: {
        paramCode: 'BYAI_MIN_SYSTEM_MENU',
      },
    });
  }, [dispatch]);

  // Check if layout should be hidden for certain routes
  const shouldHideLayout =
    hideLayoutRoutes[pathname] ||
    Object.keys(hideLayoutRoutes).some((route) => route !== '/' && pathname.startsWith(`${route}/`));

  return (
    <AntdProvider theme={antdManagerTheme}>
      <Auth>
        {shouldHideLayout ? (
          <Outlet />
        ) : (
          <div className={styles.layout}>
            <Sider />
            <div className={styles.content}>
              <div className={styles.innerContent}>
                <Outlet />
              </div>
            </div>
          </div>
        )}
      </Auth>
    </AntdProvider>
  );
};

export default memo(ManagerLayout);
