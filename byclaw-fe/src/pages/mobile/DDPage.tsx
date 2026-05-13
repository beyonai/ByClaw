// tslint:disable:ordered-imports
import React, { useEffect, useCallback, useState } from 'react';
import { Spin, message } from 'antd';
import { useDispatch, useIntl } from '@umijs/max';
import * as dd from 'dingtalk-jsapi';

import BaseMobilePage from './BaseMobilePage';
import { dingtalkCallback, getSSOUrl } from '@/service/auth';

import styles from './index.module.less';

export default function DDPage() {
  const [loading, setLoading] = useState(true);

  const dispatch = useDispatch();
  const intl = useIntl();

  const setUserInfo = React.useCallback(
    (res: any) => {
      dispatch({
        type: 'user/setUserInfo',
        payload: {
          ...res,
        },
      });
    },
    [dispatch]
  );

  const handleLogin = useCallback(async () => {
    try {
      setLoading(true);
      const urlParams = new URLSearchParams(window.location.search);
      const corpId = urlParams.get('corpid');
      let clientId;

      const ssoUrlRef = await getSSOUrl('dingtalk');
      if (`${ssoUrlRef.code}` === '0') {
        const ssoUrl = new URL(ssoUrlRef.data);
        clientId = ssoUrl.searchParams.get('client_id');
      }
      message.info(
        intl.formatMessage({ id: 'mobile.ddPage.clientInfo' }, { clientId: clientId || '-', corpId: corpId || '-' })
      );
      if (!corpId || !clientId) {
        message.error(intl.formatMessage({ id: 'mobile.ddPage.missingParams' }));
        return;
      }

      dd.requestAuthCode({
        corpId,
        clientId,
        onSuccess: async (result: { code: string }) => {
          try {
            dingtalkCallback({ code: result.code, loginType: 1 }).then((res) => {
              if (res) {
                setUserInfo(res);
                setLoading(false);
              } else {
                message.error(res.msg);
              }
            });
          } catch (error: any) {
            message.error(
              intl.formatMessage({ id: 'mobile.ddPage.getUserInfoFailed' }, { detail: error?.toString?.() || '' })
            );
          } finally {
            // setLoading(false);
          }
        },
        onFail: (err: any) => {
          message.error(
            intl.formatMessage({ id: 'mobile.ddPage.getAuthCodeFailed' }, { detail: err?.toString?.() || '' })
          );
          // setLoading(false);
        },
      });
    } catch (error: any) {
      message.error(intl.formatMessage({ id: 'mobile.ddPage.loginFailed' }, { detail: error?.toString?.() || '' }));
      // setLoading(false);
    }
  }, [intl, setUserInfo]);

  useEffect(() => {
    handleLogin();
  }, [handleLogin]);

  return (
    <Spin spinning={loading} wrapperClassName={styles.spinComp}>
      <BaseMobilePage />
    </Spin>
  );
}
