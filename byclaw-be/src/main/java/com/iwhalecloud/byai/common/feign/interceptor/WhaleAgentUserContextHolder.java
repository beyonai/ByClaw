package com.iwhalecloud.byai.common.feign.interceptor;

import com.alibaba.ttl.TransmittableThreadLocal;

public final class WhaleAgentUserContextHolder {

    private static final TransmittableThreadLocal<String> USER_CODE_HOLDER = new TransmittableThreadLocal<>();

    private WhaleAgentUserContextHolder() {
    }

    public static void setUserCode(String userCode) {
        USER_CODE_HOLDER.set(userCode);
    }

    public static String getUserCode() {
        return USER_CODE_HOLDER.get();
    }

    public static void clear() {
        USER_CODE_HOLDER.remove();
    }
}
