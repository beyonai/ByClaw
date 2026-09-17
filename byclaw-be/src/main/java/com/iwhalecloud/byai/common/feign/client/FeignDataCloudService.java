package com.iwhalecloud.byai.common.feign.client;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.TypeReference;
import com.iwhaleai.byai.framework.common.RedisClient;
import com.iwhaleai.byai.framework.core.discovery.DiscoveryClient;
import com.iwhaleai.byai.framework.core.discovery.ServiceInstance;
import com.iwhaleai.byai.framework.util.http.DiscoveryHttpClient;
import com.iwhaleai.byai.framework.util.http.HttpResponse;
import com.iwhaleai.byai.framework.util.http.RetryConfig;
import com.iwhalecloud.byai.common.constants.resource.SystemCode;
import com.iwhalecloud.byai.common.feign.request.datacloud.InvokeActionReq;
import com.iwhalecloud.byai.common.feign.request.datacloud.TermsOptionsReq;
import com.iwhalecloud.byai.common.feign.response.DataCloudResponse;
import com.iwhalecloud.byai.common.feign.response.datacloud.InvokeActionResp;
import com.iwhalecloud.byai.common.feign.response.datacloud.TermsOptionsResp;
import com.iwhalecloud.byai.common.jwt.JwtService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import jakarta.annotation.PostConstruct;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.TimeUnit;

/**
 * @author he.duming
 * @date 2026-05-25 18:25:37
 * @description TODO
 */
@Service
public class FeignDataCloudService {

    private Logger logger = LoggerFactory.getLogger(FeignDataCloudService.class);

    private RetryConfig RETRY_CONFIG = RetryConfig.builder().maxAttempts(3).retryOnStatusCodes(Set.of(502, 503, 504))
        .build();

    private static final DateTimeFormatter LOG_TIME_FORMATTER = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss.SSS");

    @Value("${spring.application.datacloudName:byclaw-datacloud}")
    private String serviceName;

    @Value("${gateway.second.timeout:300}")
    private Long gatewaySecondTimeOut = 5 * 60L;

    @Autowired
    private JwtService jwtService;

    @Autowired
    @Qualifier("redisClient")
    private RedisClient redisClient;

    private DiscoveryClient discoveryClient;

    private DiscoveryHttpClient discoveryHttpClient;

    @PostConstruct
    public void init() {
        this.discoveryClient = new DiscoveryClient(redisClient, 5);
        this.discoveryHttpClient = DiscoveryHttpClient.builder().discoveryClient(discoveryClient)
            .retryConfig(RETRY_CONFIG).build();
    }

    /**
     * 统一执行知识库 POST 请求，根据路由结果决定走服务发现还是第三方直连。
     */
    public DataCloudResponse<TermsOptionsResp> termsOptions(TermsOptionsReq termsOptionsReq) {

        String path = "/api/v1/datacloud/terms/options";
        String url = buildDisplayUrl(path, null);
        long startNanos = System.nanoTime();
        String startTime = nowForLog();
        logDatacloudStart("POST", url, startTime, termsOptionsReq);
        try {

            HttpResponse response = discoveryHttpClient.post(serviceName, path, buildHeaders(), termsOptionsReq, null)
                .get(this.gatewaySecondTimeOut, TimeUnit.SECONDS);

            String body = JSON.toJSONString(response.getData());
            logDatacloudEnd("POST", url, startTime, startNanos, body, body);

            return JSON.parseObject(body, new TypeReference<DataCloudResponse<TermsOptionsResp>>() {
            });
        } catch (Exception e) {
            logDatacloudError("POST", url, startTime, startNanos, termsOptionsReq, e);
            return null;
        }
    }

    /**
     * 调用知识库动作（POST /api/v1/rpc/kb/invokeAction）。
     */
    public DataCloudResponse<InvokeActionResp> invokeAction(InvokeActionReq invokeActionReq) {

        String path = "/api/v1/rpc/kb/invokeAction";
        String url = buildDisplayUrl(path, null);
        long startNanos = System.nanoTime();
        String startTime = nowForLog();
        logDatacloudStart("POST", url, startTime, invokeActionReq);
        try {

            Map<String, String> headers = buildHeaders();

            // 放置请求头
            headers.put("X-User-Code", CurrentUserHolder.getCurrentUserCode());
            Long sessionId = invokeActionReq.getParams().getSessionId();
            if (sessionId != null) {
                headers.put("X-Session-Id", sessionId + "");
            }

            HttpResponse response = discoveryHttpClient.post(serviceName, path, headers, invokeActionReq, null)
                .get(this.gatewaySecondTimeOut, TimeUnit.SECONDS);

            String body = JSON.toJSONString(response.getData());
            logDatacloudEnd("POST", url, startTime, startNanos, body, body);

            return JSON.parseObject(body, new TypeReference<DataCloudResponse<InvokeActionResp>>() {
            });
        } catch (Exception e) {
            logDatacloudError("POST", url, startTime, startNanos, invokeActionReq, e);
            return null;
        }
    }

