package com.iwhalecloud.byai.common.util;

import okhttp3.Headers;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.util.concurrent.TimeUnit;

/**
 * 共享 OkHttpClient 工具类。OkHttpClient 线程安全且应全局复用，以共享连接池。
 */
public final class OkHttpUtil {

    private static Logger logger = LoggerFactory.getLogger(OkHttpUtil.class);

    private OkHttpUtil() {
    }

    /** 读/写超时（秒） */
    private static final long TIMEOUT = 600;

    /** 连接超时（秒） */
    private static final long CONNECT_TIMEOUT = 90;

    /** 全局单例，勿每次请求新建 client */
    private static final OkHttpClient HTTP_CLIENT = new OkHttpClient.Builder()
        .connectTimeout(CONNECT_TIMEOUT, TimeUnit.SECONDS).writeTimeout(TIMEOUT, TimeUnit.SECONDS)
        .readTimeout(TIMEOUT, TimeUnit.SECONDS).build();

    /** 返回共享的 OkHttpClient 实例 */
    public static OkHttpClient getHttpClient() {
        return HTTP_CLIENT;
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
            logger.error(e.getMessage(), e);
        }

        return doRequest(request);
    }

    /**
     * 执行请求
     *
     * @param request 请求
     * @return Response
     */
    private static Response doRequest(Request request) {
        Response response = null;
        try {
            response = getHttpClient().newCall(request).execute();
        }
        catch (IOException e) {
            logger.error(e.getMessage(), e);
        }
        return response;
    }

}
