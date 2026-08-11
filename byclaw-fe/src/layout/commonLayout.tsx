import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';

import useAppStore from '@/models/common/useAppStore';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Outlet, Helmet, useDispatch, useSelector, useSearchParams } from '@umijs/max';
import { getSystemConfigByStorage } from '@/utils/system';
import { getRuntimeActualUrl } from '@/utils';
import { getDcSystemConfigValueByCodes } from '@/service/auth';
import { setUserToken, initAdminVipList } from '@/utils/auth';
import BeyondBroadcastChannel from '@/utils/broadcastChannel';
import { getDcSystemConfigValueByCodes as getDcSystemConfigValueByCodesService } from '@/service/layout';
import { DIGITAL_EMPLOYEE_TERMINOLOGY_PARAM_CODE, SYSTEM_CONFIG_STORAGE_KEY } from '@/constants/system';
import useGlobalChatRuntime from '@/hooks/useGlobalChatRuntime';
import { applyBusinessTerminology } from '@/utils/terminology';

function formatImgUrl(url?: string) {
  if (!url) return '';
  if (url.startsWith('http') || url.startsWith('data:')) {
    return url;
  }
  if (url.startsWith('byaiService') || url.startsWith('knowledgeService')) {
    return `/${url}`;
  }
  if (url.startsWith('beyond')) {
    return getRuntimeActualUrl(`${url}`);
  }

  return `/byaiService/${url}`;
}

const CommonLayout = () => {
  const userInfo = useSelector(({ user }) => user.userInfo);
  const { getFeedbackType, getSandboxesInfoUrl, setENV, cleanCloudSettings, setCloudSettings, setDevConfig } =
    useAppStore();

  const dispatch = useDispatch();

  const [searchParams, setSearchParams] = useSearchParams();

  const [pageTitle, setPageTitle] = useState(getSystemConfigByStorage().title || '');
  const [favicon, setFavicon] = useState(getSystemConfigByStorage().favicon || getRuntimeActualUrl('/favicon.svg'));
  const [systemConfigReady, setSystemConfigReady] = useState(false);

  useGlobalChatRuntime();

  const queryClient = useMemo(() => {
    return new QueryClient({
      defaultOptions: {
        queries: {
          keepPreviousData: true,
          refetchOnWindowFocus: false,
          retry: false,
          cacheTime: 10,
        },
      },
    });
  }, []);

  useEffect(() => {
    if (!userInfo) {
      cleanCloudSettings();
      return;
    }

    dispatch({
      type: 'employees/getAllDigitalEmployees',
    });

    getFeedbackType().catch(() => {});
    getSandboxesInfoUrl().catch(() => {});

    getDcSystemConfigValueByCodesService({
      paramCodes: ['COLD_FUSION', 'BOTE_CONFIG'],
    })
      .then((res) => {
        if (!Array.isArray(res)) return;
        res.forEach((item: { paramValue: string; paramCode: string }) => {
          if (item.paramCode === 'COLD_FUSION') {
            setCloudSettings(item.paramValue);
          }
          if (item.paramCode === 'BOTE_CONFIG') {
            setDevConfig(item.paramValue);
          }
        });
      })
      .catch(() => {});

    // 初始化 AdminVip 配置
    initAdminVipList().catch(() => {});

    BeyondBroadcastChannel.init();
  }, [userInfo]);

  useLayoutEffect(() => {
    setUserToken({
      sessionId: searchParams.get('sessionId'),
      token: searchParams.get('token'),
      ssoToken: searchParams.get('ssoToken'),
    });
  }, []);

  useEffect(() => {
    searchParams.delete('sessionId');
    searchParams.delete('token');
    searchParams.delete('ssoToken');
    setSearchParams(searchParams);

    getDcSystemConfigValueByCodes({
      paramCodes: [
        'beyondLogo',
        'beyondTitle',
        'beyondFavicon',
        'beyondAssistant',
        'ENV',
        DIGITAL_EMPLOYEE_TERMINOLOGY_PARAM_CODE,
      ],
    })
      .then((data) => {
        try {
          const { beyondLogo, beyondTitle, beyondFavicon, beyondAssistant, ENV } = data || {};
          const terminology = applyBusinessTerminology(data?.[DIGITAL_EMPLOYEE_TERMINOLOGY_PARAM_CODE]);

          localStorage.setItem(
            SYSTEM_CONFIG_STORAGE_KEY,
            JSON.stringify({
              logo: formatImgUrl(beyondLogo),
              title: beyondTitle,
              assistant: formatImgUrl(beyondAssistant),
              favicon: formatImgUrl(beyondFavicon),
              terminology,
            })
          );
          setPageTitle(beyondTitle);
          if (beyondFavicon) {
            setFavicon(formatImgUrl(beyondFavicon));
          }

          if (ENV) {
            if (Array.isArray(ENV)) {
              setENV(ENV);
            } else {
              setENV(ENV.split(','));
            }
          }
        } catch (error) {
          console.error(error);
        }
      })
      .catch(() => {
        applyBusinessTerminology(getSystemConfigByStorage().terminology);
      })
      .finally(() => {
        setSystemConfigReady(true);
      });
  }, []);

  return (
    <div className="full-width full-height">
      <Helmet>
        {pageTitle && <title>{pageTitle}</title>}
        <link rel="shortcut icon" href={favicon} />
      </Helmet>
      <QueryClientProvider client={queryClient}>{systemConfigReady && <Outlet />}</QueryClientProvider>
    </div>
  );
};

export default React.memo(CommonLayout);
