package com.iwhalecloud.byai.manager.domain.connector.provider.weixin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class JdkWeixinOfficialApiClientTest {

    private final HttpClient httpClient = mock(HttpClient.class);
    private final JdkWeixinOfficialApiClient client = new JdkWeixinOfficialApiClient(httpClient);

    @Test
    void usesOnlyTheFixedTokenEndpointAndAcceptsAnAccessToken() throws Exception {
        stub(200, "{\"access_token\":\"token-that-must-not-be-returned\",\"expires_in\":7200}");

        assertThat(client.verify("wx app", "a&secret")).isEqualTo(WeixinOfficialApiClient.Status.VALID);

        ArgumentCaptor<HttpRequest> request = ArgumentCaptor.forClass(HttpRequest.class);
        org.mockito.Mockito.verify(httpClient).send(request.capture(), any(HttpResponse.BodyHandler.class));
        URI uri = request.getValue().uri();
        assertThat(uri.getScheme()).isEqualTo("https");
        assertThat(uri.getHost()).isEqualTo("api.weixin.qq.com");
        assertThat(uri.getPath()).isEqualTo("/cgi-bin/token");
        assertThat(uri.getRawQuery()).isEqualTo("grant_type=client_credential&appid=wx+app&secret=a%26secret");
    }

    @Test
    void mapsKnownWeixinCredentialAndAllowlistErrors() throws Exception {
        stub(200, "{\"errcode\":40013,\"errmsg\":\"invalid appid\"}");
        assertThat(client.verify("appid", "secret"))
            .isEqualTo(WeixinOfficialApiClient.Status.INVALID_CREDENTIALS);

        stub(200, "{\"errcode\":40125,\"errmsg\":\"invalid appsecret\"}");
        assertThat(client.verify("appid", "secret"))
            .isEqualTo(WeixinOfficialApiClient.Status.INVALID_CREDENTIALS);

        stub(200, "{\"errcode\":40164,\"errmsg\":\"invalid ip\"}");
        assertThat(client.verify("appid", "secret"))
            .isEqualTo(WeixinOfficialApiClient.Status.IP_NOT_ALLOWLISTED);
    }

    @Test
    void rejectsMalformedTrailingOversizedAndUnknownPayloads() throws Exception {
        for (String body : java.util.List.of(
                "{bad",
                "{\"access_token\":\"token\"} trailing",
                "{\"errcode\":99999}",
                "{\"errcode\":0}",
                "{\"access_token\":\"token\",\"errcode\":0}",
                "{\"access_token\":\"token\",\"expires_in\":0}",
                "{\"access_token\":\"token\",\"expires_in\":\"7200\"}")) {
            stub(200, body);
            assertThat(client.verify("appid", "secret")).isEqualTo(WeixinOfficialApiClient.Status.PROTOCOL_ERROR);
        }

        stub(200, "x".repeat(64 * 1024 + 1));
        assertThat(client.verify("appid", "secret")).isEqualTo(WeixinOfficialApiClient.Status.PROTOCOL_ERROR);
    }

    @Test
    void mapsTransportFailuresWithoutReturningProviderContent() throws Exception {
        stub(503, "private upstream response");
        assertThat(client.verify("appid", "secret")).isEqualTo(WeixinOfficialApiClient.Status.FAILED);

        when(httpClient.send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class)))
            .thenThrow(new HttpTimeoutException("secret timeout"));
        assertThat(client.verify("appid", "secret")).isEqualTo(WeixinOfficialApiClient.Status.TIMEOUT);

        when(httpClient.send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class)))
            .thenThrow(new IOException("secret io failure"));
        assertThat(client.verify("appid", "secret")).isEqualTo(WeixinOfficialApiClient.Status.FAILED);

        when(httpClient.send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class)))
            .thenThrow(new InterruptedException("secret interrupted"));
        assertThat(client.verify("appid", "secret")).isEqualTo(WeixinOfficialApiClient.Status.FAILED);
        assertThat(Thread.interrupted()).isTrue();
    }

    @SuppressWarnings("unchecked")
    private void stub(int statusCode, String body) throws Exception {
        HttpResponse<java.io.InputStream> response = mock(HttpResponse.class);
        when(response.statusCode()).thenReturn(statusCode);
        when(response.body()).thenReturn(new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)));
        when(httpClient.send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class))).thenReturn(response);
    }
}
