package com.iwhalecloud.byai.common.storage.util;

import java.util.Locale;

import org.apache.commons.lang3.StringUtils;

public final class UserBucketNameResolver {

    private static final String USER_BUCKET_PREFIX = "byclaw-";
    private static final int MIN_BUCKET_NAME_LENGTH = 3;
    private static final int MAX_BUCKET_NAME_LENGTH = 63;

    private UserBucketNameResolver() {
    }

    public static String buildUserBucketName(String userCode) {
        if (StringUtils.isBlank(userCode)) {
            throw new IllegalArgumentException("用户编码不能为空，无法生成默认桶名称");
        }
        String normalizedUserCode = userCode.trim().toLowerCase(Locale.ROOT)
            .replaceAll("[^a-z0-9-]", "-")
            .replaceAll("-{2,}", "-")
            .replaceAll("^-+", "")
            .replaceAll("-+$", "");
        String bucketName = USER_BUCKET_PREFIX + normalizedUserCode;
        bucketName = bucketName.replaceAll("-{2,}", "-");
        if (bucketName.length() > MAX_BUCKET_NAME_LENGTH) {
            bucketName = bucketName.substring(0, MAX_BUCKET_NAME_LENGTH).replaceAll("-+$", "");
        }
        if (bucketName.length() < MIN_BUCKET_NAME_LENGTH
            || !bucketName.matches("^[a-z0-9][a-z0-9-]*[a-z0-9]$")) {
            throw new IllegalArgumentException("用户编码生成的默认桶名称不合法: " + bucketName);
        }
        return bucketName;
    }
}
