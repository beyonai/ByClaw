import { generateUniqueId } from '@/utils/math';
import { useLocation, useNavigate, useAliveController } from '@umijs/max';
import React, { Suspense, useRef } from 'react';
import { Spin } from 'antd';
import { getRuntimeActualUrl } from '@/utils';

import useIframeAction from './useIframeAction';

import styles from './index.module.less';

const EmployeeDetailIframe = () => {
  const { dropScope } = useAliveController();

  const { search } = useLocation();
  const navigate = useNavigate();

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const uuidRef = React.useRef<string>(generateUniqueId());

  const searchParams = new URLSearchParams(search);

  const [isLoading, setIsLoading] = React.useState(true);

  useIframeAction({
    uuid: uuidRef.current,
    onClose: () => {
      navigate('/digitalEmployees', { replace: true });
    },
    onSaveSuccess: () => {
      dropScope('digitalEmployees');
    },
  });
  const iframeSrc = React.useMemo(() => {
    const uri = window.location.origin;

    const srcObj = new URL(
      `${uri}${getRuntimeActualUrl(
        `/manager/digitalEmployeeMgr/EmployeeDetail?log=false&manage=false&isFrontAccess=true&uuid=${uuidRef.current}`
      )}`
    );

    searchParams.forEach((value, key) => {
      srcObj.searchParams.append(key, value);
    });

    return srcObj.toString();
  }, []);

  if (!iframeSrc) return null;

  return (
    <div className="full-width full-height">
      <Spin spinning={isLoading} className={styles.spin} wrapperClassName={styles.spinWrapper}>
        <Suspense fallback="loading...">
          <iframe
            src={iframeSrc}
            style={{
              border: 'none',
              overflow: 'hidden',
            }}
            width="100%"
            height="100%"
            ref={iframeRef}
            title="EmployeeDetailIframe"
            name="EmployeeDetailIframe"
            onLoad={() => {
              setIsLoading(false);
            }}
          />
        </Suspense>
      </Spin>
    </div>
  );
};

export default EmployeeDetailIframe;
