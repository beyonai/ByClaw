package com.iwhalecloud.byai.manager.infrastructure.wechat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.when;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

class JdkWechatMiniappPhoneClientTest {

    private final HttpClient http = mock(HttpClient.class);
    private final StringRedisTemplate redis = mock(StringRedisTemplate.class);
    @SuppressWarnings("unchecked")
    private final ValueOperations<String, String> values = mock(ValueOperations.class);

    @Test
    void exchangesCodeOnlyWithFixedWeixinEndpointAndChecksWatermark() throws Exception {
        when(redis.opsForValue()).thenReturn(values);
        when(values.get("byai:wechat:miniapp:token:wx-test")).thenReturn("cached-token");
        stub(200, "{\"errcode\":0,\"phone_info\":{\"phoneNumber\":\"13800138000\","
            + "\"watermark\":{\"appid\":\"wx-test\"}}}");
        WechatMiniappProperties properties = new WechatMiniappProperties();
        properties.setAppId("wx-test");
        properties.setAppSecret("private-secret");
        JdkWechatMiniappPhoneClient client = new JdkWechatMiniappPhoneClient(http, redis, properties);

        assertThat(client.exchangePhoneCode("phone-code")).isEqualTo("13800138000");

        ArgumentCaptor<HttpRequest> request = ArgumentCaptor.forClass(HttpRequest.class);
        verify(http).send(request.capture(), any(HttpResponse.BodyHandler.class));
        assertThat(request.getValue().uri().getScheme()).isEqualTo("https");
        assertThat(request.getValue().uri().getHost()).isEqualTo("api.weixin.qq.com");
        assertThat(request.getValue().uri().getPath()).isEqualTo("/wxa/business/getuserphonenumber");
        assertThat(request.getValue().uri().getQuery()).isEqualTo("access_token=cached-token");
    }

    @Test
    void rejectsMismatchedAppIdWithoutExposingResponse() throws Exception {
        when(redis.opsForValue()).thenReturn(values);
        when(values.get("byai:wechat:miniapp:token:wx-test")).thenReturn("cached-token");
        stub(200, "{\"errcode\":0,\"phone_info\":{\"phoneNumber\":\"13800138000\","
            + "\"watermark\":{\"appid\":\"another-app\"}}}");
        WechatMiniappProperties properties = new WechatMiniappProperties();
        properties.setAppId("wx-test");
        properties.setAppSecret("private-secret");
        JdkWechatMiniappPhoneClient client = new JdkWechatMiniappPhoneClient(http, redis, properties);

        assertThatThrownBy(() -> client.exchangePhoneCode("phone-code"))
            .hasMessageNotContaining("13800138000")
            .hasMessageNotContaining("phone-code")
            .hasMessageNotContaining("private-secret");
    }

    @Test
    void rejectsBadCodeBeforeAnyNetworkOrRedisAccess() {
        WechatMiniappProperties properties = new WechatMiniappProperties();
        properties.setAppId("wx-test");
        properties.setAppSecret("private-secret");
        JdkWechatMiniappPhoneClient client = new JdkWechatMiniappPhoneClient(http, redis, properties);

        assertThatThrownBy(() -> client.exchangePhoneCode(" "))
            .isInstanceOf(org.springframework.security.authentication.BadCredentialsException.class);
        assertThatThrownBy(() -> client.exchangePhoneCode("x".repeat(513)))
            .isInstanceOf(org.springframework.security.authentication.BadCredentialsException.class);
        verifyNoInteractions(http, redis);
    }

