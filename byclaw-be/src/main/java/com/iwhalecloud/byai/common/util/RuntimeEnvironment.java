package com.iwhalecloud.byai.common.util;

import org.apache.commons.lang3.StringUtils;

public final class RuntimeEnvironment {

    private static final String BE_ENV = "BE_ENV";
    private static final String DEVELOPMENT = "development";

    private RuntimeEnvironment() {
    }

    public static boolean isDevelopment() {
        String env = System.getProperty(BE_ENV);
        if (StringUtils.isEmpty(env)) {
            env = System.getenv(BE_ENV);
        }
        return DEVELOPMENT.equals(env);
    }
}
