package com.iwhalecloud.byai.common.ecrypt;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.io.UnsupportedEncodingException;
import java.math.BigInteger;
import java.security.KeyFactory;
import java.security.interfaces.RSAPrivateKey;
import java.security.spec.RSAPrivateKeySpec;
import javax.crypto.Cipher;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.constants.Constants;

public final class RsaDecrypt {

    private static final Logger logger = LoggerFactory.getLogger(RsaDecrypt.class);


    /**
     * 公钥，请不要擅自修改该以下密码串
     */
    private static final String MODULES = "118249911269313777353369205468358971445904616358074252669429944094950609311848727388859640174096832607664732279928019002795333396858212446930193162882569448161371673123891912144968110489981164388431260818873249786366362488910362896712606417158347288417834035704864053434682010900207183838254091105621956825021";

    /**
     * 私钥，请不要擅自修改该以下密码串
     */
    private static final String PRIVATE_KEY = "48637328656722495419952397921862221863921217610635969833180547980888484743125170445612409181576120661186971074930797568386575629731449024512112042032173298256412636264324320870986152394015374623344670204072024939615784835070706841209134639407348192682679016061350533334334944953944634417183180191532927602945";

    private RsaDecrypt() {
    }

    public static String decrypt(String input) {
        RSAPrivateKey priKey = getPrivateKey(MODULES, PRIVATE_KEY);
        String output;
        try {
            output = decryptByPrivateKey(input, priKey);
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
            throw new BaseException("Token format error, unified authentication failed", e);
        }
        return output;
    }

    /**
     * 使用模和指数生成RSA私钥 注意：【此代码用了默认补位方式，为RSA/None/PKCS1Padding，不同JDK默认的补位方式可能不同，如Android默认是RSA /None/NoPadding】
     *
     * @param modulus 模
     * @param exponent 指数
     * @return
     */
    private static RSAPrivateKey getPrivateKey(String modulus, String exponent) {
        try {
            BigInteger b1 = new BigInteger(modulus);
            BigInteger b2 = new BigInteger(exponent);
            KeyFactory keyFactory = KeyFactory.getInstance("RSA");
            RSAPrivateKeySpec keySpec = new RSAPrivateKeySpec(b1, b2);
            return (RSAPrivateKey) keyFactory.generatePrivate(keySpec);
        }
        catch (Exception e) {
            logger.error(e.getMessage());
            return null;
        }
    }

    /**
     * 私钥解密 rsa
     *
     * @param data
     * @param privateKey
     * @return
     * @throws Exception
     */
    private static String decryptByPrivateKey(String data, RSAPrivateKey privateKey) {
        try {
            Cipher cipher = getCipher(privateKey);

            // 模长
            int key_len = privateKey.getModulus().bitLength() / 8;
            byte[] bytes = data.getBytes(Constants.CHARSET_UTF8);
            byte[] bcd = asciiToBcd(bytes, bytes.length);
            // System.err.println(bcd.length);
            // 如果密文长度大于模长则要分组解密
            String ming = "";
            byte[][] arrays = splitArray(bcd, key_len);
            for (byte[] arr : arrays) {
                ming = getCipherFinalString(cipher, ming, arr);
            }
            return ming;
        }
        catch (UnsupportedEncodingException e) {
            logger.error(e.getMessage());
            throw new BaseException(500, e.getMessage());
        }
    }

    private static String getCipherFinalString(Cipher cipher, String ming, byte[] arr) {
        try {
            ming += new String(cipher.doFinal(arr), Constants.CHARSET_UTF8);
        }
        catch (Exception e) {
            throw new BaseException(500, e.getMessage());
        }
        return ming;
    }

    private static Cipher getCipher(RSAPrivateKey privateKey) {
        Cipher cipher;
        try {
            cipher = Cipher.getInstance("RSA");
            cipher.init(Cipher.DECRYPT_MODE, privateKey);
        }
        catch (Exception e) {
            throw new BaseException(e.getMessage(), e);
        }
        return cipher;
    }

    /**
     * ASCII码转BCD码
     */
    private static byte[] asciiToBcd(byte[] ascii, int asc_len) {
        byte[] bcd = new byte[asc_len / 2];
        int j = 0;
        for (int i = 0; i < (asc_len + 1) / 2; i++) {
            bcd[i] = ascToBcd(ascii[j++]);
            bcd[i] = (byte) (((j >= asc_len) ? 0x00 : ascToBcd(ascii[j++])) + (bcd[i] << 4));
        }
        return bcd;
    }

    private static byte ascToBcd(byte asc) {
        byte bcd;

        if (asc >= '0' && asc <= '9') {
            bcd = (byte) (asc - '0');
        }
        else if (asc >= 'A' && asc <= 'F') {
            bcd = (byte) (asc - 'A' + 10);
        }
        else if (asc >= 'a' && asc <= 'f') {
            bcd = (byte) (asc - 'a' + 10);
        }
        else {
            bcd = (byte) (asc - 48);
        }
        return bcd;
    }

    /**
     * 拆分数组
     */
    private static byte[][] splitArray(byte[] data, int len) {
        int x = data.length / len;
        int y = data.length % len;
        int z = 0;
        if (y != 0) {
            z = 1;
        }
        int xz = x + z;
        byte[][] arrays = new byte[xz][];
        byte[] arr;
        for (int i = 0; i < xz; i++) {
            arr = new byte[len];
            if (i == xz - 1 && y != 0) {
                System.arraycopy(data, i * len, arr, 0, y);
            }
            else {
                System.arraycopy(data, i * len, arr, 0, len);
            }
            arrays[i] = arr;
        }
        return arrays;
    }

}
