import { ERROR_CODE, EXCEED_LIMITED_LOGIN_NUMBER, TOKEN_ERROR_CODE } from '@/constants/error/errorCode';
import {
  type AuthSnapshot,
  clearToken,
  getssoToken,
  getToken,
  hasAuthSnapshot,
  isCurrentAuthSnapshot,
  ssotokenKey,
  tokenKey,
  getSessionKey,
  loginRedirect,
} from '@/utils/auth';
import { generateSignature } from '@/utils/signature';
import { getLocale, history, getIntl } from '@umijs/max';
import { message } from 'antd';
import { showRequestErrorModal } from '@/utils/antdAppModal';
import { getRootUnAuthPagePath, getModelState } from '@/utils';
import BeyondBroadcastChannel from '@/utils/broadcastChannel';
import axios, { AxiosProgressEvent, AxiosResponse, InternalAxiosRequestConfig, Method } from 'axios';
import { get, isPlainObject, throttle, isNil } from 'lodash';
import { logout } from '../user';

declare module 'axios' {
  // 录制器需要在 409 时保留服务端原始响应，供调用方自行处理。
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface AxiosRequestConfig<D = any> {
    preserveErrorResponse?: boolean;
  }
}

export interface ConfigType {
  headers?: { [key: string]: string };
  timeout?: number;
  onUploadProgress?: (progressEvent: AxiosProgressEvent) => void;
  cancelToken?: AbortController;
  maxQuantity?: number;
  responseType?: any;
  languageConf?: boolean;
  responseCfg?: {
    hideErrorTips?: boolean;
    customHandle?: boolean;
    preserveErrorResponse?: boolean;
  } & Record<string, unknown>;
}

interface ResponseDataType {
  // byaiService
  code?: number | string;
  msg?: string;
  data?: any;
  topCont?: { code: string; remark: string };
  svcCont?: any;
}

const maxQuantityMap: Record<
  string,
  {
    amount: number;
    sign: AbortController;
  }
> = {};

function requestStart({ url, maxQuantity }: { url: string; maxQuantity?: number }) {
  if (!maxQuantity) return;
  const item = maxQuantityMap[url];

  if (item) {
    if (item.amount >= maxQuantity && item.sign) {
      item.sign.abort();
      delete maxQuantityMap[url];
    }
  } else {
    maxQuantityMap[url] = {
      amount: 1,
      sign: new AbortController(),
    };
  }
}

function requestFinish({ url }: { url: string }) {
  const item = maxQuantityMap[url];
  if (item) {
    // eslint-disable-next-line no-plusplus
    item.amount--;
    if (item.amount <= 0) {
      delete maxQuantityMap[url];
    }
  }
}

// 处理返回格式
function checkFactoryRes(
  resData: ResponseDataType,
  response: AxiosResponse<ResponseDataType>,
  responseCfg: ConfigType['responseCfg']
) {
  const { hideErrorTips, customHandle } = responseCfg || {};

  // 如果是 Blob 类型或者响应数据不是对象类型，直接返回（可能是文件流）
  if (resData instanceof Blob || !resData || typeof resData !== 'object') {
    return resData;
  }

  const { url } = response.config;

  let code = resData.code;
  let msg = resData.msg;
  let resultObject = resData.data;

  if (`${code}` === `${EXCEED_LIMITED_LOGIN_NUMBER}`) {
    message.error('当前登录人数过多，请稍后再试').then(() => {
      if (url !== '/byaiService/system/session/loginByUsername') {
        history.replace(`${getRootUnAuthPagePath()}?openLoginModal=1`);
      }
    });
    return Promise.reject();
  }

  if (customHandle) {
    return resData;
  }

  // 请求没报错，但接口code返回不为0，提示接口url和接口返回的错误信息
  if (code !== 0) {
    const errText = !isNil(msg) && String(msg).trim() !== '' ? String(msg) : '请求失败';
    if (!hideErrorTips) {
      showRequestErrorModal(errText);
    }
    // 使用字符串 reject，避免 new Error 触发 React 开发环境 Unhandled Rejection 全屏遮罩；useRequest 等已兼容 string
    return Promise.reject(errText);
  }

  return resultObject;
}

