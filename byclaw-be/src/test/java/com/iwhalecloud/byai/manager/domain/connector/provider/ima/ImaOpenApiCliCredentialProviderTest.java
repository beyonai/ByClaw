package com.iwhalecloud.byai.manager.domain.connector.provider.ima;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCliRunner;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialFormVerification;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorManifestService;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import java.time.Duration;
import java.util.Map;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.mockito.ArgumentCaptor;

class ImaOpenApiCliCredentialProviderTest {

    private ConnectorCliRunner cliRunner;
    private ImaOpenApiCliCredentialProvider provider;

    @BeforeEach
    void setUp() {
        cliRunner = mock(ConnectorCliRunner.class);
        provider = new ImaOpenApiCliCredentialProvider(cliRunner);
    }

    @Test
    void verifiesCredentialsWithFixedArgvAndEnvironmentOnlySecrets() {
        when(cliRunner.run(any(), any(), eq(null), any(Duration.class))).thenReturn(new ConnectorCliRunner.CliResult(
            0,
            "{\"status\":\"ok\",\"checks\":{\"client_id_present\":true,\"api_key_present\":true,\"token_fetch\":true}}"
        ));

        CredentialFormVerification verification = provider.verify("1001", connector(), credentials());

        assertThat(verification.status().status()).isEqualTo(AuthorizationStatus.CONNECTED);
        assertThat(verification.status().accountName()).isEqualTo("IMA");
        assertThat(verification.runtimeEnvironment()).containsExactlyInAnyOrderEntriesOf(Map.of(
            "IMA_OPENAPI_CLIENTID", "client-id",
            "IMA_OPENAPI_APIKEY", "api-key"
        ));
        ArgumentCaptor<java.util.List<String>> command = ArgumentCaptor.forClass(java.util.List.class);
        ArgumentCaptor<Map<String, String>> environment = ArgumentCaptor.forClass(Map.class);
        ArgumentCaptor<Duration> timeout = ArgumentCaptor.forClass(Duration.class);
        verify(cliRunner).run(command.capture(), environment.capture(), eq(null), timeout.capture());
        assertThat(command.getValue()).containsExactly("ima", "auth", "check", "--test", "--json");
        assertThat(command.getValue()).doesNotContain("client-id", "api-key");
        assertThat(environment.getValue()).containsExactlyInAnyOrderEntriesOf(Map.of(
            "IMA_OPENAPI_CLIENTID", "client-id",
            "IMA_OPENAPI_APIKEY", "api-key"
        ));
        assertThat(timeout.getValue()).isEqualTo(Duration.ofSeconds(30));
    }

    @Test
    void returnsTimeoutWithoutEchoingOutput() {
        when(cliRunner.run(any(), any(), eq(null), any(Duration.class)))
            .thenReturn(new ConnectorCliRunner.CliResult(124, "api-key private output"));

        CredentialFormVerification verification = provider.verify("1001", connector(), credentials());

        assertThat(verification.status().errorCode()).isEqualTo("CONNECTOR_VERIFICATION_TIMEOUT");
        assertThat(verification.status().errorMessage()).doesNotContain("api-key", "private output");
    }

    @Test
    void rejectsMalformedOrIncompleteSuccessPayloads() {
        when(cliRunner.run(any(), any(), eq(null), any(Duration.class)))
            .thenReturn(new ConnectorCliRunner.CliResult(0, "{\"status\":\"ok\",\"checks\":{\"client_id_present\":true}}"));

        CredentialFormVerification verification = provider.verify("1001", connector(), credentials());

        assertThat(verification.status().errorCode()).isEqualTo("PROVIDER_PROTOCOL_ERROR");
    }

    @Test
    void rejectsUnknownPartialAndUnsafeCredentialValuesBeforeCallingCli() {
        assertThatThrownBy(() -> provider.verify("1001", connector(), Map.of("clientId", "ok")))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> provider.verify("1001", connector(), Map.of("clientId", "ok", "apiKey", "bad\nkey")))
            .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void enforcesCredentialBounds() {
        assertThatThrownBy(() -> provider.verify("1001", connector(), Map.of(
            "clientId", "x".repeat(257), "apiKey", "key"))).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> provider.verify("1001", connector(), Map.of(
            "clientId", "client", "apiKey", "x".repeat(2049)))).isInstanceOf(IllegalArgumentException.class);
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("classifiedProbeFailures")
    void classifiesStructuredProbeFailuresWithoutEchoingOutput(
            String name, String message, String expectedErrorCode) {
        String output = """
            {"status":"error","checks":{"client_id_present":true,"api_key_present":true,"token_fetch":false},
             "message":"%s"}
            """.formatted(message);
        when(cliRunner.run(any(), any(), eq(null), any(Duration.class)))
            .thenReturn(new ConnectorCliRunner.CliResult(1, output));

        CredentialFormVerification result = provider.verify("1001", connector(), credentials());

        assertThat(result.status().errorCode()).isEqualTo(expectedErrorCode);
        assertThat(result.status().errorMessage()).doesNotContain(
            "client-id", "api-key", message, "20002", "20004", "100005", "110030");
    }

