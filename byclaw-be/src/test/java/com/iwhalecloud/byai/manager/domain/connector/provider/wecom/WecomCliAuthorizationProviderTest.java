package com.iwhalecloud.byai.manager.domain.connector.provider.wecom;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationSessionContext;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStartContext;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStartResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCliRunner;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialWorkspaceService;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialWorkspaceService.ConnectorCliWorkspace;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorManifestCommandResolver;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ManifestCommandCatalog;
import com.iwhalecloud.byai.manager.domain.connector.manifest.ConnectorManifestCanonicalizer;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;

class WecomCliAuthorizationProviderTest {
    private static final List<String> INIT =
        List.of("wecom-cli", "auth", "init", "--noninteractive", "--no-browser");
    private static final List<String> STATUS = List.of("wecom-cli", "auth", "show", "--status");
    private static final List<String> CLEAR = List.of("wecom-cli", "cache", "clear");
    private static final String QR_URL = "https://work.weixin.qq.com/ai/qc/gen?source=wecom_cli_external&scode=test";
    private static final String AUTH_CONFIG =
        "{\"authorizationTimeoutSeconds\":120,\"probeCommand\":[\"wecom-cli\",\"auth\",\"show\",\"--status\"]}";

    @TempDir
    Path home;
    private FakeRunner runner;
    private ConnectorCredentialWorkspaceService workspaces;
    private WecomCliAuthorizationProvider provider;

    @BeforeEach
    void setUp() {
        runner = new FakeRunner();
        workspaces = mock(ConnectorCredentialWorkspaceService.class);
        when(workspaces.resolve(10001L, "wecom-cli"))
            .thenReturn(new ConnectorCliWorkspace(home, Map.of("HOME", home.toString())));
        provider = new WecomCliAuthorizationProvider(
            runner, workspaces, new ObjectMapper(), Duration.ofMillis(50), Duration.ofMillis(1));
    }

    @AfterEach
    void tearDown() {
        provider.shutdown();
    }