// 全局退出登录
export const globalLogout = (showLoginModal?: boolean, expectedAuthSnapshot?: AuthSnapshot) => {
  try {
    // 退出动作可能由旧请求延迟触发，只有请求所属会话仍然存在时才允许清理凭证。
    const hasExpectedAuth = expectedAuthSnapshot ? hasAuthSnapshot(expectedAuthSnapshot) : false;
    if (expectedAuthSnapshot && (!hasExpectedAuth || !isCurrentAuthSnapshot(expectedAuthSnapshot))) {
      return Promise.resolve();
    }

    const userState = getModelState('user');
    // 启动阶段 Redux 还没有 userInfo，但有效请求快照仍足以确认当前会话需要退出。
    const shouldLogout = Boolean(userState.userInfo) || hasExpectedAuth;
    if (!shouldLogout) return Promise.resolve();

    if (userState.userInfo) {
      // 在清理本地凭证前构造退出请求，确保请求仍携带当前会话凭证。
      Promise.resolve(logout()).catch((error) => console.error(error));
    }

    clearToken();

    BeyondBroadcastChannel.postMessage({ type: 'logout' });
    BeyondBroadcastChannel.close();

    loginRedirect(showLoginModal ? { openLoginModal: '1' } : {});

    return Promise.resolve();
  } catch (error) {
    console.error(error);
    return Promise.reject(error);
  }
};

/* 创建请求实例 */
const instance = axios.create({
  timeout: 6000000, // 超时时间
  headers: {
    'content-type': 'application/json',
    'Cache-Control': 'no-cache',
  },
});

/* 请求拦截 */
instance.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    try {
      // 接口签名
      const method = (config.method || 'GET').toUpperCase();
      const data = config.data || {};
      const params = config.params || {};

      const signatureHeaders = generateSignature(method, ['POST', 'PUT'].includes(method) ? data : params);
      Object.assign(config.headers, signatureHeaders);
    } catch (error) {
      console.error('接口签名失败:', error);
    }
    return config;
  },
  (err) => Promise.reject(err)
);

const toastAuthError = throttle(
  (authSnapshot: AuthSnapshot) => {
    message.error(getIntl().formatMessage({ id: 'common.loginExpired' }), 3, () => {
      // 提示期间可能已经重新登录，globalLogout 会再次校验这份旧快照。
      globalLogout(true, authSnapshot);
    });
  },
  3 * 1000,
  {
    leading: true,
    trailing: false,
  }
);

// 兼容 AxiosHeaders 和普通对象，统一读取请求中的鉴权头。
const getHeaderValue = (headers: any, key: string) => {
  const value = typeof headers?.get === 'function' ? headers.get(key) : headers?.[key] ?? headers?.[key.toLowerCase()];
  return isNil(value) ? '' : String(value);
};

// 从实际发出的请求配置提取快照，而不是读取响应到达时的最新 token。
const getRequestAuthSnapshot = (config: any): AuthSnapshot => ({
  sessionId: getHeaderValue(config?.headers, 'x-session-id'),
  token: getHeaderValue(config?.headers, tokenKey),
  ssoToken: getHeaderValue(config?.headers, ssotokenKey),
});

const isLoginExpiredResponse = (status: number, responseData: unknown) => {
  if (!(status in TOKEN_ERROR_CODE)) return false;

  // 后端将“已登录但无权限访问”也返回为 401，不能因此清除整个登录态。
  if (status === 401 && isPlainObject(responseData) && `${get(responseData, 'code')}` === '-1') {
    return false;
  }

  return true;
};

/* 响应拦截 */
instance.interceptors.response.use(
  (response: AxiosResponse<ResponseDataType>) => {
    return response;
  },
  (err): any => {
    const { config, response } = err;
    const status = err.status ?? response?.status;
    const { url } = config || {};
    if (status === 409 && config?.preserveErrorResponse && response) {
      return Promise.reject(err);
    }
    if (err.name === 'CanceledError') {
      // 请求被取消了，不用走下面的逻辑，将错误返回，给业务测判断错误类型
      return Promise.reject(err);
    }

    /**
     * 非首页时没登陆或登录失效、首页登录失效(search不为空，如有sessionId处理正在聊天中)
     * 清除缓存并重定向到首页
     */
    if (
      isLoginExpiredResponse(status, response?.data) &&
      ![
        '/byaiService/system/session/loginByPhone',
        '/byaiService/system/session/loginByUsername',
        '/byaiService/system/session/registerByPhone',
      ].includes(url)
    ) {
      const authSnapshot = getRequestAuthSnapshot(config);
      // 匿名请求或属于旧会话的响应只返回业务错误，不能触发全局退出。
      if (hasAuthSnapshot(authSnapshot) && isCurrentAuthSnapshot(authSnapshot)) {
        toastAuthError(authSnapshot);
      }
      return Promise.resolve('登录失效');
    }

    // 请求报错，返回错误码信息通过useRequest的onError中去提示
    const errMsg = String(get(response, 'data.msg') || ERROR_CODE[status] || response?.statusText || '网络异常');
    return Promise.reject(errMsg);
  }
);

