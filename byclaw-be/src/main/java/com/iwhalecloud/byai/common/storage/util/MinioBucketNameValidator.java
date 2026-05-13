package com.iwhalecloud.byai.common.storage.util;

import java.util.regex.Pattern;

import org.apache.commons.lang3.StringUtils;

import com.iwhalecloud.byai.common.exception.BaseException;

public final class MinioBucketNameValidator {

    private static final Pattern BUCKET_NAME_PATTERN = Pattern.compile("^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$");

    private MinioBucketNameValidator() {
    }

    public static void validate(String bucketName) {
        if (StringUtils.isBlank(bucketName)) {
            throw new BaseException("storage.minio.bucket.name.empty");
        }
        if (!BUCKET_NAME_PATTERN.matcher(bucketName).matches()) {
            throw new BaseException("storage.minio.bucket.name.invalid");
        }
    }
}
