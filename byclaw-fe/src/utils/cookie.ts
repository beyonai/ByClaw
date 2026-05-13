import Cookies from 'js-cookie';

// 获取 Cookie
export function getCommonCookie(name: string) {
  return Cookies.get(name);
}

// 设置 Cookie
export function setCommonCookie(name: string, value: string, days: number) {
  Cookies.set(name, value, { expires: days });
}

const cookie = {
  set(name: string, value?: any, days?: number) {
    if (days) {
      const d = new Date();
      d.setTime(d.getTime() + 24 * 60 * 60 * 1000 * days);
      window.document.cookie = `${name}=${value};path=/;expires=${d.toUTCString()}`;
    } else {
      window.document.cookie = `${name}=${value};path=/`;
    }
  },
  get(name: string) {
    const v = window.document.cookie.match(`(^|;) ?${name}=([^;]*)(;|$)`);
    return v ? v[2] : null;
  },
  delete(name: string) {
    this.set(name, '', -1);
  },
  clearDelete() {
    // eslint-disable-next-line no-useless-escape
    const keys = window.document.cookie.match(/[^ =;]+(?=\=)/g);
    if (keys) {
      for (let i = keys.length; i > 0; i -= 1) {
        window.document.cookie = `${keys[i]}=${''};path=/`;
      }
    }
  },
};

export default cookie;
