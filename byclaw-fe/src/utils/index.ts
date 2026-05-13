import { cloneDeep, trimStart } from 'lodash';
import { getDvaApp } from '@umijs/max';

import { parse } from './qs';

function improvePrefixPath(path: string) {
  let value = path;
  if (value.charAt(0) !== '/' && !value.startsWith('http')) {
    value = `/${value}`;
  }
  if (value.charAt(value.length - 1) !== '/') {
    value += '/';
  }
  return value;
}
// 如果后面有sdk的需求，也在这个函数处理
export function getPublicPath() {
  let base = _PUBLIC_PATH_;
  if (window.publicPath) {
    base = window.publicPath;
  }
  return improvePrefixPath(base);
}

export function getRuntimeActualUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith('http') || url.startsWith('data:')) {
    return url;
  }
  let result = url;
  if (result.startsWith('/')) result = result.substring(1);
  result = `${getPublicPath()}${result}`;
  return result;
}

/**
 * 获取动态参数
 * @param str sql 例如 select * from {tenant_code}_bus_form where a = {user_id}
 * @returns []
 */
export const getDynamicParameters = (str: string) => {
  const paramRegex = /\{(.+?)\}/g; // {} 花括号，大括号
  const keys = str.match(paramRegex) || [];
  const items = Array.from(new Set(keys));
  return items;
};

/**
 * @msg: 雪碧图位置
 * @param {*} index
 * @param {*} rowCount: 设计图每行icon个数，用于同一类型图标太多放到不同行
 * @param {*} size: { width, height, startY }，startY用于不同类型分组图标
 * @return {*}
 */
export function getBgImgPosBySize(index: number, size: any, rowCount?: number) {
  try {
    // 多个不同分组的放在同一张图中， startY为开始Y轴位置
    const { width = 0, height = 0, startY = 0 } = size || {};
    if (index === 0) return `0 -${startY}px`;
    if (rowCount === undefined || index < rowCount) {
      return `-${index * width}px -${startY}px`;
    }
    const mod = Math.floor(index % rowCount);
    const der = Math.floor(index / rowCount);
    const offsetX = mod * width;
    const offsetY = der * height - startY;
    return mod === 0 ? `0 -${offsetY}px` : `-${offsetX}px -${offsetY}px`;
  } catch (error) {
    return '0 0';
  }
}

export function getPageQueryWithDecoder() {
  const urlArr = window.location.href.split('?');
  if (urlArr.length > 1 && urlArr.length <= 2) {
    const urlData = parse(window.location.href.split('?')[1]) || {};
    const data =
      parse(window.location.href.split('?')[1], {
        decoder: (str: string) => str,
      }) || {};
    const { redirect } = urlData;
    return {
      ...data,
      redirect,
    };
  }
  if (urlArr.length > 2) {
    const newArr = urlArr.slice(1);
    return parse(newArr.join('?'), { decoder: (str: string) => str });
  }
  return {};
}

export function isRootPage() {
  return ['chat', 'chat/'].includes(trimStart(window.location.pathname, getPublicPath()));
}

export function getRootPagePath() {
  const isMobile = window.location.pathname.includes('/mobile');
  return isMobile ? '/mobile' : '/chat';
}

export function getRootUnAuthPagePath() {
  const isMobile = window.location.pathname.includes('/mobile');
  return isMobile ? '/mobile/login' : '/chat';
}
export const fixU16Code = (text: string) => {
  if (!text) return text;
  const coder = new TextEncoder();
  return String.fromCharCode(...coder.encode(text));
};

/**
 * ## 秒数转时间格式 h:mm:ss
 * @param num 秒
 */
export const num2time = (num: number = 0) => {
  let ss = Math.floor(num);

  let mm = Math.floor(ss / 60);
  if (mm > 0) ss %= 60;

  const h = Math.floor(mm / 60);
  if (h > 0) mm %= 60;

  if (h > 0) {
    return `${h}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }

  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
};

export const floatTo16BitPCM = (e: Float32Array) => {
  const t = new DataView(new ArrayBuffer(2 * e.length));
  for (let n = 0; n < e.length; n += 1) {
    const r = e[n] < 0 ? 32768 : 32767;

    // eslint-disable-next-line no-bitwise
    t.setInt16(2 * n, (e[n] * r) | 0, !0);
  }
  return t.buffer;
};

// 获取指定 Model 的 state
export function getModelState<T = any>(namespace: string): T {
  const app = getDvaApp();
  const store = app._store; // 获取 Redux Store
  const state = store.getState(); // 获取全局 State
  return cloneDeep(state[namespace]); // 返回目标 Model 的 State
}
