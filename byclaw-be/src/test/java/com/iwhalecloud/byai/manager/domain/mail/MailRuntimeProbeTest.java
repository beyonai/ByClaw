package com.iwhalecloud.byai.manager.domain.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.sandbox.command.SandboxCommandExecutor;
import com.iwhalecloud.byai.gateway.sandbox.command.OpenSandboxCommandExecutor;
import com.iwhalecloud.byai.gateway.sandbox.command.SandboxCommandRequest;
import com.iwhalecloud.byai.gateway.sandbox.command.SandboxCommandResult;
import com.iwhalecloud.byai.gateway.sandbox.service.UserSandboxResolver;
import com.iwhalecloud.byai.gateway.sandbox.client.OpenSandboxClient;
import com.iwhalecloud.byai.gateway.sandbox.config.SandboxProperties;
import com.iwhalecloud.byai.gateway.sandbox.service.UserSandboxResolver.UserSandboxContext;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.users.Users;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import com.sun.net.httpserver.HttpServer;

class MailRuntimeProbeTest {

    @TempDir
    Path sandboxRoot;

    private SandboxCommandExecutor executor;
    private UserSandboxResolver sandboxResolver;
    private MailRuntimeProbe probe;

    @BeforeEach
    void setUp() {
        executor = mock(SandboxCommandExecutor.class);
        sandboxResolver = mock(UserSandboxResolver.class);
        UserService userService = mock(UserService.class);
        Users user = new Users();
        user.setUserCode("user-42");
        when(userService.findById(42L)).thenReturn(user);
        when(sandboxResolver.resolve("user-42", "openclaw"))
            .thenReturn(new UserSandboxContext("sandbox-1", "user-42", "generation-1", new java.util.Date()));
        probe = new MailRuntimeProbe(executor, sandboxResolver, userService, new ObjectMapper());
    }

    @Test
    void invokesOnlyFixedShellFreeCheckCommandWithEmptyInputAndBoundedExecution() {
        when(executor.run(org.mockito.ArgumentMatchers.eq("sandbox-1"),
            org.mockito.ArgumentMatchers.any(SandboxCommandRequest.class)))
            .thenReturn(new SandboxCommandResult(0, success("NORMAL"), "", false, false));

        MailRuntimeProbe.Result result = probe.check(42L, 1001L);

        assertThat(result.status()).isEqualTo(MailRuntimeProbe.Status.NORMAL);
        var request = org.mockito.ArgumentCaptor.forClass(SandboxCommandRequest.class);
        verify(executor).run(org.mockito.ArgumentMatchers.eq("sandbox-1"), request.capture());
        assertThat(request.getValue().argv()).containsExactly(
            "python3", "/app/skills/mail/scripts/mailctl.py", "check", "--account", "1001");
        assertThat(request.getValue().environment()).isEmpty();
        assertThat(request.getValue().workingDirectory()).isNull();
        assertThat(request.getValue().timeout()).isEqualTo(Duration.ofSeconds(30));
        assertThat(request.getValue().maxOutputBytes()).isEqualTo(16 * 1024);
        assertThat(request.getValue().background()).isFalse();
    }

