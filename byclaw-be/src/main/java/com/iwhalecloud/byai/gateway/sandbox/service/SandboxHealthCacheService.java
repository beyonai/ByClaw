package com.iwhalecloud.byai.gateway.sandbox.service;

import com.iwhalecloud.byai.common.util.RedisUtil;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

@Service
public class SandboxHealthCacheService {

    private static final String SNAPSHOT_KEY_PREFIX = "byclaw:sandbox:health:";

    public void evictSnapshot(String userCode, String serviceType) {
        if (StringUtils.isAnyBlank(userCode, serviceType)) {
            return;
        }
        RedisUtil.removeKey(snapshotKey(userCode, serviceType));
    }

    public static String snapshotKey(String userCode, String serviceType) {
        return SNAPSHOT_KEY_PREFIX + userCode + ":" + serviceType;
    }
}
