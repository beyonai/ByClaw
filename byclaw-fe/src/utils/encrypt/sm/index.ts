import SM4 from './gm-crypt/sm4';

export function encryptBySM(str: string) {
  const sm4Config = { key: 'w4H@A9Klm!E06O^8', mode: 'ecb' };
  const sm4 = new SM4(sm4Config);
  return sm4.encrypt(str);
}

export function decryptBySM(ciphertext: string) {
  const sm4Config = { key: 'w4H@A9Klm!E06O^8', mode: 'ecb' };
  const sm4 = new SM4(sm4Config);
  return sm4.decrypt(ciphertext);
}
