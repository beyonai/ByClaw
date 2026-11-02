package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream;

import com.aliyun.dingtalkcard_1_0.Client;
import com.aliyun.teaopenapi.models.Config;
import com.aliyun.teautil.models.RuntimeOptions;
import com.dingtalk.api.DefaultDingTalkClient;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.config.DingtalkStreamProperties;
import okhttp3.OkHttpClient;
import org.springframework.stereotype.Component;

import java.util.concurrent.TimeUnit;

/** Explicit network budgets for the DingTalk bot path; model execution uses its own budgets. */
@Component
public class DingtalkHttpClientFactory {
    private final DingtalkStreamProperties.Http properties;

    public DingtalkHttpClientFactory(DingtalkStreamProperties properties) {
        this.properties = properties.getHttp();
        requirePositive(this.properties.getConnectTimeoutMillis());
        requirePositive(this.properties.getReadTimeoutMillis());
        requirePositive(this.properties.getRequestTimeoutMillis());
        requirePositive(this.properties.getFileTimeoutMillis());
    }

    public DefaultDingTalkClient legacyClient(String url) {
        DefaultDingTalkClient client = new DefaultDingTalkClient(url);
        client.setConnectTimeout(properties.getConnectTimeoutMillis());
        client.setReadTimeout(properties.getReadTimeoutMillis());
        return client;
    }

    public Client cardClient() throws Exception {
        Config config = new Config();
        config.protocol = "https";
        config.regionId = "central";
        config.connectTimeout = properties.getConnectTimeoutMillis();
        config.readTimeout = properties.getReadTimeoutMillis();
        return new Client(config);
    }

    public RuntimeOptions cardRuntimeOptions() {
        return new RuntimeOptions()
            .setConnectTimeout(properties.getConnectTimeoutMillis())
            .setReadTimeout(properties.getReadTimeoutMillis())
            .setAutoretry(false)
            .setKeepAlive(true);
    }

    public OkHttpClient webhookClient() {
        return httpClient(properties.getRequestTimeoutMillis());
    }

    public OkHttpClient fileClient() {
        return httpClient(properties.getFileTimeoutMillis());
    }

    private OkHttpClient httpClient(int callTimeoutMillis) {
        return new OkHttpClient.Builder()
            .connectTimeout(properties.getConnectTimeoutMillis(), TimeUnit.MILLISECONDS)
            .readTimeout(properties.getReadTimeoutMillis(), TimeUnit.MILLISECONDS)
            .writeTimeout(properties.getReadTimeoutMillis(), TimeUnit.MILLISECONDS)
            .callTimeout(callTimeoutMillis, TimeUnit.MILLISECONDS)
            .build();
    }

    private static void requirePositive(int value) {
        if (value <= 0) {
            throw new IllegalArgumentException("DingTalk HTTP timeouts must be positive");
        }
    }
}
