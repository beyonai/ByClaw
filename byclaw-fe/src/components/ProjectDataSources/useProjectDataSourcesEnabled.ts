import { useEffect, useState } from 'react';
import { getDcSystemConfig } from '@/pages/manager/service/session';

/** 项目数据源仅在明确配置为开源版时开放，加载中或读取失败时不展示入口。 */
export const useProjectDataSourcesEnabled = () => {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.resolve(getDcSystemConfig({ paramCode: 'BYAI_BRAND_VERSION' }))
      .then((config: any) => {
        const version = config?.paramValue ?? config?.data?.paramValue;
        if (active)
          setEnabled(
            String(version || '')
              .trim()
              .toLowerCase() === 'opensource'
          );
      })
      .catch(() => {
        if (active) setEnabled(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return enabled;
};