    @Test
    void realOpenSandboxExecutorContractReachesProjectedAccountRuntime() throws Exception {
        Path projection = sandboxRoot.toRealPath().resolve("by/.connector-auth/.mail/accounts.json");
        Files.createDirectories(projection.getParent());
        Files.setPosixFilePermissions(projection.getParent(), PosixFilePermissions.fromString("rwx------"));
        Files.writeString(projection, projection("1001"), StandardCharsets.UTF_8);
        Files.setPosixFilePermissions(projection, PosixFilePermissions.fromString("rw-------"));
        Path repository = Path.of(System.getProperty("user.dir")).toAbsolutePath();
        if (!Files.isDirectory(repository.resolve("middleware"))) {
            repository = repository.getParent();
        }
        Path scripts = repository.resolve("middleware/openclaw/skills/mail/scripts");
        Path bootstrap = sandboxRoot.resolve("sandbox-mailctl.py");
        String scriptsLiteral = new ObjectMapper().writeValueAsString(scripts.toString());
        String configLiteral = new ObjectMapper().writeValueAsString(projection.getParent().toString());
        Files.writeString(bootstrap, """
            import sys
            from pathlib import Path
            sys.path.insert(0, %s)
            from mailctl import main
            from mail_runtime.registry import AdapterRegistry
            class ProbeAdapter:
                def probe_connection(self): return None
                def list_messages(self, request): raise AssertionError('forbidden')
                def get_message(self, message_id): raise AssertionError('forbidden')
                def search_messages(self, request): raise AssertionError('forbidden')
                def download_attachment(self, request, sink): raise AssertionError('forbidden')
                def send_message(self, draft): raise AssertionError('forbidden')
                def reply_message(self, message_id, draft): raise AssertionError('forbidden')
                def delete_message(self, message_id): raise AssertionError('forbidden')
            registry = AdapterRegistry()
            registry.register('qq', lambda account: ProbeAdapter())
            raise SystemExit(main(sys.argv[1:], config_root=Path(%s), registry=registry))
            """.formatted(scriptsLiteral, configLiteral), StandardCharsets.UTF_8);
        AtomicReference<String> commandBody = new AtomicReference<>();
        AtomicReference<String> cliOutput = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        String endpoint = "http://127.0.0.1:" + server.getAddress().getPort();
        server.createContext("/v1/sandboxes/sandbox-1/endpoints/", exchange ->
            respond(exchange, "{\"endpoint\":\"" + endpoint + "\",\"headers\":{}}"));
        server.createContext("/command", exchange -> {
            commandBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            assertThat(commandBody.get()).contains(
                "'python3' '/app/skills/mail/scripts/mailctl.py' 'check' '--account' '1001'",
                "\"envs\":{}");
            long dispatchedTimeout = new ObjectMapper().readTree(commandBody.get()).path("timeout").longValue();
            assertThat(dispatchedTimeout).isBetween(1L, 30_000L);
            ProcessBuilder builder = new ProcessBuilder("python3", bootstrap.toString(),
                "check", "--account", "1001");
            builder.environment().clear();
            builder.environment().put("PATH", "/usr/bin:/opt/homebrew/bin:/usr/local/bin");
            Process process = builder.start();
            process.getOutputStream().close();
            String stdout = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            cliOutput.set(stdout);
            String stderr = new String(process.getErrorStream().readAllBytes(), StandardCharsets.UTF_8);
            int exitCode;
            try {
                exitCode = process.waitFor();
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                throw new java.io.IOException("test subprocess interrupted", interrupted);
            }
            assertThat(stderr).isEmpty();
            respond(exchange, "{\"type\":\"stdout\",\"text\":"
                + new ObjectMapper().writeValueAsString(stdout) + ",\"timestamp\":1}\n"
                + "{\"type\":\"execution_complete\",\"exit_code\":" + exitCode
                + ",\"timestamp\":2}\n");
        });
        server.start();
        try {
            SandboxProperties properties = new SandboxProperties();
            properties.getOpensandbox().setBaseUrl(endpoint);
            properties.getOpensandbox().setApiKey("test-only");
            MailRuntimeProbe realProbe = new MailRuntimeProbe(
                new OpenSandboxCommandExecutor(new OpenSandboxClient(properties)), sandboxResolver,
                userService(), new ObjectMapper());

            MailRuntimeProbe.Result first = realProbe.check(42L, 1001L);
            assertThat(cliOutput.get()).contains("\"ok\":true", "\"accountId\":\"1001\"");
            assertThat(first.status()).isEqualTo(MailRuntimeProbe.Status.NORMAL);
            Files.writeString(projection, projection("2002"), StandardCharsets.UTF_8);
            assertThat(realProbe.check(42L, 1001L).status()).isEqualTo(MailRuntimeProbe.Status.UNAVAILABLE);
        } finally {
            server.stop(0);
        }
    }

    private static String projection(String accountId) {
        return "{\"schemaVersion\":1,\"accounts\":[{"
            + "\"accountId\":\"" + accountId + "\",\"provider\":\"qq\","
            + "\"email\":\"person@example.test\",\"displayName\":\"Work\","
            + "\"default\":true,\"status\":\"NORMAL\","
            + "\"locatorKey\":\"MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA\","
            + "\"capabilities\":[\"list\",\"get\",\"search\",\"downloadAttachment\","
            + "\"send\",\"reply\",\"delete\"],"
            + "\"capabilityStatus\":{\"list\":\"YES\",\"get\":\"YES\","
            + "\"search\":\"YES\",\"downloadAttachment\":\"YES\",\"send\":\"YES\","
            + "\"reply\":\"YES\",\"delete\":\"YES\"},"
            + "\"auth\":{\"type\":\"APP_PASSWORD\",\"username\":\"person@example.test\","
            + "\"secret\":\"fixture-only\"},"
            + "\"server\":{\"imap\":{\"host\":\"imap.example.test\",\"port\":993,"
            + "\"encryption\":\"SSL\"},\"smtp\":{\"host\":\"smtp.example.test\","
            + "\"port\":465,\"encryption\":\"SSL\"}}}]}";
    }

    private UserService userService() {
        UserService service = mock(UserService.class);
        Users user = new Users();
        user.setUserCode("user-42");
        when(service.findById(42L)).thenReturn(user);
        return service;
    }

