package com.iwhalecloud.byai.common.ecrypt;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.io.UnsupportedEncodingException;
import java.security.Key;
import java.security.Security;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;
import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.exception.BaseException;
import org.bouncycastle.jce.provider.BouncyCastleProvider;
import org.bouncycastle.pqc.legacy.math.linearalgebra.ByteUtils;

/**
 * @author:
 * @Date: 2020/8/18 14:17
 *        <p>
 *        SM4是我们自己国家的一个分组密码算法
 */
public class Sm4Util {

    private static final Logger logger = LoggerFactory.getLogger(Sm4Util.class);


    static {
        Security.addProvider(new BouncyCastleProvider());
    }

    private static final String DEFAULT_ENCODING = "UTF-8";

    public static final String ALGORITHM_NAME = "SM4";

    /**
     * 加密算法/分组加密模式/分组填充模式 PKCS5Padding-以8个字节为一组进行加密 定义分组加密模式使用 PKCS5Padding
     */
    public static final String ALGORITHM_NAME_ECB_PADDING = "SM4/ECB/PKCS5Padding";

    /**
     * DEFAULT_KEY_HEX = Hex.toHexString(DEFAULT_KEY.getBytes(ENCODING))
     */
    private static final String DEFAULT_KEY_HEX = "7734484041394b6c6d214530364f5e38";

    /**
     * 加密-加密模式：ECB，密文长度不固定，会随着被加密字符串长度的变化而变化 使用默认key进行加密
     */
    public static String encrypt(String data) {
        return encryptToForeEnd(DEFAULT_KEY_HEX, data);
    }

    /**
     * 加密-加密模式：ECB，密文长度不固定，会随着被加密字符串长度的变化而变化 加密返回给前端-加密完成的数组，需要使用Base64再加密 hexKey 应满足32位16进制的
     */
    public static String encryptToForeEnd(String hexKey, String data) {
        // 16进制字符串-->byte[]
        byte[] keyData = ByteUtils.fromHexString(hexKey);
        // String-->byte[]
        try {
            byte[] srcData = data.getBytes(DEFAULT_ENCODING);
            byte[] cipherArray = encryptEcbPadding(keyData, srcData);
            return Base64Util.encode(cipherArray);
        }
        catch (UnsupportedEncodingException e) {
            throw new BaseException(500, e.getMessage());
        }
        // 加密后的数组

    }

    public static String encrypt(String hexKey, String data) {
        // 16进制字符串-->byte[]
        byte[] keyData = ByteUtils.fromHexString(hexKey);
        // String-->byte[]
        // byte[] srcData = new byte[0];
        try {
            byte[] srcData = data.getBytes(DEFAULT_ENCODING);
            // 加密后的数组
            byte[] cipherArray = encryptEcbPadding(keyData, srcData);
            String cipherText = ByteUtils.toHexString(cipherArray);
            return cipherText;
        }
        catch (UnsupportedEncodingException e) {
            throw new BaseException(500, e.getMessage());
        }
    }

    public static byte[] encryptEcbPadding(byte[] key, byte[] data) {
        Cipher cipher = generateEcbCipher(ALGORITHM_NAME_ECB_PADDING, Cipher.ENCRYPT_MODE, key);
        try {
            return cipher.doFinal(data);
        }
        catch (Exception e) {
            throw new BaseException(500, e.getMessage());
        }
    }

    /**
     * 解密-解密模式：采用ECB；使用默认key进行解密
     *
     * @param encryptData
     */
    public static String decrypt(String encryptData) {
        return decryptFromForeEnd(DEFAULT_KEY_HEX, encryptData);
    }

    /**
     * 解密-解密模式：采用ECB,解密前端传过来的密码参数
     *
     * @param hexKey
     * @param encryptData
     */
    public static String decryptFromForeEnd(String hexKey, String encryptData) {
        try {
            byte[] keyData = ByteUtils.fromHexString(hexKey);
            byte[] cipherData = Base64Util.decodeByte(encryptData);
            byte[] srcData = decryptEcbPadding(keyData, cipherData);
            String decryptStr = new String(srcData, DEFAULT_ENCODING);
            return decryptStr;
        }
        catch (UnsupportedEncodingException e) {
            throw new BaseException(500, e.getMessage());
        }

    }

    /**
     * 解密-解密模式：采用ECB
     *
     * @param hexKey
     * @param encryptData
     */
    public static String decrypt(String hexKey, String encryptData) {

        try {
            byte[] keyData = ByteUtils.fromHexString(hexKey);
            byte[] cipherData = ByteUtils.fromHexString(encryptData);
            byte[] srcData = decryptEcbPadding(keyData, cipherData);
            String decryptStr = new String(srcData, DEFAULT_ENCODING);
            return decryptStr;
        }
        catch (UnsupportedEncodingException e) {
            throw new BaseException(500, e.getMessage());
        }
    }

    /**
     * 解密
     */
    public static byte[] decryptEcbPadding(byte[] key, byte[] cipherText) {
        Cipher cipher = generateEcbCipher(ALGORITHM_NAME_ECB_PADDING, Cipher.DECRYPT_MODE, key);
        try {
            return cipher.doFinal(cipherText);
        }
        catch (Exception e) {
            throw new BaseException(500, e.getMessage());
        }
    }

    /**
     * 生成ECB暗号
     *
     * @param algorithmName
     * @param mode
     * @param key
     */
    private static Cipher generateEcbCipher(String algorithmName, int mode, byte[] key) {
        try {
            Cipher cipher = Cipher.getInstance(algorithmName, BouncyCastleProvider.PROVIDER_NAME);
            Key sm4Key = new SecretKeySpec(key, ALGORITHM_NAME);
            cipher.init(mode, sm4Key);
            return cipher;
        }
        catch (Exception e) {
            throw new BaseException(500, e.getMessage());
        }

    }

    public static String decryptByEnData(String encryptData) {
        try {
            String decodePswd = decrypt(encryptData);
            return decodePswd;
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
        }
        return "";
    }

    public static void main(String[] args) {

        for (int i = 0; i < 10; i++) {
            Map<String, Object> userInfo = new HashMap<>();
            userInfo.put("uuid", UUID.randomUUID().toString());
            userInfo.put("userId", 1);
            userInfo.put("usercode", "adminvip");
            userInfo.put("username", "测试");
            logger.info(encrypt(JSON.toJSONString(userInfo)));

        }

    }
}
