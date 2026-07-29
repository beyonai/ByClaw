package com.iwhalecloud.byai.gateway.channels.service.wecom.stream.user;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.util.OkHttpUtil;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.config.WecomStreamProperties;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.model.WecomRobotChannelConfig;
import com.iwhalecloud.byai.gateway.channels.service.wecom.stream.config.WecomRobotConfigService;
import okhttp3.Request;
import okhttp3.Response;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

@Service
public class WecomContactTokenService {

    private static final String CACHE_KEY_PREFIX = "wecom:contact:access_token:";
    private static final long ACCESS_TOKEN_EXPIRE_MINUTES = 119L;

    private final ObjectMapper objectMapper;
    private final WecomStreamProperties properties;
    private final WecomRobotConfigService robotConfigService;
    private final TokenCache tokenCache;

    @Autowired
    public WecomContactTokenService(ObjectMapper objectMapper,
                                    WecomStreamProperties properties,
                                    WecomRobotConfigService robotConfigService) {
        this(objectMapper, properties, robotConfigService, new RedisTokenCache());
    }

    WecomContactTokenService(ObjectMapper objectMapper,
                             WecomStreamProperties properties,
                             WecomRobotConfigService robotConfigService,
                             TokenCache tokenCache) {
        this.objectMapper = objectMapper;
        this.properties = properties;
        this.robotConfigService = robotConfigService;
        this.tokenCache = tokenCache;
    }

    public String getAccessToken(String botId) {
        WecomStreamProperties.Contact contact = properties.getContact();
        WecomRobotChannelConfig robotConfig = robotConfigService.getRobotConfig(botId);
        String corpId = robotConfig == null ? null : robotConfig.getCorpId();
        String agentId = robotConfig == null ? null : robotConfig.getAgentId();
        String corpSecret = robotConfig == null ? null : robotConfig.getCorpSecret();
        if (!StringUtils.hasText(corpId) || !StringUtils.hasText(agentId) || !StringUtils.hasText(corpSecret)) {
            throw new IllegalStateException("WeCom contact corpId/agentId/corpSecret is empty, botId=" + botId);
        }

        String cacheKey = CACHE_KEY_PREFIX + corpId + ":" + agentId;
        String cached = tokenCache.get(cacheKey);
        if (StringUtils.hasText(cached)) {
            return cached;
        }

        String url = contact.getTokenUrl()
                + "?corpid=" + (corpId)
                + "&corpsecret=" + (corpSecret);
        Request request = new Request.Builder().url(url).get().build();
        try (Response response = OkHttpUtil.getHttpClient().newCall(request).execute()) {
            String body = response.body() == null ? "" : response.body().string();
            if (!response.isSuccessful()) {
                throw new IllegalStateException("Get WeCom contact access_token failed, httpCode=" + response.code());
            }
            JsonNode root = objectMapper.readTree(body);
            int errcode = root.path("errcode").asInt(-1);
            String token = root.path("access_token").asText(null);
            if (errcode != 0 || !StringUtils.hasText(token)) {
                throw new IllegalStateException("Get WeCom contact access_token failed, errcode="
                        + errcode + ", errmsg=" + root.path("errmsg").asText(""));
            }
            tokenCache.set(cacheKey, token, ACCESS_TOKEN_EXPIRE_MINUTES, TimeUnit.MINUTES);
            return token;
        } catch (IOException e) {
            throw new IllegalStateException("Request WeCom contact access_token failed", e);
        }
    }

    private String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    interface TokenCache {
        String get(String key);

        void set(String key, String value, long timeout, TimeUnit unit);
    }

    private static class RedisTokenCache implements TokenCache {
        @Override
        public String get(String key) {
            return RedisUtil.getString(key);
        }

        @Override
        public void set(String key, String value, long timeout, TimeUnit unit) {
            RedisUtil.setString(key, value, timeout, unit);
        }
    }
}
