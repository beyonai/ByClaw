// tslint:disable:ordered-imports
import React, { useEffect } from 'react';
import { Spin, message } from 'antd';
import { useSearchParams, useNavigate, useDispatch } from '@umijs/max';
import { getRootPagePath } from '@/utils';

import { iwhaleCallback } from '@/service/auth';

function LoginByCode() {
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
  const code = searchParams.get('code');

  useEffect(() => {
    if (!code) return;
    iwhaleCallback({ code })
      .then((res) => {
        if (res) {
          setUserInfo(res);

          navigate(getRootPagePath(), { replace: true });
        } else {
          message.error(res.msg);
        }
      })
      .catch((e) => {
        if (e) {
          message.error(e);
        }
      });
  }, [code]);

  return <Spin spinning style={{ height: '100vh', width: '100vw', display: 'flex' }} className="ub-ac ub-pc" />;
}

export default LoginByCode;
