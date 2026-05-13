import { useEffect, useState } from 'react';

import { getDcSystemConfigListByStandType } from '@/service/auth';
import { DEFAULT_MENU_CONFIG, getVisibleMenuKeysFromConfig } from '@/constants/system';

const defaultVisibleKeys = getVisibleMenuKeysFromConfig(DEFAULT_MENU_CONFIG);

const useVisibleMenuKeys = (userInfo: any) => {
  const [visibleKeys, setVisibleKeys] = useState<string[]>(defaultVisibleKeys);

  useEffect(() => {
    if (!userInfo) {
      return;
    }

    let active = true;

    getDcSystemConfigListByStandType({
      standType: 'MENU_ICON_SHOW_TAB',
    })
      .then((res: any) => {
        if (!active) {
          return;
        }

        const configData = res?.data || res;
        if (Array.isArray(configData) && configData.length > 0) {
          const visibleMenuKeys = getVisibleMenuKeysFromConfig(configData);
          setVisibleKeys(visibleMenuKeys);
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [userInfo]);

  return visibleKeys;
};

export default useVisibleMenuKeys;
