package com.iwhalecloud.byai.common.ecrypt;

import java.io.UnsupportedEncodingException;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;

import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.security.crypto.codec.Base64;

public class AesUtils {
    // 偏移量字符串必须是16位 当模式是CBC的时候必须设置偏移量
    public static final String iv = "nVI;WhjYx+^E!ncs";

    public static final String Algorithm = "AES";

    public static final String AlgorithmProvider = "AES/CBC/PKCS5Padding"; // 算法/模式/补码方式

    public static final String AES_KEY = "7b=isMfY<ar1Mox5";

    public static final String AES_KEY_Id_CARD = "jkl++PYRT;1386#@";

    public static IvParameterSpec getIv() throws UnsupportedEncodingException {
        IvParameterSpec ivParameterSpec = new IvParameterSpec(iv.getBytes("utf-8"));
        return ivParameterSpec;
    }

    public static byte[] decrypt(String src, byte[] key) throws Exception {
        SecretKey secretKey = new SecretKeySpec(key, Algorithm);
        IvParameterSpec ivParameterSpec = getIv();
        Cipher cipher = Cipher.getInstance(AlgorithmProvider);
        cipher.init(Cipher.DECRYPT_MODE, secretKey, ivParameterSpec);
        byte[] hexBytes = hexStringToBytes(src);
        byte[] plainBytes = cipher.doFinal(hexBytes);
        return plainBytes;
    }

    public static byte[] encrypt(String src, byte[] key) throws Exception {
        SecretKey secretKey = new SecretKeySpec(key, Algorithm);
        IvParameterSpec ivParameterSpec = getIv();
        Cipher cipher = Cipher.getInstance(AlgorithmProvider);
        cipher.init(Cipher.ENCRYPT_MODE, secretKey, ivParameterSpec);
        byte[] cipherBytes = cipher.doFinal(src.getBytes(Charset.forName("utf-8")));
        return cipherBytes;
    }
    /*
     * public static byte[] encrypt(String src, byte[] key) throws Exception { SecretKey secretKey = new
     * SecretKeySpec(key, Algorithm); IvParameterSpec ivParameterSpec = getIv(); Cipher cipher =
     * Cipher.getInstance(AlgorithmProvider); cipher.init(Cipher.ENCRYPT_MODE, secretKey, ivParameterSpec); byte[]
     * hexBytes = hexStringToBytes(src); byte[] plainBytes = cipher.doFinal(hexBytes); return plainBytes; }
     */

    /**
     * 将16进制字符串装换为byte数组
     *
     * @param hexString
     * @return
     */
    public static byte[] hexStringToBytes(String hexString) {
        hexString = hexString.toUpperCase();
        int length = hexString.length() / 2;
        char[] hexChars = hexString.toCharArray();
        byte[] b = new byte[length];
        for (int i = 0; i < length; i++) {
            int pos = i * 2;
            b[i] = (byte) (charToByte(hexChars[pos]) << 4 | charToByte(hexChars[pos + 1]));
        }
        return b;
    }

    /**
     * 将byte转换为16进制字符串
     * 
     * @param src
     * @return
     */
    public static String byteToHexString(byte[] src) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < src.length; i++) {
            int v = src[i] & 0xff;
            String hv = Integer.toHexString(v);
            if (hv.length() < 2) {
                sb.append("0");
            }
            sb.append(hv);
        }
        return sb.toString();
    }

    private static byte charToByte(char c) {
        return (byte) "0123456789ABCDEF".indexOf(c);
    }

    public static String encryptIdCard(String sSrc, String sKey) throws Exception {
        // key 必须为16位
        byte[] raw = sKey.getBytes(StandardCharsets.UTF_8);
        SecretKeySpec skeySpec = new SecretKeySpec(raw, "AES");
        Cipher cipher = Cipher.getInstance("AES/ECB/PKCS5Padding"); // "算法/模式/补码方式"
        cipher.init(Cipher.ENCRYPT_MODE, skeySpec);
        byte[] encrypted = cipher.doFinal(sSrc.getBytes(StandardCharsets.UTF_8));
        return new String(Base64.encode(encrypted), StandardCharsets.UTF_8);
    }

    public static String decryptIdCard(String sSrc, String sKey) throws Exception {
        // key 必须为16位
        byte[] raw = sKey.getBytes(StandardCharsets.UTF_8);
        SecretKeySpec skeySpec = new SecretKeySpec(raw, "AES");
        Cipher cipher = Cipher.getInstance("AES/ECB/PKCS5Padding"); // "算法/模式/补码方式"
        cipher.init(Cipher.DECRYPT_MODE, skeySpec);
        return new String(cipher.doFinal(Base64.decode(sSrc.getBytes(StandardCharsets.UTF_8))), StandardCharsets.UTF_8);
    }

}