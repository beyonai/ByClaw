package com.iwhalecloud.byai.manager.domain.connector.provider.weixinopen;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.ByteArrayInputStream;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class JdkWeixinOpenPlatformClientTest {
    private final HttpClient http = mock(HttpClient.class);
    private final JdkWeixinOpenPlatformClient client = new JdkWeixinOpenPlatformClient(http);

    @Test
    void exchangesComponentTokenAndUsesFixedEndpoint() throws Exception {
        stub(200, "{\"component_access_token\":\"component-token\",\"expires_in\":7200}");

        assertThat(client.componentToken("wx-component", "secret", "ticket")).isEqualTo("component-token");

        ArgumentCaptor<HttpRequest> request = ArgumentCaptor.forClass(HttpRequest.class);
        verify(http).send(request.capture(), any(HttpResponse.BodyHandler.class));
        assertThat(request.getValue().uri().toString())
            .isEqualTo("https://api.weixin.qq.com/cgi-bin/component/api_component_token");
        assertThat(request.getValue().timeout()).contains(java.time.Duration.ofSeconds(30));
    }

    @Test
    void parsesPreauthQueryAndRefreshResponses() throws Exception {
        stub(200, "{\"pre_auth_code\":\"preauth\",\"expires_in\":600}");
        assertThat(client.createPreAuthCode("component-token", "wx-component")).isEqualTo("preauth");

        stub(200, "{\"authorization_info\":{\"authorizer_appid\":\"wx-authorizer\","
            + "\"authorizer_access_token\":\"authorizer-token\",\"expires_in\":7200,"
            + "\"authorizer_refresh_token\":\"refresh\",\"func_info\":[{\"funcscope_category\":{\"id\":1}}]}}");
        WeixinOpenPlatformClient.AuthorizerToken queried = client.queryAuthorization(
            "component-token", "wx-component", "auth-code");
        assertThat(queried.authorizerAppid()).isEqualTo("wx-authorizer");
        assertThat(queried.grantedScopes()).isEqualTo("1");

        stub(200, "{\"authorizer_access_token\":\"new-token\",\"expires_in\":7200,"
            + "\"authorizer_refresh_token\":\"new-refresh\"}");
        assertThat(client.refreshAuthorizerToken(
            "component-token", "wx-component", "wx-authorizer", "refresh").refreshToken())
            .isEqualTo("new-refresh");
    }

    @Test
    void fetchesAuthorizerProfileFromFixedOfficialEndpoint() throws Exception {
        stub(200, "{\"authorizer_info\":{\"nick_name\":\"笙歌数智录\","
            + "\"user_name\":\"gh_x\",\"principal_name\":\"XXX公司\"},"
            + "\"authorization_info\":{\"authorizer_appid\":\"wx-authorizer\"}}");

        WeixinOpenPlatformClient.AuthorizerProfile profile = client.getAuthorizerInfo(
            "component-token", "wx-component", "wx-authorizer");

        assertThat(profile).isEqualTo(new WeixinOpenPlatformClient.AuthorizerProfile(
            "wx-authorizer", "笙歌数智录", "gh_x", "XXX公司"));
        ArgumentCaptor<HttpRequest> request = ArgumentCaptor.forClass(HttpRequest.class);
        verify(http).send(request.capture(), any(HttpResponse.BodyHandler.class));
        assertThat(request.getValue().uri().toString()).isEqualTo(
            "https://api.weixin.qq.com/cgi-bin/component/api_get_authorizer_info"
                + "?component_access_token=component-token");
    }

    @Test
    void rejectsMismatchedAuthorizerProfile() throws Exception {
        stub(200, "{\"authorizer_info\":{\"nick_name\":\"name\",\"user_name\":\"gh_x\","
            + "\"principal_name\":\"company\"},"
            + "\"authorization_info\":{\"authorizer_appid\":\"wx-other\"}}");

        assertThatThrownBy(() -> client.getAuthorizerInfo(
            "component-token", "wx-component", "wx-authorizer"))
            .isInstanceOf(WeixinOpenPlatformClientException.class);
    }

    @Test
    void rejectsProviderErrorsWithoutLeakingProviderContent() throws Exception {
        stub(200, "{\"errcode\":40001,\"errmsg\":\"secret ticket component-token\"}");
        assertThatThrownBy(() -> client.componentToken("wx-component", "secret", "ticket"))
            .isInstanceOf(WeixinOpenPlatformClientException.class)
            .hasMessageNotContaining("secret")
            .hasMessageNotContaining("ticket")
            .hasMessageNotContaining("component-token");
    }

    @SuppressWarnings("unchecked")
    private void stub(int status, String body) throws Exception {
        HttpResponse<java.io.InputStream> response = mock(HttpResponse.class);
        when(response.statusCode()).thenReturn(status);
        when(response.body()).thenReturn(new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)));
        when(http.send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class))).thenReturn(response);
    }
}
