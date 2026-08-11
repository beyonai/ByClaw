package com.iwhalecloud.byai.manager.domain.connector.provider.lark;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.times;

import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.sandbox.command.SandboxCommandExecutor;
import com.iwhalecloud.byai.gateway.sandbox.command.SandboxCommandResult;
import com.iwhalecloud.byai.gateway.sandbox.command.SandboxCommandRequest;
import com.iwhalecloud.byai.gateway.sandbox.service.UserSandboxResolver;
import com.iwhalecloud.byai.gateway.sandbox.service.UserSandboxResolver.UserSandboxContext;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStartContext;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ManifestCommandCatalog;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.users.Users;

class LarkSandboxAuthorizationRuntimeTest {

    @Test
    void usesOpenClawSandboxExecutorWithoutExternalConfiguration() {
        LarkAuthorizationProperties properties = new LarkAuthorizationProperties();

        assertThat(properties.isSandboxExecutor()).isTrue();
        assertThat(properties.getSandboxServiceKey()).isEqualTo("openclaw");
    }

    @Test
    void revokesCredentialInsideResolvedSandbox() {
        SandboxCommandExecutor executor = mock(SandboxCommandExecutor.class);
        UserSandboxResolver resolver = mock(UserSandboxResolver.class);
        UserService userService = mock(UserService.class);
        LarkSandboxAuthorizationRuntime runtime = new LarkSandboxAuthorizationRuntime(
            executor, resolver, new LarkAuthorizationProperties(), new ObjectMapper(), userService);
        when(resolver.resolve("42", "openclaw"))
            .thenReturn(new UserSandboxContext("sandbox-1", "42", null, new Date()));
        when(executor.run(any(), any())).thenReturn(new SandboxCommandResult(0, "{}", "", false, false));

        runtime.revoke("42", commandCatalog());

        var requestCaptor = org.mockito.ArgumentCaptor.forClass(SandboxCommandRequest.class);
        verify(executor).run(org.mockito.ArgumentMatchers.eq("sandbox-1"), requestCaptor.capture());
        assertThat(requestCaptor.getValue().argv()).containsExactly("lark-cli", "auth", "logout", "--json");
    }

