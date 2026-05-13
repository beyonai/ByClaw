package com.iwhalecloud.byai.common.ecrypt;

import org.apache.commons.codec.digest.DigestUtils;

public class MD5Util {
    /**
     * md5加密 密文：32位小写
     *
     * @param data
     * @return
     */
    public static String md5Hex(String data) {
        // 执行消息摘要
        return DigestUtils.md5Hex(data);
    }

    /**
     * md5加密 密文：16位小写
     *
     * @param data
     * @return
     */
    public static String md5Hex16(String data) {
        String text = md5Hex(data);
        return text.substring(8, 24);
    }

}