export function request(url: string, data: any, cfg: ConfigType, method: Method): any {
  const { cancelToken, maxQuantity, languageConf = true, responseCfg, ...config } = cfg;

  if (data && isPlainObject(data)) {
    for (const key in data) {
      if (data[key] === null || data[key] === undefined) {
        delete data[key];
      }
    }
  }

  requestStart({ url, maxQuantity });

  let myData = data;
  if (data instanceof FormData) {
    if (languageConf) {
      myData.append('language', getLocale());
    }
  } else if (data && isPlainObject(data)) {
    if (!languageConf) {
      myData = {
        ...data,
      };
    } else {
      myData = {
        ...data,
        language: getLocale(),
      };
    }
  }
  // 在创建 Axios 请求时固定凭证，响应晚到时仍可判断它属于哪个登录会话。
  const headers: Record<string, string> = {
    ...(config.headers || {}),
    [tokenKey]: getToken(),
    [ssotokenKey]: getssoToken(),
    'x-session-id': getSessionKey(),
  };
  if (languageConf) {
    headers.language = getLocale();
  }

  // 通过 Axios 标准 headers 传递认证信息，避免旧的自定义 myHeader 被单独覆盖或丢失。
  return instance
    .request({
      ...config,
      headers,
      baseURL: '/',
      url,
      method,
      data: ['POST', 'PUT'].includes(method) ? myData : null,
      params: !['POST', 'PUT'].includes(method) ? myData : null,
      signal: cancelToken?.signal,
      preserveErrorResponse: responseCfg?.preserveErrorResponse,
    })
    .then((res) => {
      if (config && config.responseType === 'blob') {
        // @ts-ignore
        const disposition = res.headers.get('content-disposition') || '';
        // 解析 Content-Disposition 文件名：优先取 RFC 5987 的 filename*=UTF-8''xxx（中文 / 特殊字符更稳），
        // 缺失时再退回 filename="xxx"。两条都用各自的正则截断到下一个 ';' 或行尾，
        // 避免之前的 substr(indexOf('filename=')+...) 把后续 filename*=... 一起拼进文件名。
        let rawName = '';
        const star = disposition.match(/filename\*=([^']*)''([^;\r\n]+)/i);
        if (star) {
          rawName = star[2];
        } else {
          const plain = disposition.match(/filename="?([^";\r\n]+)"?/i);
          if (plain) {
            rawName = plain[1];
          }
        }
        let resolvedName = '';
        try {
          resolvedName = rawName ? window.decodeURIComponent(rawName) : '';
        } catch (e) {
          resolvedName = rawName;
        }
        return {
          fileName: resolvedName,
          file: res.data,
        };
      }
      return checkFactoryRes(res.data, res, responseCfg);
    })
    .finally(() => requestFinish({ url }));
}

/**
 * api请求方式
 * @param {String} url
 * @param {Any} params
 * @param {ConfigType} config
 * @returns
 */
export function GET<T = undefined>(url: string, params = {}, config: ConfigType = {}): Promise<T> {
  return request(url, params, config, 'GET');
}

export function POST<T = undefined>(url: string, data = {}, config: ConfigType = {}): Promise<T> {
  return request(url, data, config, 'POST');
}

export function PUT<T = undefined>(url: string, data = {}, config: ConfigType = {}): Promise<T> {
  return request(url, data, config, 'PUT');
}

export function DELETE<T = undefined>(url: string, data = {}, config: ConfigType = {}): Promise<T> {
  return request(url, data, config, 'DELETE');
}
