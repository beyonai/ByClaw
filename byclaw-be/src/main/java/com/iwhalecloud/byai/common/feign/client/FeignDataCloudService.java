package com.iwhalecloud.byai.common.feign.client;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.TypeReference;
import com.iwhaleai.byai.framework.common.RedisClient;
import com.iwhaleai.byai.framework.core.discovery.DiscoveryClient;
import com.iwhaleai.byai.framework.util.http.DiscoveryHttpClient;
import com.iwhaleai.byai.framework.util.http.HttpResponse;
import com.iwhaleai.byai.framework.util.http.RetryConfig;
import com.iwhalecloud.byai.common.constants.resource.SystemCode;
import com.iwhalecloud.byai.common.feign.request.datacloud.TermsOptionsReq;
import com.iwhalecloud.byai.common.feign.response.DataCloudResponse;
import com.iwhalecloud.byai.common.feign.response.PythonBuildResponse;
import com.iwhalecloud.byai.common.feign.response.datacloud.TermsOptionsResp;
import com.iwhalecloud.byai.common.jwt.JwtService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import java.util.HashMap;
import java.util.Map;
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

    @Value("${spring.application.datacloudName:byclaw-datacloud-zht}")
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

        try {

            HttpResponse response = discoveryHttpClient
                .post(serviceName, "/api/v1/datacloud/terms/options", buildHeaders(), termsOptionsReq, null)
                .get(this.gatewaySecondTimeOut, TimeUnit.SECONDS);

            String body = JSON.toJSONString(response.getData());

            return JSON.parseObject(body, new TypeReference<DataCloudResponse<TermsOptionsResp>>() {
            });
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
            return null;
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
