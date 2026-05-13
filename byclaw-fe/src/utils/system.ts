import { getDcSystemConfigListByStandType } from '@/service/auth';
import { ssoLoginByIframe } from '@/utils/bot';
import { SYSTEM_CONFIG_STORAGE_KEY } from '@/constants/system';
import { getPublicPath } from '.';

export const getSsoLoginByIframe = () => {
  getDcSystemConfigListByStandType({
    standType: 'BYAI_LOGIN_NOTICE_IFRAME_URLLIST',
  })
    .then((urlList) => {
      (urlList || []).forEach((item: { paramValue: string }) => {
        ssoLoginByIframe(item.paramValue);
      });
    })
    .catch(() => {
      // 配置拉取失败时不阻塞主流程，避免未处理的 Promise 拒绝
    });
};

export const getSystemConfigByStorage = (): {
  logo?: string;
  title?: string;
  assistant?: string;
  favicon?: string;
} => {
  const config = localStorage.getItem(SYSTEM_CONFIG_STORAGE_KEY);
  if (!config) return {};
  try {
    return JSON.parse(config);
  } catch (error) {
    return {};
  }
};

export const getSystemIcon = () => {
  const defaultIcon = `${getPublicPath()}logo.svg`;
  return getSystemConfigByStorage().logo || defaultIcon;
};
