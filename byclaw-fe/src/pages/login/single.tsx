// tslint:disable:ordered-imports
import React, { useEffect } from 'react';
import { Spin, message } from 'antd';
import { useSearchParams, useNavigate, useDispatch } from '@umijs/max';
import { getRootPagePath } from '@/utils';

import { loginBySso } from '@/service/auth';

function CasLogin() {
  const dispatch = useDispatch();
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

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const payload: Record<string, string> = {};

    const redirectUrl = searchParams.get('redirectUrl') || getRootPagePath();
    searchParams.delete('redirectUrl');
    searchParams.forEach((value: string, key: string) => {
      payload[key] = value;
    });

    loginBySso(payload)
      .then((res) => {
        if (res) {
          setUserInfo(res);

          if (redirectUrl.startsWith('http')) {
            window.location.href = redirectUrl;
          } else {
            navigate(redirectUrl, { replace: true });
          }
        } else {
          message.error(res.msg);
        }
      })
      .catch((e) => {
        if (e) {
          message.error(e);
        }
      });
  }, []);

  return <Spin spinning style={{ height: '100vh', width: '100vw', display: 'flex' }} className="ub-ac ub-pc" />;
}

export default CasLogin;
