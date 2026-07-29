package com.iwhalecloud.byai.gateway.channels.service.feishu;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.gateway.channels.service.feishu.model.FeishuRobotChannelConfig;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * 飞书访问令牌服务。
 *
 * <p>机器人收发消息、查询用户详情都使用 tenant_access_token。
 * token 有有效期，因此按 appId 维度缓存到 Redis；配置变更时由 registry 清理对应缓存。</p>
 */
@Service
public class FeishuTokenService {

    private static final Logger logger = LoggerFactory.getLogger(FeishuTokenService.class);
    private static final MediaType JSON_MEDIA_TYPE = MediaType.parse("application/json; charset=utf-8");
    private static final String TENANT_ACCESS_TOKEN_URL =
            "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal";
    private static final String TENANT_ACCESS_TOKEN_CACHE_KEY_PREFIX = "feishu:tenant_access_token:";
    private static final long DEFAULT_TOKEN_EXPIRE_SECONDS = 90 * 60L;
    private static final long TOKEN_EXPIRE_SAFETY_SECONDS = 5 * 60L;

    private final OkHttpClient okHttpClient = new OkHttpClient();
    private final ObjectMapper objectMapper;
    private final FeishuRobotConfigService feishuRobotConfigService;

    public FeishuTokenService(ObjectMapper objectMapper, FeishuRobotConfigService feishuRobotConfigService) {
        this.objectMapper = objectMapper;
        this.feishuRobotConfigService = feishuRobotConfigService;
    }

    public String getTenantAccessToken(String appId) {
        FeishuRobotChannelConfig config = feishuRobotConfigService.getRobotConfig(appId);
        String cacheKey = TENANT_ACCESS_TOKEN_CACHE_KEY_PREFIX + appId;
        String cachedToken = RedisUtil.getString(cacheKey);
        if (StringUtils.hasText(cachedToken)) {
            return cachedToken;
        }

        try {
            Map<String, Object> requestBodyMap = new HashMap<>();
            requestBodyMap.put("app_id", config.getAppId());
            requestBodyMap.put("app_secret", config.getAppSecret());

            RequestBody requestBody = RequestBody.create(objectMapper.writeValueAsString(requestBodyMap), JSON_MEDIA_TYPE);
            Request request = new Request.Builder()
                    .url(TENANT_ACCESS_TOKEN_URL)
                    .post(requestBody)
                    .build();

            try (Response response = okHttpClient.newCall(request).execute()) {
                String responseBody = response.body() == null ? "" : response.body().string();
                if (!response.isSuccessful()) {
                    throw new IllegalStateException("Get Feishu tenant_access_token failed, httpCode="
                            + response.code() + ", body=" + responseBody);
                }

                JsonNode root = objectMapper.readTree(responseBody);
                int code = root.path("code").asInt(-1);
                String token = root.path("tenant_access_token").asText("");
                if (code != 0 || !StringUtils.hasText(token)) {
                    throw new IllegalStateException("Get Feishu tenant_access_token failed, code="
                            + code + ", msg=" + root.path("msg").asText(""));
                }

                long expireSeconds = root.path("expire").asLong(DEFAULT_TOKEN_EXPIRE_SECONDS);
                long cacheSeconds = Math.max(60L, expireSeconds - TOKEN_EXPIRE_SAFETY_SECONDS);
                RedisUtil.setString(cacheKey, token, cacheSeconds, TimeUnit.SECONDS);
                return token;
            }
        } catch (IOException e) {
            throw new IllegalStateException("Request Feishu tenant_access_token failed, appId=" + appId, e);
        }
    }

    public void evictTenantAccessToken(String appId) {
        if (!StringUtils.hasText(appId)) {
            return;
        }
        RedisUtil.del(TENANT_ACCESS_TOKEN_CACHE_KEY_PREFIX + appId);
        logger.info("Evicted Feishu tenant_access_token cache. appId={}", appId);
    }
}
