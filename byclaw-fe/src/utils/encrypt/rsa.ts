// RSA默认公钥配置
const RSA_CONFIG = {
  PUBLIC_KEY: `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDPLKY3Sj9qGQrfHX/MsBfJiRvmo1VX8phMNfb+IDk/6sdeEMIp8cyjHK3yRJHKEKpLTm1B/11XOo+ju7YfsrxTSsPE1OBdi6+nw59KE+4cdUy+jFcOkSpJwFuzXI+c7GlopUckMsznsnoanUWoB54l922hPliEP3XsK/hDBgatzQIDAQAB
-----END PUBLIC KEY-----`,
};

/**
 * RSA加密函数
 * @param text 要加密的文本
 * @param publicKey 公钥，如果为空，则使用默认公钥
 * @returns 加密后的Base64字符串
 */
export async function encryptByRSA(text: string, publicKey?: string): Promise<string> {
  const { default: JSEncrypt } = await import('jsencrypt');
  try {
    const encrypt = new JSEncrypt();
    let _publicKey = publicKey || RSA_CONFIG.PUBLIC_KEY;
    if (_publicKey.indexOf('-----BEGIN PUBLIC KEY-----') !== 0) {
      _publicKey = `-----BEGIN PUBLIC KEY-----
${_publicKey}
-----END PUBLIC KEY-----`;
    }
    encrypt.setPublicKey(_publicKey);
    const encrypted = encrypt.encrypt(text);

    if (!encrypted) {
      throw new Error('RSA加密失败');
    }

    return encrypted;
  } catch (error) {
    console.error('RSA加密错误:', error);
    throw new Error('RSA加密失败');
  }
}