    private static void respond(com.sun.net.httpserver.HttpExchange exchange, String body) throws java.io.IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(200, bytes.length);
        try (OutputStream output = exchange.getResponseBody()) {
            output.write(bytes);
        }
    }

    @Test
    void mapsPartialAndAuthenticationAndUnavailableFailuresWithoutReturningRawDetails() {
        when(executor.run(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.any()))
            .thenReturn(new SandboxCommandResult(0, success("PARTIAL"), "", false, false))
            .thenReturn(new SandboxCommandResult(4,
                "{\"ok\":false,\"operation\":\"check\",\"accountId\":\"1001\",\"error\":{\"code\":\"AUTH_EXPIRED\",\"message\":\"safe\",\"retryable\":false,\"ambiguous\":false}}",
                "", false, false))
            .thenReturn(new SandboxCommandResult(124, "network-secret", "server-secret", false, true));

        assertThat(probe.check(42L, 1001L).status()).isEqualTo(MailRuntimeProbe.Status.PARTIAL);
        assertThat(probe.check(42L, 1001L).status()).isEqualTo(MailRuntimeProbe.Status.AUTH_REQUIRED);
        MailRuntimeProbe.Result unavailable = probe.check(42L, 1001L);
        assertThat(unavailable.status()).isEqualTo(MailRuntimeProbe.Status.UNAVAILABLE);
        assertThat(unavailable.safeError()).doesNotContain("network-secret");
    }

    @Test
    void reportsSandboxInfrastructureFailureWithoutConvertingItToAnAccountResult() {
        when(executor.run(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.any()))
            .thenThrow(new RuntimeException("sandbox-host=secret"));

        assertThatThrownBy(() -> probe.check(42L, 1001L))
            .isInstanceOf(MailRuntimeProbe.InfrastructureUnavailableException.class)
            .hasMessageNotContaining("secret");
    }

    @Test
    void returnsUnavailableForTruncatedMalformedDuplicateUnknownNestedOrMessageLikeOutput() {
        List<SandboxCommandResult> invalid = List.of(
            new SandboxCommandResult(0, success("NORMAL"), "", true, false),
            new SandboxCommandResult(0, "x".repeat(16 * 1024 + 1), "", false, false),
            new SandboxCommandResult(0, "not-json", "", false, false),
            new SandboxCommandResult(0, success("NORMAL").replaceFirst("\"status\":\"NORMAL\"", "\"status\":\"NORMAL\",\"status\":\"PARTIAL\""), "", false, false),
            new SandboxCommandResult(0, success("NORMAL").replaceFirst("\"latencyMs\":3", "\"latencyMs\":3,\"subject\":\"secret\""), "", false, false),
            new SandboxCommandResult(0, success("NORMAL").replaceFirst("\"latencyMs\":3", "\"latencyMs\":{\"value\":3}"), "", false, false),
            new SandboxCommandResult(0, success("NORMAL") + "\n{}", "", false, false),
            new SandboxCommandResult(0, success("NORMAL") + "{}", "", false, false),
            new SandboxCommandResult(0, success("NORMAL"), "stderr-secret", false, false)
        );
        for (SandboxCommandResult value : invalid) {
            when(executor.run(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.any()))
                .thenReturn(value);
            assertThat(probe.check(42L, 1001L).status()).isEqualTo(MailRuntimeProbe.Status.UNAVAILABLE);
        }
    }

    @Test
    void returnsOnlyAllowlistedCapabilityStatuses() {
        when(executor.run(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.any()))
            .thenReturn(new SandboxCommandResult(0, success("PARTIAL"), "", false, false));

        MailRuntimeProbe.Result result = probe.check(42L, 1001L);

        assertThat(result.capabilityStatus()).containsOnlyKeys(
            "list", "get", "search", "downloadAttachment", "send", "reply", "delete");
        assertThat(result.latencyMs()).isEqualTo(3L);
    }

    private String success(String status) {
        String search = "NORMAL".equals(status) ? "YES" : "CONDITIONAL_SERVER_SEARCH";
        String delete = "NORMAL".equals(status) ? "YES" : "NO";
        return "{\"ok\":true,\"operation\":\"check\",\"accountId\":\"1001\",\"data\":{"
            + "\"status\":\"" + status + "\",\"latencyMs\":3,\"capabilityStatus\":{"
            + "\"list\":\"YES\",\"get\":\"YES\",\"search\":\"" + search + "\","
            + "\"downloadAttachment\":\"YES\",\"send\":\"YES\",\"reply\":\"YES\",\"delete\":\""
            + delete + "\"}}}";
    }
}
