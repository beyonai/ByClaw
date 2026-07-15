import { getRuntimeActualUrl, getRootUnAuthPagePath } from '@/utils';
import cookie from './cookie';
import { isNil } from 'lodash';
import { getDcSystemConfigValueByCodes } from '@/service/layout';

export const sessionKey = 'SESSION';
export const portalSessionKey = 'PORTAL-SESSION';
export const tokenKey = 'Beyond-Token';
export const ssotokenKey = 'SSO-TOKEN';

export const loginRedirect = (search: Record<string, string> = {}) => {
  const searchParams = new URLSearchParams(window.location.search);
  Object.entries(search).forEach(([key, value]) => {
    searchParams.set(key, value);
  });
  const queryParam = searchParams.toString();
  console.log('clearToken');
  window.location.replace(
    `${window.location.origin}${getRuntimeActualUrl(getRootUnAuthPagePath())}${queryParam ? `?${queryParam}` : ''}`
  );
};

export const clearToken = () => {
  cookie.clearDelete();

  localStorage.removeItem(sessionKey);
  localStorage.removeItem(portalSessionKey);
  localStorage.removeItem(tokenKey);
  localStorage.removeItem(ssotokenKey);
};

const setPortalSessionKey = (value: string) => {
  if (typeof window === 'undefined') return;
  cookie.set(portalSessionKey, value);
  localStorage.setItem(portalSessionKey, value);
};

const setSessionKey = (value: string) => {
  if (typeof window === 'undefined') return;
  cookie.set(sessionKey, value);
  localStorage.setItem(sessionKey, value);
};

export const getSessionKey = () => {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(sessionKey) || '';
};

const setToken = (value: string) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(tokenKey, value);
};

export const getToken = () => {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(tokenKey) || '';
};

const setssoToken = (value: string) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(ssotokenKey, value);
};

export const getssoToken = () => {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(ssotokenKey) || '';
};

export const setUserToken = (userTokens: any) => {
  const { sessionId, token, ssoToken } = userTokens || {};

  if (sessionId) {
    setSessionKey(sessionId);
    setPortalSessionKey(sessionId);
  }
  if (token) {
    setToken(token);
  }
  if (ssoToken) {
    setssoToken(ssoToken);
  }
};

// AdminVip 用户列表缓存
let adminVipListCache: string[] | null = null;
let isLoadingAdminVipList = false;

const normalizeAdminVipParamValue = (value: any): string[] => {
  if (isNil(value)) return [];
  if (Array.isArray(value)) {
    return value.flatMap(normalizeAdminVipParamValue);
  }
  if (typeof value === 'object') {
    return Object.values(value).flatMap(normalizeAdminVipParamValue);
  }

  const text = `${value}`.trim();
  if (!text) return [];

  if (text.startsWith('[') || text.startsWith('{') || (text.startsWith('"') && text.endsWith('"'))) {
    try {
      // paramValue 可能是 JSON 数组，也可能是普通逗号字符串；只在看起来像 JSON 时解析。
      return normalizeAdminVipParamValue(JSON.parse(text));
    } catch (error) {
      console.error('解析 AdminVip 配置失败:', error instanceof Error ? error.message : error ?? 'unknown');
      return [];
    }
  }

  return text
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

/**
 * 初始化 AdminVip 用户列表
 * 从接口获取配置并更新缓存
 */
export const initAdminVipList = async () => {
  if (isLoadingAdminVipList || adminVipListCache !== null) {
    return;
  }

  try {
    isLoadingAdminVipList = true;
    // response 的值就是 data（数组）
    const response = await getDcSystemConfigValueByCodes({
      paramCodes: ['USERCODE_CONFIG'],
    });

    if (Array.isArray(response) && response.length > 0) {
      const userCodeConfig = response.find((item: any) => item.paramCode === 'USERCODE_CONFIG');

      if (!isNil(userCodeConfig?.paramValue)) {
        // 将 'adminvip' 和配置的值合并
        adminVipListCache = Array.from(
          new Set(['adminvip', ...normalizeAdminVipParamValue(userCodeConfig.paramValue)])
        );
      } else {
        // 没有配置值时使用默认值
        adminVipListCache = ['adminvip'];
      }
    } else {
      // 接口返回失败时使用默认值
      adminVipListCache = ['adminvip'];
    }
  } catch (error) {
    console.error('获取 AdminVip 配置失败:', error instanceof Error ? error.message : error ?? 'unknown');
    // 出错时使用默认值
    adminVipListCache = ['adminvip'];
  } finally {
    isLoadingAdminVipList = false;
  }
};

/**
 * 判断用户是否为 AdminVip
 * @param userInfo 用户信息
 * @returns 是否为 AdminVip
 */
export const isAdminVip = (userInfo: { userCode: string }) => {
  if (!userInfo) {
    return false;
  }

  // 如果缓存未初始化，触发初始化（异步，不阻塞）
  if (adminVipListCache === null && !isLoadingAdminVipList) {
    initAdminVipList();
    // 初始化期间使用默认值，只判断 'adminvip'
    return userInfo.userCode === 'adminvip';
  }

  // 使用缓存的值进行判断
  const adminVipList = adminVipListCache || ['adminvip'];
  return adminVipList.includes(userInfo.userCode);
};
