import React, { useEffect } from 'react';
import { useSearchParams } from '@umijs/max';

function LoginByCode() {
  const [searchParams] = useSearchParams();
  const code = searchParams.get('code');

  useEffect(() => {
    window.parent.postMessage({
      code,
      type: 'datacloud-login-code',
    });
  }, []);

  return <div />;
}

export default LoginByCode;
