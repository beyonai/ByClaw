import React, { useEffect, useState } from 'react';

import Empty from '@/components/Empty';
import AntdAppModalHolder from '@/layout/components/provider/AntdAppModalHolder';
import antdDefaultTheme from '@/styles/antdDefaultTheme';

// @ts-ignore
import { getLocale, setLocale } from '@umijs/max';
import { ConfigProvider, ThemeConfig, App } from 'antd';
import enUS from 'antd/es/locale/en_US';
import zhCN from 'antd/es/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/en';
import 'dayjs/locale/zh-cn';

function AntdProvider(props: { children: React.ReactNode; theme?: ThemeConfig }) {
  const [myLocale, setMyLocale] = useState(zhCN);

  const language = getLocale();

  useEffect(() => {
    if (['en', 'en-US'].includes(language)) {
      setMyLocale(enUS);
      setLocale('en-US', false);
      dayjs.locale('en-us');
    }
    if (['zh', 'zh-CN'].includes(language)) {
      setMyLocale(zhCN);
      setLocale('zh-CN', false);
      dayjs.locale('zh-cn');
    }
  }, [language]);

  return (
    <ConfigProvider
      theme={props.theme || antdDefaultTheme}
      locale={myLocale}
      renderEmpty={() => {
        return <Empty />;
      }}
      prefixCls={PREFIX_NAME}
    >
      <App>
        <AntdAppModalHolder />
        {props.children}
      </App>
    </ConfigProvider>
  );
}

export default AntdProvider;
