import { getDcSystemConfig } from '@/pages/manager/service/session';
import { useEffect, useState } from 'react';

/** Keep commercial resource entries hidden until the deployment edition is known. */
export default function useCommercialEdition() {
  const [commercial, setCommercial] = useState(false);
  useEffect(() => {
    let active = true;
    getDcSystemConfig({ paramCode: 'BYAI_BRAND_VERSION' })
      .then((config: any) => {
        if (active) setCommercial(config?.paramValue === 'commercial');
      })
      .catch(() => {
        if (active) setCommercial(false);
      });
    return () => {
      active = false;
    };
  }, []);
  return commercial;
}
