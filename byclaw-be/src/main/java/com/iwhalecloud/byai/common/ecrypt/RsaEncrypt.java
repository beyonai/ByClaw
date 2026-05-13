package com.iwhalecloud.byai.common.ecrypt;



import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.RSAPublicKeySpec;

import javax.crypto.Cipher;

public class RsaEncrypt {

    private static final Logger logger = LoggerFactory.getLogger(RsaEncrypt.class);

    // 请不要擅自修改该以下2个密码串
    public static final String PUBILC_KEY = "65537";

    public static final String MODULES = "118249911269313777353369205468358971445904616358074252669429944094950609311848727388859640174096832607664732279928019002795333396858212446930193162882569448161371673123891912144968110489981164388431260818873249786366362488910362896712606417158347288417834035704864053434682010900207183838254091105621956825021";

    /**
     * 加密
     * 
     * @param input
     * @return
     */
    public static String encrypt(String input) {
        RSAPublicKey pubKey = getPublicKey(MODULES, PUBILC_KEY);
        String outString = "";
        try {
            outString = encryptByPublicKey(input, pubKey);
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
        }
        return outString;

    }

    /**
     * 使用模和指数生成RSA公钥 注意：【此代码用了默认补位方式，为RSA/None/PKCS1Padding，不同JDK默认的补位方式可能不同，如Android默认是RSA /None/NoPadding】
     * 
     * @param modulus 模
     * @param exponent 指数
     * @return
     */
    private static RSAPublicKey getPublicKey(String modulus, String exponent) {
        try {
            BigInteger b1 = new BigInteger(modulus);
            BigInteger b2 = new BigInteger(exponent);
            KeyFactory keyFactory = KeyFactory.getInstance("RSA");
            RSAPublicKeySpec keySpec = new RSAPublicKeySpec(b1, b2);
            return (RSAPublicKey) keyFactory.generatePublic(keySpec);
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
            return null;
        }
    }

    /**
     * 公钥加密
     * 
     * @param data
     * @param publicKey
     * @return
     * @throws Exception
     */
    private static String encryptByPublicKey(String data, RSAPublicKey publicKey) throws Exception {
        Cipher cipher = Cipher.getInstance("RSA");
        cipher.init(Cipher.ENCRYPT_MODE, publicKey);
        // 模长
        int key_len = publicKey.getModulus().bitLength() / 8;
        // 加密数据长度 <= 模长-11
        String[] datas = splitString(data, key_len - 11);
        StringBuffer miBuff = new StringBuffer();
        // 如果明文长度大于模长-11则要分组加密
        for (String s : datas) {
            miBuff.append(bcd2Str(cipher.doFinal(s.getBytes(StandardCharsets.UTF_8))));
        }
        return miBuff.toString();
    }

    /**
     * BCD转字符串
     */
    private static String bcd2Str(byte[] bytes) {
        char[] temp = new char[bytes.length * 2];
        char val;

        for (int i = 0; i < bytes.length; i++) {
            val = (char) (((bytes[i] & 0xf0) >> 4) & 0x0f);
            temp[i * 2] = (char) (val > 9 ? val + 'A' - 10 : val + '0');

            val = (char) (bytes[i] & 0x0f);
            temp[i * 2 + 1] = (char) (val > 9 ? val + 'A' - 10 : val + '0');
        }
        return new String(temp);
    }

    /**
     * 拆分字符串
     */
    private static String[] splitString(String string, int len) {
        int x = string.length() / len;
        int y = string.length() % len;
        int z = 0;
        if (y != 0) {
            z = 1;
        }
        String[] strings = new String[x + z];
        String str = "";
        for (int i = 0; i < x + z; i++) {
            if (i == x + z - 1 && y != 0) {
                str = string.substring(i * len, i * len + y);
            }
            else {
                str = string.substring(i * len, i * len + len);
            }
            strings[i] = str;
        }
        return strings;
    }

    public static void main(String[] args) {
        logger.info(encrypt("Byai@13579"));
    }
}
