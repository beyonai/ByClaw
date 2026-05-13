package com.iwhalecloud.byai.state.common.util;

import lombok.extern.slf4j.Slf4j;
import okhttp3.Headers;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import java.io.IOException;
import java.util.concurrent.TimeUnit;

/**
 * @description:
 * @author: cxf
 * @create: 2023-10-09 16:00
 **/
@Slf4j
public class OkHttpUtil {

    private static final long timeout = 300;

    public static OkHttpClient getHttpClient() {
        OkHttpClient.Builder client = new OkHttpClient.Builder();
        client.connectTimeout(timeout, TimeUnit.SECONDS);
        client.writeTimeout(timeout, TimeUnit.SECONDS);
        client.readTimeout(timeout, TimeUnit.SECONDS);
        return client.build();
    }

    /**
     * 处理get请求
     *
     * @param url
     * @param headers
     * @return
     */
    public static Response getRequest(String url, Headers headers) {
        Request request = null;
        try {
            request = new Request.Builder().url(url).headers(headers).get().build();
        }
        catch (IllegalArgumentException e) {
            log.error(e.getMessage(), e);
        }

        return doRequest(request);
    }

    /**
     * 执行请求
     *
     * @param request
     * @return
     */
    private static Response doRequest(Request request) {
        Response response = null;
        try {
            response = getHttpClient().newCall(request).execute();
        }
        catch (IOException e) {
            log.error(e.getMessage(), e);
        }
        return response;
    }
}