    @Test
    void givesRateLimitClassificationPrecedenceOverGenericAuthenticationWords() {
        String output = """
            {"status":"error","checks":{"client_id_present":true,"api_key_present":true,"token_fetch":false},
             "message":"HTTP 429 unauthorized: too many requests"}
            """;
        when(cliRunner.run(any(), any(), eq(null), any(Duration.class)))
            .thenReturn(new ConnectorCliRunner.CliResult(1, output));

        assertThat(provider.verify("1001", connector(), credentials()).status().errorCode())
            .isEqualTo("IMA_RATE_LIMITED");
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("invalidFailurePayloads")
    void mapsMalformedNonzeroExitPayloadsToProtocolError(
            String name, ConnectorCliRunner.CliResult cliResult) {
        when(cliRunner.run(any(), any(), eq(null), any(Duration.class))).thenReturn(cliResult);

        CredentialFormVerification result = provider.verify("1001", connector(), credentials());

        assertThat(result.status().errorCode()).isEqualTo("PROVIDER_PROTOCOL_ERROR");
        assertThat(result.status().errorMessage()).doesNotContain("client-id", "api-key", "secret");
    }

    @Test
    void rejectsProtocolPayloadsThatAreNotStrictSuccessfulChecks() {
        for (String payload : java.util.List.of(
                "{\"status\":\"no\",\"checks\":{\"client_id_present\":true,\"api_key_present\":true,\"token_fetch\":true}}",
                "{\"status\":\"ok\",\"checks\":{\"client_id_present\":false,\"api_key_present\":true,\"token_fetch\":true}}",
                "{\"status\":\"ok\",\"checks\":{\"client_id_present\":true,\"api_key_present\":false,\"token_fetch\":true}}",
                "{\"status\":\"ok\",\"checks\":{\"client_id_present\":true,\"api_key_present\":true,\"token_fetch\":false}}",
                "{\"status\":\"ok\",\"checks\":{\"client_id_present\":true,\"api_key_present\":true,\"token_fetch\":true}} {}")) {
            when(cliRunner.run(any(), any(), eq(null), any(Duration.class)))
                .thenReturn(new ConnectorCliRunner.CliResult(0, payload));
            assertThat(provider.verify("1001", connector(), credentials()).status().errorCode())
                .isEqualTo("PROVIDER_PROTOCOL_ERROR");
        }
    }

    @Test
    void verifierReadsOnlyExactManagedPairAndReusesProbe() {
        ConnectorManifestService manifestService = mock(ConnectorManifestService.class);
        ImaOpenApiCliCredentialProvider verifier = new ImaOpenApiCliCredentialProvider(
            cliRunner, manifestService, new com.fasterxml.jackson.databind.ObjectMapper());
        ConnectorInfo connector = connector();
        when(manifestService.readManagedCredentialsForVerification(eq(1001L), eq(connector), any())).thenReturn(Map.of(
            "IMA_OPENAPI_CLIENTID", "client-id", "IMA_OPENAPI_APIKEY", "api-key"));
        when(cliRunner.run(any(), any(), eq(null), any(Duration.class))).thenReturn(new ConnectorCliRunner.CliResult(0,
            "{\"status\":\"ok\",\"checks\":{\"client_id_present\":true,\"api_key_present\":true,\"token_fetch\":true}}"));

        assertThat(verifier.verify(1001L, connector).status()).isEqualTo(AuthorizationStatus.CONNECTED);
        verify(manifestService).readManagedCredentialsForVerification(eq(1001L), eq(connector),
            eq(java.util.Set.of("IMA_OPENAPI_CLIENTID", "IMA_OPENAPI_APIKEY")));
    }

    @Test
    void acceptsExactCredentialLimitsAndRejectsEachBlankAndControlCharacter() {
        when(cliRunner.run(any(), any(), eq(null), any(Duration.class))).thenReturn(new ConnectorCliRunner.CliResult(0,
            "{\"status\":\"ok\",\"checks\":{\"client_id_present\":true,\"api_key_present\":true,\"token_fetch\":true}}"));
        assertThat(provider.verify("1001", connector(), Map.of("clientId", "c".repeat(256), "apiKey", "k".repeat(2048)))
            .status().status()).isEqualTo(AuthorizationStatus.CONNECTED);
        for (Map<String, String> invalid : java.util.List.of(
                Map.of("clientId", " ", "apiKey", "key"), Map.of("clientId", "client", "apiKey", " "),
                Map.of("clientId", "a\u0000b", "apiKey", "key"), Map.of("clientId", "a\rb", "apiKey", "key"),
                Map.of("clientId", "a\tb", "apiKey", "key"))) {
            assertThatThrownBy(() -> provider.verify("1001", connector(), invalid)).isInstanceOf(IllegalArgumentException.class);
        }
    }

    @Test
    void mapsRunnerStartFailureToUnavailableWithoutEchoingSecrets() {
        when(cliRunner.run(any(), any(), eq(null), any(Duration.class)))
            .thenThrow(new IllegalStateException("Unable to start connector CLI process client-id api-key"));
        CredentialFormVerification result = provider.verify("1001", connector(), credentials());
        assertThat(result.status().errorCode()).isEqualTo("CONNECTOR_CLI_UNAVAILABLE");
        assertThat(result.status().errorMessage()).doesNotContain("client-id", "api-key");
    }

    @Test
    void rejectsApiKeyCrLfNulAndOtherControlCharacters() {
        for (String apiKey : java.util.List.of("a\rb", "a\nb", "a\u0000b", "a\fb")) {
            assertThatThrownBy(() -> provider.verify("1001", connector(), Map.of("clientId", "client", "apiKey", apiKey)))
                .isInstanceOf(IllegalArgumentException.class);
        }
    }

    @Test
    void rejectsExtraCredentialKeyAndMalformedOrTruncatedJsonWithoutEchoingOutput() {
        assertThatThrownBy(() -> provider.verify("1001", connector(), Map.of(
            "clientId", "client-id", "apiKey", "api-key", "extra", "value"))).isInstanceOf(IllegalArgumentException.class);
        for (ConnectorCliRunner.CliResult result : java.util.List.of(
                new ConnectorCliRunner.CliResult(0, "{bad client-id api-key"),
                new ConnectorCliRunner.CliResult(0, "{\"status\":\"ok\"}", true))) {
            when(cliRunner.run(any(), any(), eq(null), any(Duration.class))).thenReturn(result);
            CredentialFormVerification verification = provider.verify("1001", connector(), credentials());
            assertThat(verification.status().errorCode()).isEqualTo("PROVIDER_PROTOCOL_ERROR");
            assertThat(verification.status().errorMessage()).doesNotContain("client-id", "api-key", "bad");
        }
    }

    @Test
    void executesRuntimeCommandsWithoutReturningCredentialsOrSensitiveOutputFields() {
        when(cliRunner.run(any(), any(), eq(null), any(Duration.class), eq(4 * 1024 * 1024))).thenReturn(new ConnectorCliRunner.CliResult(
            0, "{\"note\":\"api-key\",\"token\":\"private\",\"nested\":{\"secret_key\":\"private\"}}"));

        ImaOpenApiCliCredentialProvider.RuntimeCommandResult result = provider.executeRuntimeCommand(
            Map.of("IMA_OPENAPI_CLIENTID", "client-id", "IMA_OPENAPI_APIKEY", "api-key"),
            java.util.List.of("note", "search", "roadmap", "--json"));

        assertThat(result.ok()).isTrue();
        assertThat(result.exitCode()).isZero();
        assertThat(result.errorCode()).isNull();
        assertThat(result.data().toString()).contains("***").doesNotContain("client-id", "api-key", "token", "secret_key");
        ArgumentCaptor<java.util.List<String>> command = ArgumentCaptor.forClass(java.util.List.class);
        ArgumentCaptor<Map<String, String>> environment = ArgumentCaptor.forClass(Map.class);
        verify(cliRunner).run(command.capture(), environment.capture(), eq(null), eq(Duration.ofSeconds(120)),
            eq(4 * 1024 * 1024));
        assertThat(command.getValue()).containsExactly("ima", "note", "search", "roadmap", "--json");
        assertThat(environment.getValue()).containsKeys("IMA_OPENAPI_CLIENTID", "IMA_OPENAPI_APIKEY", "IMA_CONFIG_DIR")
            .doesNotContainKey("BEYOND_TOKEN");
    }

    @Test
    void reportsAnExplicitErrorWhenRuntimeJsonExceedsTheDedicatedResultLimit() {
        when(cliRunner.run(any(), any(), eq(null), any(Duration.class), eq(4 * 1024 * 1024)))
            .thenReturn(new ConnectorCliRunner.CliResult(0, "{\"partial\":true}", true));

        ImaOpenApiCliCredentialProvider.RuntimeCommandResult result = provider.executeRuntimeCommand(
            credentialsEnvironment(), java.util.List.of("note", "get", "doc-id", "--json"));

        assertThat(result.errorCode()).isEqualTo("IMA_RESULT_TOO_LARGE");
    }

    @Test
    void rejectsRuntimeCommandsOutsideTheAllowedSurfaceBeforeInvokingCli() {
        assertThatThrownBy(() -> provider.executeRuntimeCommand(
            Map.of("IMA_OPENAPI_CLIENTID", "client-id", "IMA_OPENAPI_APIKEY", "api-key"),
            java.util.List.of("auth", "config", "--json")))
            .isInstanceOf(IllegalArgumentException.class);
        verify(cliRunner, org.mockito.Mockito.never()).run(any(), any(), any(), any());
    }

    private ConnectorInfo connector() {
        ConnectorInfo connector = new ConnectorInfo();
        connector.setConnectorCode("ima-openapi");
        connector.setProviderCode("ima-openapi");
        return connector;
    }

    private Map<String, String> credentials() {
        return Map.of("clientId", "client-id", "apiKey", "api-key");
    }

    private Map<String, String> credentialsEnvironment() {
        return Map.of("IMA_OPENAPI_CLIENTID", "client-id", "IMA_OPENAPI_APIKEY", "api-key");
    }

    private static Stream<Arguments> classifiedProbeFailures() {
        return Stream.of(
            Arguments.of("IMA rate code", "20002 apiKey超过最大限频", "IMA_RATE_LIMITED"),
            Arguments.of("HTTP rate limit", "HTTP 429: Too Many Requests", "IMA_RATE_LIMITED"),
            Arguments.of("note permission", "100005 无权限", "IMA_PERMISSION_DENIED"),
            Arguments.of("wiki permission", "110030 permission denied", "IMA_PERMISSION_DENIED"),
            Arguments.of("IMA auth code", "20004 apikey鉴权失败", "CONNECTOR_CREDENTIAL_INVALID"),
            Arguments.of("English auth failure", "invalid credential", "CONNECTOR_CREDENTIAL_INVALID"),
            Arguments.of("network failure", "fetch failed: ENOTFOUND ima.qq.com", "IMA_SERVICE_UNAVAILABLE"),
            Arguments.of("TLS failure", "certificate verify failed", "IMA_SERVICE_UNAVAILABLE"),
            Arguments.of("upstream failure", "HTTP 503: Service Unavailable", "IMA_SERVICE_UNAVAILABLE"),
            Arguments.of("unknown valid failure", "unexpected upstream rejection", "CONNECTOR_VERIFICATION_FAILED")
        );
    }

    private static Stream<Arguments> invalidFailurePayloads() {
        return Stream.of(
            Arguments.of("truncated", new ConnectorCliRunner.CliResult(1, "{\"status\":\"error\"}", true)),
            Arguments.of("malformed", new ConnectorCliRunner.CliResult(1, "{bad secret")),
            Arguments.of("trailing JSON", new ConnectorCliRunner.CliResult(1,
                "{\"status\":\"error\",\"checks\":{\"client_id_present\":true,\"api_key_present\":true,"
                    + "\"token_fetch\":false},\"message\":\"secret\"} {}")),
            Arguments.of("missing checks", new ConnectorCliRunner.CliResult(1,
                "{\"status\":\"error\",\"message\":\"secret\"}")),
            Arguments.of("credentials reported absent", new ConnectorCliRunner.CliResult(1,
                "{\"status\":\"error\",\"checks\":{\"client_id_present\":false,\"api_key_present\":true,"
                    + "\"token_fetch\":false},\"message\":\"secret\"}")),
            Arguments.of("token fetch not boolean", new ConnectorCliRunner.CliResult(1,
                "{\"status\":\"error\",\"checks\":{\"client_id_present\":true,\"api_key_present\":true,"
                    + "\"token_fetch\":null},\"message\":\"secret\"}"))
        );
    }
}
