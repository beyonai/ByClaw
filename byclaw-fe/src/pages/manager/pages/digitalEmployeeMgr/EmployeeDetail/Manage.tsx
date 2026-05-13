// @ts-nocheck
/* eslint-disable indent,quotes,comma-dangle,semi,quotes,@typescript-eslint/no-unused-vars,key-spacing,comma-spacing,no-trailing-spaces,max-len */
import React, { useMemo } from 'react';
import { Empty, Tabs, TabsProps } from 'antd';
import { chain } from 'lodash';
import { getToken, getssoToken } from '@/pages/manager/utils/auth';
import ss from './Manage.module.less';

const emptyArr: any[] = [];

const Manage = ({ pages = emptyArr }: { pages: any[] }) => {
  const items = useMemo<TabsProps['items']>(() => {
    return pages.map((page) => {
      const myUrl = chain(decodeURIComponent(page.url || ''))
        .replace('{beyond-token}', getToken())
        .replace('{sso-token}', getssoToken())
        .value();
      return {
        key: page.key,
        label: page.name,
        children: <iframe src={myUrl} style={{ width: '100%', height: '100%', border: 0 }} />,
      };
    });
  }, [pages]);

  return (
    <section className={ss.root}>
      {pages.length > 0 && <Tabs items={items} style={{ height: '100%', flex: 1 }} />}
      {!pages.length && <Empty description="暂无管理页面" />}
    </section>
  );
};

export default Manage;
