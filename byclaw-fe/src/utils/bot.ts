import { getRuntimeActualUrl } from '@/utils';

export const ssoLoginByIframe = (ssoUrl?: string) => {
  if (!ssoUrl) return Promise.resolve();

  const iframeDom = document.createElement('iframe');
  iframeDom.style.width = '0';
  iframeDom.style.height = '0';
  iframeDom.style.position = 'fixed';
  iframeDom.style.top = '0';
  iframeDom.style.zIndex = '-1';

  iframeDom.src = getRuntimeActualUrl(ssoUrl);

  return new Promise((resolve) => {
    iframeDom.onload = function () {
      resolve(true);
      setTimeout(() => {
        window.document.body.removeChild(iframeDom);
      }, 5000);
    };
    iframeDom.onerror = function () {
      resolve(true);
      setTimeout(() => {
        window.document.body.removeChild(iframeDom);
      }, 17);
    };

    window.document.body.appendChild(iframeDom);
  });
};

export const setBotSelectedTenantID = (id: string) => {
  window.sessionStorage.setItem('botSelectedTenantID', id);
};
export const getBotSelectedTenantID = () => {
  return window.sessionStorage.getItem('botSelectedTenantID');
};
