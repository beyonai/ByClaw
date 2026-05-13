package com.iwhalecloud.byai.common.ecrypt;

import org.apache.commons.codec.digest.DigestUtils;
import org.apache.commons.lang3.StringUtils;

public class MD5Utils {
    // 禁止修改此字符串
    private static final String SALT = "#@*A12^c0+";

    /**
     * 使用MD5加密算法对字符串加密
     * 
     * @param oriCode 原始字符串
     * @return 加密字符串
     */
    public static String encrypt(String oriCode) {
        return encrypt(oriCode, SALT);
    }

    /**
     * 对字符串使用加盐的方式进行MD5加密
     * 
     * @param oriCode 原始字符串
     * @param salt 加盐字符串
     * @return 加密字符串
     */
    public static String encrypt(String oriCode, String salt) {
        if (StringUtils.isNotEmpty(oriCode) && StringUtils.isNotEmpty(salt)) {
            return DigestUtils.md5Hex(oriCode + "{" + salt + "}");
        }
        return oriCode;
    }

}
