package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream;

import java.util.concurrent.TimeUnit;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import com.dingtalk.api.DingTalkClient;
import com.dingtalk.api.request.OapiGettokenRequest;
import com.dingtalk.api.response.OapiGettokenResponse;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.model.DingtalkRobotChannelConfig;
import com.taobao.api.ApiException;

@Service
public class DingtalkTokenService {

    private static final Logger logger = LoggerFactory.getLogger(DingtalkTokenService.class);
    private static final String GET_TOKEN_URL = "https://oapi.dingtalk.com/gettoken";
    private static final long ACCESS_TOKEN_EXPIRE_MINUTES = 119L;
    private static final String ACCESS_TOKEN_CACHE_KEY_PREFIX = "dingtalk:access_token:";

    private final DingtalkRobotConfigService robotConfigService;
    private final DingtalkHttpClientFactory httpClientFactory;
    private final ConcurrentMap<String, CompletableFuture<String>> inFlightTokens = new ConcurrentHashMap<>();

    public DingtalkTokenService(DingtalkRobotConfigService robotConfigService, DingtalkHttpClientFactory httpClientFactory) {
        this.robotConfigService = robotConfigService;
        this.httpClientFactory = httpClientFactory;
    }

    public String getAccessToken(String senderStaffId, String robotCode) {
        if (!StringUtils.hasText(senderStaffId)) {
            throw new IllegalStateException("Get getAccessToken fail， DingTalk senderStaffId is empty");
        }
        DingtalkRobotChannelConfig robotConfig = robotConfigService.getRobotConfig(robotCode);

        String clientId = robotConfig.getClientId();
        String clientSecret = robotConfig.getClientSecret();
        if (!StringUtils.hasText(clientId) || !StringUtils.hasText(clientSecret)) {
            throw new IllegalStateException("DingTalk clientId/clientSecret is empty, robotCode=" + robotCode);
        }

        long started = System.nanoTime();
        // This token belongs to the robot application, rather than to a particular sender.
        String accessTokenCacheKey = ACCESS_TOKEN_CACHE_KEY_PREFIX + robotCode + ":" + clientId;
        String cachedAccessToken = RedisUtil.getString(accessTokenCacheKey);
        if (StringUtils.hasText(cachedAccessToken)) {
            logTokenTiming(robotCode, started, "hit");
            return cachedAccessToken;
        }

        CompletableFuture<String> pending = new CompletableFuture<>();
        CompletableFuture<String> existing = inFlightTokens.putIfAbsent(accessTokenCacheKey, pending);
        if (existing != null) {
            try {
                return existing.join();
            } finally {
                logTokenTiming(robotCode, started, "shared");
            }
        }
        try {
            // A different request or BE instance may have populated Redis while we were waiting.
            cachedAccessToken = RedisUtil.getString(accessTokenCacheKey);
            if (StringUtils.hasText(cachedAccessToken)) {
                pending.complete(cachedAccessToken);
                return cachedAccessToken;
            }
            DingTalkClient client = httpClientFactory.legacyClient(GET_TOKEN_URL);
            OapiGettokenRequest request = new OapiGettokenRequest();
            request.setAppkey(clientId);
            request.setAppsecret(clientSecret);
            request.setHttpMethod("GET");

            OapiGettokenResponse response = client.execute(request);
            if (response == null || !response.isSuccess() || !StringUtils.hasText(response.getAccessToken())) {
                String errCode = response == null ? "" : String.valueOf(response.getErrcode());
                String errMsg = response == null ? "" : response.getErrmsg();
                throw new IllegalStateException("Get DingTalk access_token failed, errCode=" + errCode + ", errMsg=" + errMsg);
            }

            String accessToken = response.getAccessToken();
            RedisUtil.setString(accessTokenCacheKey, accessToken, ACCESS_TOKEN_EXPIRE_MINUTES, TimeUnit.MINUTES);
            pending.complete(accessToken);
            return accessToken;
        } catch (ApiException e) {
            IllegalStateException failure = new IllegalStateException("Request DingTalk access_token failed", e);
            pending.completeExceptionally(failure);
            throw failure;
        } catch (RuntimeException | Error e) {
            pending.completeExceptionally(e);
            throw e;
        } finally {
            inFlightTokens.remove(accessTokenCacheKey, pending);
            logTokenTiming(robotCode, started, "miss");
        }
    }

    private void logTokenTiming(String robotCode, long started, String cache) {
        logger.info("dingtalk_chain requestId={} robotCode={} stage=token cache={} durationMs={}",
            MDC.get("dingtalkRequestId"), robotCode, cache, TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started));
    }

    public void evictAccessTokensByRobotCode(String robotCode) {
        if (!StringUtils.hasText(robotCode)) {
            return;
        }
        RedisUtil.delByPrefix(ACCESS_TOKEN_CACHE_KEY_PREFIX + robotCode + ":");
    }
}