    @Test
    void verifiesTheExplicitAuthStatusWithoutSearchingContacts() {
        runner.respond = command -> command.equals(STATUS)
            ? new ConnectorCliRunner.CliResult(0, "authorized\n")
            : new ConnectorCliRunner.CliResult(2, "command not found");

        assertEquals(AuthorizationStatus.CONNECTED, provider.verify(10001L, connector()).status());
        assertEquals(List.of(STATUS), runner.commands);
        assertEquals(home.resolve(".config/wecom").toString(), runner.environment.get("WECOM_CLI_CONFIG_DIR"));
        assertEquals("", runner.environment.get("WECOM_CLI_ACCESS_TOKEN"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"unauthorized", "", "authorized\nunauthorized", "{\"errcode\":0}",
        "{\"error\":{\"message\":\"unauthorized\"}}", "Status: authorized"})
    void rejectsEveryOutputExceptTheExactAuthorizedStatus(String output) {
        runner.respond = command -> new ConnectorCliRunner.CliResult(0, output);

        assertNotEquals(AuthorizationStatus.CONNECTED, provider.verify(10001L, connector()).status());
        assertEquals(List.of(STATUS), runner.commands);
    }

    @Test
    void existingConnectorConfigurationAllowsDefaultProbeAndUnrelatedSettings() {
        ConnectorInfo connector = connector();
        connector.setAuthConfig("{\"authorizationTimeoutSeconds\":300,\"description\":\"preserved setting\"}");
        runner.respond = command -> new ConnectorCliRunner.CliResult(0, "authorized");

        assertEquals(AuthorizationStatus.CONNECTED, provider.verify(10001L, connector).status());
        assertEquals(List.of(STATUS), runner.commands);
    }

    @Test
    void realManifestResolutionUsesTheNewStatusCommand() {
        provider.shutdown();
        ObjectMapper mapper = new ObjectMapper();
        provider = new WecomCliAuthorizationProvider(runner, workspaces, mapper,
            new ConnectorManifestCommandResolver(mapper, new ConnectorManifestCanonicalizer(mapper)));
        ConnectorInfo connector = connector();
        connector.setConnectorCode("wecom");
        connector.setSkillCode("wecomcli");
        connector.setRuntimeManifest("""
            {"schemaVersion":"1.0","id":"wecom","version":"1.3.4",
             "runtime":{"type":"cli","authorizeIn":"be-auth-job","commands":{
               "login":[["wecom-cli","auth","init","--noninteractive","--no-browser"]],
               "status":[["wecom-cli","auth","show","--status"]],
               "logout":[["wecom-cli","cache","clear"]]}},
             "authStorage":{"mode":"native-home","owner":"be-auth-job","runtimeMutation":"provider-refresh-only",
               "nativePath":"/by/.connector-auth/.wecom-cli","environment":{"WECOM_HOME":"/by/.connector-auth/.wecom-cli"}},
             "skill":{"code":"wecomcli","source":"system-builtin","installScope":"user","grantScope":"agent"}}
            """);
        runner.respond = command -> new ConnectorCliRunner.CliResult(0, "authorized");

        assertEquals(AuthorizationStatus.CONNECTED, provider.verify(10001L, connector).status());
        assertEquals(List.of(STATUS), runner.commands);

        runner.commands.clear();
        connector.setRuntimeManifest(connector.getRuntimeManifest().replace(
            "[\"wecom-cli\",\"auth\",\"show\",\"--status\"]", "[\"wecom-cli\",\"auth\",\"show\"]"));
        assertNotEquals(AuthorizationStatus.CONNECTED, provider.verify(10001L, connector).status());
        assertTrue(runner.commands.isEmpty());
    }

    @Test
    void rejectsFailedOrTruncatedAuthStatusEvenWhenOutputSaysAuthorized() {
        runner.respond = command -> new ConnectorCliRunner.CliResult(1, "authorized");
        assertNotEquals(AuthorizationStatus.CONNECTED, provider.verify(10001L, connector()).status());
        runner.respond = command -> new ConnectorCliRunner.CliResult(0, "authorized", true);
        assertNotEquals(AuthorizationStatus.CONNECTED, provider.verify(10001L, connector()).status());
        runner.respond = command -> new ConnectorCliRunner.CliResult(124, "authorized");
        assertEquals("CONNECTOR_VERIFICATION_TIMEOUT", provider.verify(10001L, connector()).errorCode());
    }

    @Test
    void waitsForInitExitThenChecksAuthStatusAfterReturningTheQrPage() {
        runner.process.output = "正在获取二维码...\n请打开二维码链接扫码: \n" + QR_URL + "\n等待扫码中...\n";
        AuthorizationStartResult started = provider.start(startContext(catalog()));
        assertEquals(AuthorizationStatus.PENDING, started.status());
        assertEquals(QR_URL, started.authorizationUrl());
        assertEquals(INIT, runner.startedCommand);
        AuthorizationSessionContext session = session(started, catalog());
        assertEquals(AuthorizationStatus.PENDING, provider.queryStatus(session).status());
        assertTrue(runner.commands.isEmpty());

        runner.process.alive = false;
        runner.process.output += "初始化完成 ✅\n";
        runner.respond = command -> new ConnectorCliRunner.CliResult(0, "authorized\n");
        assertEquals(AuthorizationStatus.CONNECTED, provider.queryStatus(session).status());
        assertEquals(List.of(STATUS), runner.commands);
    }

    @Test
    void bootstrapErrorUrlInStdoutIsNotAnAuthorizationLink() {
        runner.process.alive = false;
        runner.process.exitCode = 1;
        runner.process.output = "{\"error\":{\"endpoint\":\"https://qyapi.weixin.qq.com/cgi-bin/aibot/cli/get_cli_config\"}}\n";

        AuthorizationStartResult started = provider.start(startContext(catalog()));
        assertEquals(AuthorizationStatus.FAILED, started.status());
        assertNull(started.authorizationUrl());
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "error: unrecognized subcommand 'init'\n\nUsage: wecom-cli auth <COMMAND>\n",
        "\u001B[31merror:\u001B[0m unrecognized subcommand 'auth'\nUsage: wecom-cli <COMMAND>\n",
        "error: unexpected argument '--no-browser' found\nUsage: wecom-cli auth init [OPTIONS]\n"
    })
    void incompatibleCliCommandsReturnAnActionableFailureWithoutRawOutput(String diagnostic) {
        runner.process.alive = false;
        runner.process.exitCode = 2;
        runner.process.output = diagnostic + "private-token-fixture\n";

        AuthorizationStartResult started = provider.start(startContext(catalog()));

        assertEquals(AuthorizationStatus.FAILED, started.status());
        assertEquals("PROVIDER_CLI_INCOMPATIBLE", started.errorCode());
        assertEquals("WeCom CLI does not support the required authorization command; upgrade the sandbox image and instance",
            started.errorMessage());
        assertNull(started.authorizationUrl());
        assertTrue(runner.commands.isEmpty());
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "permission denied: /private-token-fixture\n",
        "{\"error\":\"unrecognized subcommand 'init'\",\"token\":\"private-token-fixture\"}\n",
        "{\"error\":{\"endpoint\":\"https://qyapi.weixin.qq.com/cgi-bin/aibot/cli/get_cli_config\"}}\n"
    })
    void failedInitializationIsNotReportedAsAMissingAuthorizationUrl(String output) {
        runner.process.alive = false;
        runner.process.exitCode = 1;
        runner.process.output = output;

        AuthorizationStartResult started = provider.start(startContext(catalog()));

        assertEquals(AuthorizationStatus.FAILED, started.status());
        assertEquals("PROVIDER_START_FAILED", started.errorCode());
        assertEquals("Unable to start WeCom authorization", started.errorMessage());
        assertNull(started.authorizationUrl());
        assertTrue(runner.commands.isEmpty());
    }

    @Test
    void failedTerminalProcessCannotReturnAPreviouslyPrintedAuthorizationUrl() {
        runner.process.alive = false;
        runner.process.exitCode = 1;
        runner.process.output = QR_URL + "\nprivate-token-fixture\n";

        AuthorizationStartResult started = provider.start(startContext(catalog()));

        assertEquals(AuthorizationStatus.FAILED, started.status());
        assertEquals("PROVIDER_START_FAILED", started.errorCode());
        assertNull(started.authorizationUrl());
        assertTrue(runner.commands.isEmpty());
    }

    @Test
    void runningInitializationWithoutACompleteAuthorizationUrlStillTimesOutAsUrlMissing() {
        runner.process.output = "正在获取二维码...\n";

        AuthorizationStartResult started = provider.start(startContext(catalog()));

        assertEquals(AuthorizationStatus.FAILED, started.status());
        assertEquals("PROVIDER_AUTH_URL_MISSING", started.errorCode());
        assertFalse(runner.process.alive);
    }

    @Test
    void failedBootstrapCannotReuseOldLocalCredentialsToReportSuccessfulNewAuthorization() {
        runner.process.output = "请打开二维码链接扫码:\n" + QR_URL + "\n";
        AuthorizationStartResult started = provider.start(startContext(catalog()));
        assertEquals(AuthorizationStatus.PENDING, started.status());
        runner.process.alive = false;
        runner.process.exitCode = 1;
        runner.process.output += "{\"error\":{\"code\":853000,\"message\":\"invalid credential\"}}\n";
        runner.respond = command -> new ConnectorCliRunner.CliResult(0, "authorized");

        assertEquals(AuthorizationStatus.FAILED, provider.queryStatus(session(started, catalog())).status());
        assertTrue(runner.commands.isEmpty());
    }

    @Test
    void processLostDuringRestartCannotProveNewAuthorizationCompleted() {
        AuthorizationSessionContext session = new AuthorizationSessionContext("lost", "10001", 1L,
            "wecom", "wecom-cli", null, AUTH_CONFIG, new java.util.Date(System.currentTimeMillis() + 300_000), catalog());
        runner.respond = command -> new ConnectorCliRunner.CliResult(0, "authorized");

        assertEquals(AuthorizationStatus.FAILED, provider.queryStatus(session).status());
        assertTrue(runner.commands.isEmpty());
    }

    @Test
    void rejectsManifestLoginArgumentsThatChangeTheAuthorizedFlow() {
        ManifestCommandCatalog commands = new ManifestCommandCatalog(Map.of(
            "login", List.of(List.of("wecom-cli", "auth", "init", "--manual")),
            "status", List.of(STATUS), "logout", List.of(CLEAR)), "invalid-flow", Map.of());

        assertEquals("PROVIDER_CONFIG_INVALID", provider.start(startContext(commands)).errorCode());
        assertNull(runner.startedCommand);
    }

    @Test
    void revocationRemovesCurrentAndLegacyCredentialsButPreservesOtherFiles() throws Exception {
        Path config = Files.createDirectories(home.resolve(".config/wecom"));
        for (String file : List.of("credentials.enc", "bot.enc", "token.enc", ".encryption_key", "config.json")) {
            Files.writeString(config.resolve(file), "test fixture");
        }
        runner.respond = command -> {
            if (command.equals(CLEAR)) {
                for (String file : List.of("credentials.enc", "bot.enc", "token.enc")) {
                    assertFalse(Files.exists(config.resolve(file)), "CLI startup must not migrate " + file);
                }
            }
            return command.equals(STATUS)
                ? new ConnectorCliRunner.CliResult(0, Files.exists(config.resolve("credentials.enc"))
                || Files.exists(config.resolve("bot.enc")) ? "authorized" : "unauthorized")
                : new ConnectorCliRunner.CliResult(0, "{\"status\":\"success\"}");
        };

        provider.revoke("10001", connector());

        for (String file : List.of("credentials.enc", "bot.enc", "token.enc")) {
            assertFalse(Files.exists(config.resolve(file)), file);
        }
        assertTrue(Files.exists(config.resolve(".encryption_key")));
        assertTrue(Files.exists(config.resolve("config.json")));
        assertEquals(List.of(CLEAR, STATUS), runner.commands);
    }

    @Test
    void revocationRejectsConfigurationDirectorySymlinks() throws Exception {
        Path outside = Files.createTempDirectory("wecom-unrelated-");
        try {
            Files.writeString(outside.resolve("credentials.enc"), "unrelated");
            Files.createDirectories(home.resolve(".config"));
            Files.createSymbolicLink(home.resolve(".config/wecom"), outside);

            assertThrows(IllegalStateException.class, () -> provider.revoke("10001", connector()));
            assertTrue(Files.exists(outside.resolve("credentials.enc")));
            assertTrue(runner.commands.isEmpty());
        } finally {
            Files.deleteIfExists(outside.resolve("credentials.enc"));
            Files.deleteIfExists(outside);
        }
    }

    @Test
    void revocationFailsIfCliStillReportsAuthorized() {
        runner.respond = command -> new ConnectorCliRunner.CliResult(0, "authorized");
        assertThrows(IllegalStateException.class, () -> provider.revoke("10001", connector()));
    }

    @Test
    void revokingOneUserKeepsAnotherUsersCredentialAndConfiguration() throws Exception {
        Path otherHome = Files.createDirectories(home.resolve("other-user"));
        Path firstConfig = Files.createDirectories(home.resolve(".config/wecom"));
        Path otherConfig = Files.createDirectories(otherHome.resolve(".config/wecom"));
        Files.writeString(firstConfig.resolve("credentials.enc"), "first fixture");
        Files.writeString(otherConfig.resolve("credentials.enc"), "other fixture");
        when(workspaces.resolve(10002L, "wecom-cli"))
            .thenReturn(new ConnectorCliWorkspace(otherHome, Map.of("HOME", otherHome.toString())));
        runner.respond = command -> new ConnectorCliRunner.CliResult(0,
            command.equals(STATUS) ? "unauthorized" : "{\"status\":\"success\"}");

        provider.revoke("10001", connector());
        assertFalse(Files.exists(firstConfig.resolve("credentials.enc")));
        assertEquals("other fixture", Files.readString(otherConfig.resolve("credentials.enc")));
        runner.respond = command -> new ConnectorCliRunner.CliResult(0, "authorized");
        assertEquals(AuthorizationStatus.CONNECTED, provider.verify(10002L, connector()).status());
        assertEquals(otherConfig.toString(), runner.environment.get("WECOM_CLI_CONFIG_DIR"));
    }

    @Test
    void credentialFileSymlinkIsUnlinkedWithoutDeletingItsTarget() throws Exception {
        Path config = Files.createDirectories(home.resolve(".config/wecom"));
        Path unrelated = Files.writeString(home.resolve("unrelated.enc"), "other fixture");
        Files.createSymbolicLink(config.resolve("credentials.enc"), unrelated);
        runner.respond = command -> new ConnectorCliRunner.CliResult(0,
            command.equals(STATUS) ? "unauthorized" : "{\"status\":\"success\"}");

        provider.revoke("10001", connector());
        assertFalse(Files.exists(config.resolve("credentials.enc")));
        assertEquals("other fixture", Files.readString(unrelated));
    }

    private ConnectorInfo connector() {
        ConnectorInfo connector = new ConnectorInfo();
        connector.setAuthConfig(AUTH_CONFIG);
        return connector;
    }

    private ManifestCommandCatalog catalog() {
        return new ManifestCommandCatalog(Map.of("login", List.of(INIT), "status", List.of(STATUS),
            "logout", List.of(CLEAR)), "wecom-1.3.4", Map.of());
    }

    private AuthorizationStartContext startContext(ManifestCommandCatalog commands) {
        return new AuthorizationStartContext("auth-1", "10001", 1L, "wecom", "wecom-cli", null,
            Map.of("authorizationTimeoutSeconds", 120, "probeCommand", STATUS), commands);
    }

    private AuthorizationSessionContext session(AuthorizationStartResult started, ManifestCommandCatalog commands) {
        return new AuthorizationSessionContext("auth-1", "10001", 1L, "wecom", "wecom-cli",
            started.providerSessionId(), started.providerState(), started.expiresAt(), commands);
    }

    private static final class FakeRunner extends ConnectorCliRunner {
        private final List<List<String>> commands = new ArrayList<>();
        private final FakeProcess process = new FakeProcess();
        private List<String> startedCommand;
        private Map<String, String> environment;
        private Function<List<String>, CliResult> respond = command -> new CliResult(2, "unexpected command");

        @Override
        public CliResult run(List<String> command, Map<String, String> env, String stdin, Duration timeout) {
            commands.add(List.copyOf(command));
            environment = Map.copyOf(env);
            return respond.apply(command);
        }

        @Override
        public ManagedProcess start(List<String> command, Map<String, String> env, String stdin) {
            startedCommand = List.copyOf(command);
            environment = Map.copyOf(env);
            return process;
        }
    }

    private static final class FakeProcess implements ConnectorCliRunner.ManagedProcess {
        private boolean alive = true;
        private int exitCode;
        private String output = "";

        public boolean isAlive() { return alive; }
        public Integer exitCode() { return alive ? null : exitCode; }
        public String output() { return output; }
        public boolean outputComplete() { return !alive; }
        public boolean outputTruncated() { return false; }
        public void destroy() { alive = false; }
    }
}