    @Test
    void startsUserAuthorizationInsideResolvedSandbox() {
        SandboxCommandExecutor executor = mock(SandboxCommandExecutor.class);
        UserSandboxResolver resolver = mock(UserSandboxResolver.class);
        UserService userService = mock(UserService.class);
        LarkAuthorizationProperties properties = new LarkAuthorizationProperties();
        LarkSandboxAuthorizationRuntime runtime = new LarkSandboxAuthorizationRuntime(
            executor, resolver, properties, new ObjectMapper(), userService);
        Users user = new Users();
        user.setUserCode("user-code-42");
        when(userService.findById(42L)).thenReturn(user);
        when(resolver.resolve("user-code-42", "openclaw"))
            .thenReturn(new UserSandboxContext("sandbox-1", "42", "generation-1", new Date()));
        when(executor.run(any(), any()))
            .thenReturn(new SandboxCommandResult(0, "{\"configured\":true}", "", false, false))
            .thenReturn(new SandboxCommandResult(0,
                "{\"verification_url\":\"https://open.feishu.cn/device\","
                    + "\"device_code\":\"device-1\",\"expires_in\":120}", "", false, false));

        var result = runtime.start(new AuthorizationStartContext(
            "auth-1", "42", 1L, "lark", "lark-cli", "https://localhost/callback", Map.of(), commandCatalog()));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.PENDING);
        assertThat(result.authorizationUrl()).isEqualTo("https://open.feishu.cn/device");
        assertThat(result.providerState()).contains("sandbox-1", "device-1");
        verify(resolver).resolve("user-code-42", "openclaw");
    }

    @Test
    void bindsOpenClawContextWhenLoginReturnsNotConfiguredOnStderr() {
        SandboxCommandExecutor executor = mock(SandboxCommandExecutor.class);
        UserSandboxResolver resolver = mock(UserSandboxResolver.class);
        UserService userService = mock(UserService.class);
        LarkAuthorizationProperties properties = new LarkAuthorizationProperties();
        LarkSandboxAuthorizationRuntime runtime = new LarkSandboxAuthorizationRuntime(
            executor, resolver, properties, new ObjectMapper(), userService);
        when(resolver.resolve("42", "openclaw"))
            .thenReturn(new UserSandboxContext("sandbox-1", "42", null, new Date()));
        when(executor.run(any(), any()))
            .thenReturn(new SandboxCommandResult(0, "{\"configured\":true}", "", false, false))
            .thenReturn(new SandboxCommandResult(0, "", "{\"error\":{\"subtype\":\"not_configured\"}}", false, false))
            .thenReturn(new SandboxCommandResult(0, "{}", "", false, false))
            .thenReturn(new SandboxCommandResult(0,
                "{\"verification_url\":\"https://open.feishu.cn/device\",\"device_code\":\"device-1\"}",
                "", false, false));

        var result = runtime.start(new AuthorizationStartContext(
            "auth-1", "42", 1L, "lark", "lark-cli", null, Map.of(), commandCatalog()));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.PENDING);
        var requestCaptor = org.mockito.ArgumentCaptor.forClass(SandboxCommandRequest.class);
        verify(executor, times(4)).run(org.mockito.ArgumentMatchers.eq("sandbox-1"), requestCaptor.capture());
        assertThat(requestCaptor.getAllValues().get(2).argv()).contains("config", "bind", "--source", "openclaw");
    }

    @Test
    void acceptsDeviceVerificationUrlOnAccountsHost() {
        SandboxCommandExecutor executor = mock(SandboxCommandExecutor.class);
        UserSandboxResolver resolver = mock(UserSandboxResolver.class);
        UserService userService = mock(UserService.class);
        LarkSandboxAuthorizationRuntime runtime = new LarkSandboxAuthorizationRuntime(
            executor, resolver, new LarkAuthorizationProperties(), new ObjectMapper(), userService);
        when(resolver.resolve("42", "openclaw"))
            .thenReturn(new UserSandboxContext("sandbox-1", "42", null, new Date()));
        String verificationUrl =
            "https://accounts.feishu.cn/oauth/v1/device/verify?flow_id=flow-1&user_code=5ZMG-MUFK";
        when(executor.run(any(), any()))
            .thenReturn(new SandboxCommandResult(0, "{\"configured\":true}", "", false, false))
            .thenReturn(new SandboxCommandResult(0,
                "{\"verification_url\":\"" + verificationUrl + "\","
                    + "\"device_code\":\"device-1\",\"expires_in\":600}", "", false, false));

        var result = runtime.start(new AuthorizationStartContext(
            "auth-1", "42", 1L, "lark", "lark-cli", null, Map.of(), commandCatalog()));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.PENDING);
        assertThat(result.authorizationUrl()).isEqualTo(verificationUrl);
    }

    @Test
    void rejectsVerificationUrlOnUntrustedHost() {
        SandboxCommandExecutor executor = mock(SandboxCommandExecutor.class);
        UserSandboxResolver resolver = mock(UserSandboxResolver.class);
        UserService userService = mock(UserService.class);
        LarkSandboxAuthorizationRuntime runtime = new LarkSandboxAuthorizationRuntime(
            executor, resolver, new LarkAuthorizationProperties(), new ObjectMapper(), userService);
        when(resolver.resolve("42", "openclaw"))
            .thenReturn(new UserSandboxContext("sandbox-1", "42", null, new Date()));
        when(executor.run(any(), any()))
            .thenReturn(new SandboxCommandResult(0, "{\"configured\":true}", "", false, false))
            .thenReturn(new SandboxCommandResult(0,
                "{\"verification_url\":\"https://accounts.feishu.cn.evil.example/verify\","
                    + "\"device_code\":\"device-1\"}", "", false, false));

        var result = runtime.start(new AuthorizationStartContext(
            "auth-1", "42", 1L, "lark", "lark-cli", null, Map.of(), commandCatalog()));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.errorCode()).isEqualTo("PROVIDER_PROTOCOL_ERROR");
    }

    @Test
    void verifyReadsUserIdentityFromUnwrappedCliPayload() {
        SandboxCommandExecutor executor = mock(SandboxCommandExecutor.class);
        UserSandboxResolver resolver = mock(UserSandboxResolver.class);
        UserService userService = mock(UserService.class);
        LarkSandboxAuthorizationRuntime runtime = new LarkSandboxAuthorizationRuntime(
            executor, resolver, new LarkAuthorizationProperties(), new ObjectMapper(), userService);
        when(resolver.resolve("42", "openclaw"))
            .thenReturn(new UserSandboxContext("sandbox-1", "42", null, new Date()));
        when(executor.run(any(), any())).thenReturn(new SandboxCommandResult(0, """
            {"appId":"cli_app","brand":"feishu","identity":"user","verified":true,
             "identities":{"bot":{"status":"ready","verified":true,"openId":"ou_bot"},
                           "user":{"status":"ready","verified":true,
                                   "openId":"ou_65c765c074a0098a75f51a15f454313a",
                                   "userName":"谢逊飞","tokenStatus":"valid",
                                   "expiresAt":"2030-08-10T23:58:47+08:00",
                                   "refreshExpiresAt":"2030-08-17T21:58:47+08:00"}}}
            """, "", false, false));

        var result = runtime.verify("42", commandCatalog());

        assertThat(result.status()).isEqualTo(AuthorizationStatus.CONNECTED);
        assertThat(result.accountId()).isEqualTo("ou_65c765c074a0098a75f51a15f454313a");
        assertThat(result.accountName()).isEqualTo("谢逊飞");
        assertThat(result.credentialExpiresAt())
            .isEqualTo(Date.from(Instant.parse("2030-08-10T15:58:47Z")));
    }

    private ManifestCommandCatalog commandCatalog() {
        return new ManifestCommandCatalog(
            Map.of(
                "configCheck", List.of(List.of("lark-cli", "config", "show")),
                "configInitialize", List.of(List.of("lark-cli", "config", "init", "--new", "--force-init")),
                "contextBind", List.of(List.of(
                    "lark-cli", "config", "bind", "--source", "openclaw", "--identity", "user-default", "--force")),
                "login", List.of(
                    List.of("lark-cli", "auth", "login", "--domain", "all", "--no-wait", "--json"),
                    List.of("lark-cli", "auth", "login", "--device-code", "${deviceCode}", "--json")),
                "status", List.of(List.of("lark-cli", "auth", "status", "--json", "--verify")),
                "logout", List.of(List.of("lark-cli", "auth", "logout", "--json"))
            ),
            "test-digest",
            Map.of("deviceCode", ManifestCommandCatalog.PlaceholderPolicy.safeValue(512))
        );
    }
}
