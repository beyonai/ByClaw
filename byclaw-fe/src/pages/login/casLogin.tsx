// tslint:disable:ordered-imports
import React, { useEffect } from 'react';
import { Spin, message } from 'antd';
import { useSearchParams, useNavigate, useDispatch } from '@umijs/max';
import { getRootPagePath } from '@/utils';

import { casCallback } from '@/service/auth';

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
    searchParams.forEach((value: string, key: string) => {
      payload[key] = value;
    });

    casCallback(payload)
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
  }, []);

  return <Spin spinning style={{ height: '100vh', width: '100vw', display: 'flex' }} className="ub-ac ub-pc" />;
}

export default CasLogin;