    private void logDatacloudStart(String method, String url, String startTime, Object request) {
        logger.info("datacloud call start, serviceName={}, method={}, url={}, startTime={}, request={}", serviceName,
            method, url, startTime, toJsonString(request));
    }

    private void logDatacloudEnd(String method, String url, String startTime, long startNanos, Object response,
                                 Object data) {
        logger.info(
            "datacloud call end, serviceName={}, method={}, url={}, startTime={}, endTime={}, costMs={}, response={}, data={}",
            serviceName, method, url, startTime, nowForLog(), elapsedMs(startNanos), toJsonString(response),
            toJsonString(data));
    }

    private void logDatacloudError(String method, String url, String startTime, long startNanos, Object request,
                                   Exception e) {
        logger.error(
            "datacloud call failed, serviceName={}, method={}, url={}, startTime={}, endTime={}, costMs={}, request={}",
            serviceName, method, url, startTime, nowForLog(), elapsedMs(startNanos), toJsonString(request), e);
    }

    private String buildDisplayUrl(String path, Map<String, Object> queryParams) {
        String baseUrl = "datacloud://" + serviceName;
        try {
            if (discoveryClient != null) {
                Optional<ServiceInstance> instance = discoveryClient.discover(serviceName);
                if (instance.isPresent()) {
                    ServiceInstance serviceInstance = instance.get();
                    String protocol = serviceInstance.getProtocol() == null ? "http" : serviceInstance.getProtocol();
                    String pathPrefix = StringUtils.defaultString(serviceInstance.getPathPrefix());
                    baseUrl = protocol + "://" + serviceInstance.getHost() + ":" + serviceInstance.getPort()
                        + pathPrefix;
                }
            }
        } catch (Exception e) {
            logger.debug("resolve datacloud service url failed, serviceName={}", serviceName, e);
        }
        return baseUrl + appendQuery(path, queryParams);
    }

    private static String appendQuery(String path, Map<String, Object> queryParams) {
        if (queryParams == null || queryParams.isEmpty()) {
            return path;
        }
        StringBuilder url = new StringBuilder(path);
        boolean first = true;
        for (Map.Entry<String, Object> entry : queryParams.entrySet()) {
            Object value = entry.getValue();
            if (value == null || StringUtils.isBlank(String.valueOf(value))) {
                continue;
            }
            url.append(first ? '?' : '&');
            url.append(encodeQueryValue(entry.getKey())).append('=').append(encodeQueryValue(String.valueOf(value)));
            first = false;
        }
        return url.toString();
    }

    private static String encodeQueryValue(String value) {
        return URLEncoder.encode(StringUtils.defaultString(value), StandardCharsets.UTF_8);
    }

    private static String nowForLog() {
        return LocalDateTime.now().format(LOG_TIME_FORMATTER);
    }

    private static long elapsedMs(long startNanos) {
        return TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startNanos);
    }

    private String toJsonString(Object value) {
        if (value instanceof String) {
            return (String) value;
        }
        try {
            return JSON.toJSONString(value);
        } catch (Exception e) {
            return String.valueOf(value);
        }
    }

    /**
     * JSON Content-Type；优先 Session Cookie，否则 Beyond-Token。
     *
     * @return 请求头
     */
    private Map<String, String> buildHeaders() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Content-Type", "application/json");
        return this.addAuth(headers);
    }

    /***
     * 增加认证信息
     *
     * @param headers 请求头
     * @return Map
     */
    private Map<String, String> addAuth(Map<String, String> headers) {

        LoginInfo loginInfo = CurrentUserHolder.getLoginInfo();
        if (loginInfo != null) {
            headers.put("System-Code", SystemCode.BYAI.getCode());
            headers.put("Beyond-Token", jwtService.createJwt(loginInfo));
        }
        return headers;
    }
}
