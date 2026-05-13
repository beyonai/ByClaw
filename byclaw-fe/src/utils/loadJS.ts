import { getRuntimeActualUrl } from './index';

export function loadJS(url: string) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.type = 'text/javascript';
    script.async = true;
    // script.fetchPriority = 'high';
    script.src = getRuntimeActualUrl(url);
    // script.onload = resolve
    script.onerror = reject;
    script.onload = function () {
      resolve(true);
    };
    document.head.appendChild(script);
  });
}
