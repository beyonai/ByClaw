import CryptoJS from 'crypto-js';

export function encryptByAES(str: string) {
  const GSMAPP_AES_KEY = '7b=isMfY<ar1Mox5';
  const GSMAPP_AES_IV = 'nVI;WhjYx+^E!ncs';
  const key = CryptoJS.enc.Utf8.parse(GSMAPP_AES_KEY);
  const iv = CryptoJS.enc.Utf8.parse(GSMAPP_AES_IV);
  const src = CryptoJS.enc.Utf8.parse(str);
  const enc = CryptoJS.AES.encrypt(src, key, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  const encrypted = enc.ciphertext.toString();
  return window.btoa(encrypted);
}
