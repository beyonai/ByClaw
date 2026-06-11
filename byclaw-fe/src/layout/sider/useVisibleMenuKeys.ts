import { useEffect, useState } from 'react';

import { getDcSystemConfigListByStandType } from '@/service/auth';
import { DEFAULT_MENU_CONFIG, getVisibleMenuKeysFromConfig } from '@/constants/system';

const defaultVisibleKeys = getVisibleMenuKeysFromConfig(DEFAULT_MENU_CONFIG);
const NEW_DEFAULT_VISIBLE_KEYS = ['skill', 'file'];

const appendMissingNewDefaultKeys = (visibleKeys: string[], configData: any[] = []) => {
  const configuredKeySet = new Set(
    getVisibleMenuKeysFromConfig(configData.map((item) => ({ ...item, paramValue: 'true' })))
  );
  const nextVisibleKeys = [...visibleKeys];

  NEW_DEFAULT_VISIBLE_KEYS.forEach((key) => {
    if (!configuredKeySet.has(key) && !nextVisibleKeys.includes(key)) {
      nextVisibleKeys.push(key);
    }
  });

  return nextVisibleKeys;
};

const useVisibleMenuKeys = (userInfo: any) => {
  const [visibleKeys, setVisibleKeys] = useState<string[]>([]);

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
          setVisibleKeys(appendMissingNewDefaultKeys(visibleMenuKeys, configData));
        } else {
          setVisibleKeys(defaultVisibleKeys);
        }
      })
      .catch(() => {
        if (active) {
          setVisibleKeys(defaultVisibleKeys);
        }
      });

    return () => {
      active = false;
    };
  }, [userInfo]);

  return visibleKeys;
};

export default useVisibleMenuKeys;
