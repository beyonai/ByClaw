package com.iwhalecloud.byai.manager.infrastructure.wechat;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Collections;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.security.authentication.AuthenticationServiceException;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.stereotype.Component;

/** 仅访问微信官方固定域名，且一次性手机号 code 绝不自动重放。 */
@Component
public class JdkWechatMiniappPhoneClient implements WechatMiniappPhoneClient {

    private static final String TOKEN_ENDPOINT = "https://api.weixin.qq.com/cgi-bin/token";
    private static final String PHONE_ENDPOINT = "https://api.weixin.qq.com/wxa/business/getuserphonenumber";
    private static final Duration TIMEOUT = Duration.ofSeconds(10);
    private static final Duration LOCK_TTL = Duration.ofSeconds(15);
    private static final int MAX_RESPONSE_BYTES = 64 * 1024;
    private static final String TOKEN_KEY = "byai:wechat:miniapp:token:";
    private static final String LOCK_KEY = "byai:wechat:miniapp:token-lock:";
    private static final DefaultRedisScript<Long> STORE_TOKEN = new DefaultRedisScript<>(
        "if redis.call('get', KEYS[1]) == ARGV[1] then "
            + "redis.call('set', KEYS[2], ARGV[2], 'EX', ARGV[3]); "
            + "return redis.call('del', KEYS[1]) else return 0 end", Long.class);
    private static final DefaultRedisScript<Long> RELEASE_LOCK = new DefaultRedisScript<>(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) "
            + "else return 0 end", Long.class);
    private static final DefaultRedisScript<Long> EVICT_TOKEN = new DefaultRedisScript<>(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) "
            + "else return 0 end", Long.class);

    private final HttpClient httpClient;
    private final StringRedisTemplate redis;
    private final WechatMiniappProperties properties;
    private final ObjectMapper mapper = new ObjectMapper().enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);

    @Autowired
    public JdkWechatMiniappPhoneClient(StringRedisTemplate redis, WechatMiniappProperties properties) {
        this(HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5))
            .followRedirects(HttpClient.Redirect.NEVER).build(), redis, properties);
    }

    JdkWechatMiniappPhoneClient(HttpClient httpClient, StringRedisTemplate redis,
        WechatMiniappProperties properties) {
        this.httpClient = httpClient;
        this.redis = redis;
        this.properties = properties;
    }

    @Override
    public String exchangePhoneCode(String phoneCode) {
        if (phoneCode == null || phoneCode.isBlank() || phoneCode.length() > 512) {
            throw new BadCredentialsException("微信手机号授权无效");
        }
        requireConfiguration();
        String token = accessToken();
        URI uri = URI.create(PHONE_ENDPOINT + "?access_token=" + encode(token));
        String payload;
        try {
            payload = mapper.writeValueAsString(Collections.singletonMap("code", phoneCode));
        } catch (IOException e) {
            throw new AuthenticationServiceException("微信手机号授权暂不可用");
        }
        HttpRequest request = HttpRequest.newBuilder(uri).timeout(TIMEOUT)
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(payload, StandardCharsets.UTF_8)).build();
        // 请求可能已到达微信；任何失败都要求客户端重新获取 code，不能重试此 POST。
        JsonNode root = send(request);
        if (!root.path("errcode").canConvertToInt() || root.path("errcode").intValue() != 0) {
            if (root.path("errcode").canConvertToInt()
                && isInvalidAccessToken(root.path("errcode").intValue())) {
                evictRejectedToken(token);
            }
            throw new BadCredentialsException("微信手机号授权失败");
        }
        JsonNode info = root.path("phone_info");
        String phone = info.path("phoneNumber").asText("");
        String appId = info.path("watermark").path("appid").asText("");
        if (!phone.matches("\\+?[0-9]{6,20}") || !properties.getAppId().equals(appId)) {
            throw new BadCredentialsException("微信手机号授权失败");
        }
        return phone;
    }

    private String accessToken() {
        String key = TOKEN_KEY + properties.getAppId();
        try {
            String cached = redis.opsForValue().get(key);
            if (cached != null && !cached.isBlank()) {
                return cached;
            }
            String lock = LOCK_KEY + properties.getAppId();
            String owner = UUID.randomUUID().toString();
            if (Boolean.TRUE.equals(redis.opsForValue().setIfAbsent(lock, owner, LOCK_TTL))) {
                try {
                    cached = redis.opsForValue().get(key);
                    if (cached != null && !cached.isBlank()) {
                        return cached;
                    }
                    Token token = fetchToken();
                    // 持锁者才能发布 token；过期锁的旧请求不得覆盖新实例刷新出的 token。
                    Long stored = redis.execute(STORE_TOKEN, java.util.List.of(lock, key), owner,
                        token.value(), Long.toString(token.ttlSeconds()));
                    if (!Long.valueOf(1).equals(stored)) {
                        throw new AuthenticationServiceException("微信手机号授权暂不可用");
                    }
                    return token.value();
                } finally {
                    redis.execute(RELEASE_LOCK, Collections.singletonList(lock), owner);
                }
            }
            for (int attempt = 0; attempt < 40; attempt++) {
                cached = redis.opsForValue().get(key);
                if (cached != null && !cached.isBlank()) {
                    return cached;
                }
                Thread.sleep(50);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AuthenticationServiceException("微信手机号授权暂不可用");
        } catch (RuntimeException e) {
            throw new AuthenticationServiceException("微信手机号授权暂不可用");
        }
        throw new AuthenticationServiceException("微信手机号授权暂不可用");
    }

    private Token fetchToken() {
        URI uri = URI.create(TOKEN_ENDPOINT + "?grant_type=client_credential&appid="
            + encode(properties.getAppId()) + "&secret=" + encode(properties.getAppSecret()));
        JsonNode root = send(HttpRequest.newBuilder(uri).timeout(TIMEOUT).GET().build());
        JsonNode value = root.path("access_token");
        JsonNode expiry = root.path("expires_in");
        if (root.has("errcode") || !value.isTextual() || value.textValue().isBlank()
            || !expiry.canConvertToInt()
            || expiry.intValue() <= 120) {
            throw new AuthenticationServiceException("微信手机号授权暂不可用");
        }
        return new Token(value.textValue(), expiry.intValue() - 120L);
    }

    private boolean isInvalidAccessToken(int errorCode) {
        return errorCode == 40001 || errorCode == 40014 || errorCode == 42001;
    }

    private void evictRejectedToken(String token) {
        try {
            // 只删除被微信拒绝的旧值，不能误删另一实例刚刷新的有效 token。
            redis.execute(EVICT_TOKEN, Collections.singletonList(TOKEN_KEY + properties.getAppId()), token);
        } catch (RuntimeException e) {
            throw new AuthenticationServiceException("微信手机号授权暂不可用");
        }
    }

    private JsonNode send(HttpRequest request) {
        try {
            HttpResponse<InputStream> response = httpClient.send(request, HttpResponse.BodyHandlers.ofInputStream());
            try (InputStream body = response.body()) {
                if (response.statusCode() < 200 || response.statusCode() >= 300 || body == null) {
                    throw new AuthenticationServiceException("微信手机号授权暂不可用");
                }
                byte[] bytes = body.readNBytes(MAX_RESPONSE_BYTES + 1);
                if (bytes.length > MAX_RESPONSE_BYTES) {
                    throw new AuthenticationServiceException("微信手机号授权暂不可用");
                }
                JsonNode root = mapper.readTree(bytes);
                if (root == null || !root.isObject()) {
                    throw new AuthenticationServiceException("微信手机号授权暂不可用");
                }
                return root;
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AuthenticationServiceException("微信手机号授权暂不可用");
        } catch (IOException | RuntimeException e) {
            throw new AuthenticationServiceException("微信手机号授权暂不可用");
        }
    }

    private void requireConfiguration() {
        if (properties.getAppId() == null || properties.getAppId().isBlank()
            || properties.getAppSecret() == null || properties.getAppSecret().isBlank()) {
            throw new AuthenticationServiceException("微信手机号授权暂不可用");
        }
    }

    private String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private record Token(String value, long ttlSeconds) { }
}