    @Test
    void rejectsProviderErrorsMalformedAndOversizedResponses() throws Exception {
        when(redis.opsForValue()).thenReturn(values);
        when(values.get("byai:wechat:miniapp:token:wx-test")).thenReturn("cached-token");
        WechatMiniappProperties properties = new WechatMiniappProperties();
        properties.setAppId("wx-test");
        properties.setAppSecret("private-secret");
        JdkWechatMiniappPhoneClient client = new JdkWechatMiniappPhoneClient(http, redis, properties);

        for (String body : java.util.List.of(
            "{\"errcode\":40029,\"errmsg\":\"private provider detail\"}",
            "{bad",
            "{\"errcode\":0,\"phone_info\":{}}",
            "x".repeat(64 * 1024 + 1))) {
            stub(200, body);
            assertThatThrownBy(() -> client.exchangePhoneCode("one-time-code"))
                .hasMessageNotContaining("one-time-code")
                .hasMessageNotContaining("private provider detail");
        }
        stub(503, "private provider detail");
        assertThatThrownBy(() -> client.exchangePhoneCode("one-time-code"))
            .hasMessageNotContaining("private provider detail");
        when(http.send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class)))
            .thenThrow(new HttpTimeoutException("private provider detail"));
        assertThatThrownBy(() -> client.exchangePhoneCode("one-time-code"))
            .hasMessageNotContaining("private provider detail");
    }

    @Test
    void refreshesApplicationTokenBeforeSubmittingOneTimePhoneCode() throws Exception {
        when(redis.opsForValue()).thenReturn(values);
        when(values.setIfAbsent(any(String.class), any(String.class), any(java.time.Duration.class)))
            .thenReturn(true);
        when(redis.execute(any(org.springframework.data.redis.core.script.DefaultRedisScript.class), anyList(),
            any(String.class), any(String.class), any(String.class))).thenReturn(1L);
        HttpResponse<InputStream> token = response(200, "{\"access_token\":\"fresh-token\",\"expires_in\":7200}");
        HttpResponse<InputStream> phone = response(200,
            "{\"errcode\":0,\"phone_info\":{\"phoneNumber\":\"13800138000\","
                + "\"watermark\":{\"appid\":\"wx-test\"}}}");
        when(http.send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class)))
            .thenReturn(token, phone);
        WechatMiniappProperties properties = new WechatMiniappProperties();
        properties.setAppId("wx-test");
        properties.setAppSecret("private-secret");
        JdkWechatMiniappPhoneClient client = new JdkWechatMiniappPhoneClient(http, redis, properties);

        assertThat(client.exchangePhoneCode("one-time-code")).isEqualTo("13800138000");

        ArgumentCaptor<HttpRequest> requests = ArgumentCaptor.forClass(HttpRequest.class);
        verify(http, times(2)).send(requests.capture(), any(HttpResponse.BodyHandler.class));
        assertThat(requests.getAllValues().get(0).uri().getPath()).isEqualTo("/cgi-bin/token");
        assertThat(requests.getAllValues().get(1).uri().getPath())
            .isEqualTo("/wxa/business/getuserphonenumber");
        assertThat(requests.getAllValues().get(1).uri().getQuery())
            .isEqualTo("access_token=fresh-token");
    }

    @Test
    void evictsOnlyTheRejectedCachedApplicationTokenWithoutReplayingPhoneCode() throws Exception {
        when(redis.opsForValue()).thenReturn(values);
        when(values.get("byai:wechat:miniapp:token:wx-test")).thenReturn("cached-token");
        stub(200, "{\"errcode\":40001,\"errmsg\":\"expired access token\"}");
        WechatMiniappProperties properties = new WechatMiniappProperties();
        properties.setAppId("wx-test");
        properties.setAppSecret("private-secret");
        JdkWechatMiniappPhoneClient client = new JdkWechatMiniappPhoneClient(http, redis, properties);

        assertThatThrownBy(() -> client.exchangePhoneCode("one-time-code"))
            .hasMessageNotContaining("one-time-code")
            .hasMessageNotContaining("cached-token");
        verify(redis).execute(any(org.springframework.data.redis.core.script.DefaultRedisScript.class),
            eq(java.util.Collections.singletonList("byai:wechat:miniapp:token:wx-test")),
            eq("cached-token"));
        verify(http).send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class));
    }

    @SuppressWarnings("unchecked")
    private void stub(int status, String body) throws Exception {
        HttpResponse<InputStream> result = response(status, body);
        when(http.send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class)))
            .thenReturn(result);
    }

    @SuppressWarnings("unchecked")
    private HttpResponse<InputStream> response(int status, String body) {
        HttpResponse<InputStream> result = mock(HttpResponse.class);
        when(result.statusCode()).thenReturn(status);
        when(result.body()).thenReturn(new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)));
        return result;
    }
}
