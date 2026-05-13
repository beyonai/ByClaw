package com.iwhalecloud.byai.common.util;

import lombok.extern.slf4j.Slf4j;
import okhttp3.OkHttpClient;
import java.util.concurrent.TimeUnit;

/**
 * @description:
 * @author: cxf
 * @create: 2023-10-09 16:00
 **/
@Slf4j
public final class OkHttpUtil {

    private OkHttpUtil() {
    }

    private static final long TIMEOUT = 600;

    private static final long CONNECT_TIMEOUT = 90;

    public static OkHttpClient getHttpClient() {
        OkHttpClient.Builder client = new OkHttpClient.Builder();
        client.connectTimeout(CONNECT_TIMEOUT, TimeUnit.SECONDS);
        client.writeTimeout(TIMEOUT, TimeUnit.SECONDS);
        client.readTimeout(TIMEOUT, TimeUnit.SECONDS);
        return client.build();
    }

}
