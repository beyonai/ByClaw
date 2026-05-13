import { ERROR_CODE, EXCEED_LIMITED_LOGIN_NUMBER, TOKEN_ERROR_CODE } from '@/constants/error/errorCode';
import { clearToken, getssoToken, getToken, ssotokenKey, tokenKey, getSessionKey, loginRedirect } from '@/utils/auth';
import { generateSignature } from '@/utils/signature';
import { getLocale, history, getIntl } from '@umijs/max';
import { message } from 'antd';
import { showRequestErrorModal } from '@/utils/antdAppModal';
import { getRootUnAuthPagePath, getModelState } from '@/utils';
import BeyondBroadcastChannel from '@/utils/broadcastChannel';
import axios, { AxiosProgressEvent, AxiosResponse, InternalAxiosRequestConfig, Method } from 'axios';
import { get, isPlainObject, throttle, unset, isNil } from 'lodash';
import { logout } from '../user';

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
  };
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
export const globalLogout = (showLoginModal?: boolean) => {
  try {
    clearToken();

    const userState = getModelState('user');
    if (!userState.userInfo) return Promise.resolve();

    logout();

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

      const signatureHeaders = generateSignature(method, method === 'POST' ? data : params);
      Object.assign(config.headers, {
        ...signatureHeaders,
        ...config.myHeader,
      });
      unset(config, 'myHeader');
    } catch (error) {
      console.error('接口签名失败:', error);
    }
    return config;
  },
  (err) => Promise.reject(err)
);

const toastAuthError = throttle(
  () => {
    message.error(getIntl().formatMessage({ id: 'common.loginExpired' }), 3, () => {
      globalLogout(true);
    });
  },
  3 * 1000,
  {
    leading: true,
    trailing: false,
  }
);

/* 响应拦截 */
instance.interceptors.response.use(
  (response: AxiosResponse<ResponseDataType>) => {
    return response;
  },
  (err): any => {
    const { status, config, response } = err;
    const { url } = config;
    if (err.name === 'CanceledError') {
      // 请求被取消了，不用走下面的逻辑，将错误返回，给业务测判断错误类型
      return Promise.reject(err);
    }

    /**
     * 非首页时没登陆或登录失效、首页登录失效(search不为空，如有sessionId处理正在聊天中)
     * 清除缓存并重定向到首页
     */
    if (
      status in TOKEN_ERROR_CODE &&
      ![
        '/byaiService/system/session/loginByPhone',
        '/byaiService/system/session/loginByUsername',
        '/byaiService/system/session/registerByPhone',
      ].includes(url)
    ) {
      toastAuthError();
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

    /* 参数去空 */
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
  const headers: Record<string, string> = {
    ...(config.headers || {}),
    [tokenKey]: getToken(),
    [ssotokenKey]: getssoToken(),
    'x-session-id': getSessionKey(),
  };
  if (languageConf) {
    headers.language = getLocale();
  }

  return instance
    .request({
      headers,
      baseURL: '/',
      url,
      method,
      data: ['POST', 'PUT'].includes(method) ? myData : null,
      params: !['POST', 'PUT'].includes(method) ? myData : null,
      signal: cancelToken?.signal,
      myHeader: {
        ...headers,
      },
      ...config, // 用户自定义配置，可以覆盖前面的配置
    })
    .then((res) => {
      if (config && config.responseType === 'blob') {
        // @ts-ignore
        const fileName = res.headers.get('content-disposition') || '';
        const str = 'filename=';
        const name = fileName.replace(/"/g, '').substr(fileName.indexOf(str) + str.length);
        return {
          fileName: window.decodeURIComponent(name),
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
  return request(url, data, config, 'POST');
}

export function DELETE<T = undefined>(url: string, data = {}, config: ConfigType = {}): Promise<T> {
  return request(url, data, config, 'POST');
}
