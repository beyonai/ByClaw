/* eslint-disable no-bitwise */
const CryptoJS = require('crypto-js');

// 接口签名
export const generateSignature = (method: string, data: any) => {
  const salt = '{#@*A12^c0+}';
  // 生成 UUID v4
  function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
  const nonce = generateUUID();
  const timestamp = Date.now();
  let params = '';
  if (method === 'POST' || method === 'PUT') {
    if (data instanceof FormData) {
      // FormData 不能直接序列化，跳过加密参数
      params = '';
    } else if (typeof data === 'object' && data !== null) {
      params = JSON.stringify(data);
    } else if (typeof data === 'string') {
      params = data;
    }
  } else {
    params = Object.entries(data)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join('&');
  }
  const userCode = localStorage.getItem('uc') || '';
  const stringToSign = `${userCode}${nonce}${timestamp}${params}${salt}`;
  const signature = CryptoJS.MD5(stringToSign).toString(CryptoJS.enc.Hex);

  return {
    'x-signature-nonce': nonce,
    'x-signature-timestamp': timestamp.toString(),
    'x-signature-value': signature,
  };
};
