package com.iwhalecloud.byai.manager.domain.connector.provider.wecom;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.TimeUnit;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.gateway.sandbox.command.SandboxCommandExecutor;
import com.iwhalecloud.byai.gateway.sandbox.command.SandboxCommandRequest;
import com.iwhalecloud.byai.gateway.sandbox.command.SandboxCommandResult;
import com.iwhalecloud.byai.gateway.sandbox.command.SandboxProcessHandle;
import com.iwhalecloud.byai.gateway.sandbox.command.SandboxProcessSnapshot;
import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformRemoteGateway;
import com.iwhalecloud.byai.gateway.sandbox.service.UserSandboxResolver;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorSandboxCommandLauncher;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorSandboxCommandLauncher.Profile;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCliRunner;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCliRunner.CliResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCliRunner.ManagedProcess;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialWorkspaceService;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialWorkspaceService.ConnectorCliWorkspace;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.users.Users;

/** Binds one authorization attempt to the same private filesystem used by the user's agent. */
@Component
public class WecomCliExecution {
    private static final String HOME = "/by/.connector-auth/.wecom-cli";
    private static final int MAX_OUTPUT_BYTES = 64 * 1024;
    private static final Duration CONTROL_TIMEOUT = Duration.ofSeconds(30);
    private static final Map<String, String> ENVIRONMENT = Map.of(
        "HOME", HOME, "WECOM_HOME", HOME,
        "WECOM_CLI_CONFIG_DIR", HOME + "/.config/wecom", "WECOM_CLI_ACCESS_TOKEN", "");
    private final ConnectorCliRunner localRunner;
    private final ConnectorCredentialWorkspaceService workspaces;
    private final PlatformRemoteGateway gateway;
    private final UserSandboxResolver resolver;
    private final SandboxCommandExecutor executor;
    private final UserService users;

    @Autowired
    public WecomCliExecution(ConnectorCliRunner localRunner, ConnectorCredentialWorkspaceService workspaces,
            PlatformRemoteGateway gateway, UserSandboxResolver resolver, SandboxCommandExecutor executor,
            UserService users) {
        this.localRunner = Objects.requireNonNull(localRunner, "localRunner");
        this.workspaces = Objects.requireNonNull(workspaces, "workspaces");
        this.gateway = gateway;
        this.resolver = resolver;
        this.executor = executor;
        this.users = users;
    }

    WecomCliExecution(ConnectorCliRunner localRunner, ConnectorCredentialWorkspaceService workspaces) {
        this(localRunner, workspaces, null, null, null, null);
    }

    public Context resolve(Long userId) {
        if (userId == null || userId <= 0) throw new IllegalArgumentException("Invalid WeCom user");
        if (gateway == null || !gateway.isRemote()) {
            return new LocalContext(workspaces.resolve(userId, "wecom-cli"));
        }
        Users user = users.findById(userId);
        if (user == null || user.getUserCode() == null || user.getUserCode().isBlank()) {
            throw new IllegalStateException("Unable to resolve WeCom user");
        }
        UserSandboxResolver.UserSandboxContext sandbox = resolver.resolve(user.getUserCode());
        if (sandbox == null || sandbox.sandboxId() == null || sandbox.sandboxId().isBlank()
                || !user.getUserCode().equals(sandbox.userCode())) {
            throw new IllegalStateException("Unable to resolve WeCom sandbox");
        }
        RemoteContext context = new RemoteContext(sandbox.sandboxId());
        context.privateDirectory("prepare");
        return context;
    }

    public interface Context {
        CliResult run(List<String> command, Duration timeout);
        ManagedProcess start(List<String> command, Duration timeout);
        void removeCredentials();
    }

    private final class LocalContext implements Context {
        private final ConnectorCliWorkspace workspace;

        private LocalContext(ConnectorCliWorkspace workspace) { this.workspace = workspace; }

        @Override public CliResult run(List<String> command, Duration timeout) {
            return localRunner.run(command, commandEnvironment(workspace), null, timeout);
        }

        @Override public ManagedProcess start(List<String> command, Duration timeout) {
            return localRunner.start(command, commandEnvironment(workspace), null);
        }

        @Override public void removeCredentials() {
            try {
                for (String file : List.of("bot.enc", "token.enc", "credentials.enc")) {
                    Files.deleteIfExists(credentialDirectory(workspace).resolve(file));
                }
            } catch (IOException e) {
                throw new IllegalStateException("Unable to remove WeCom credential");
            }
        }
    }

    private Map<String, String> commandEnvironment(ConnectorCliWorkspace workspace) {
        Map<String, String> environment = new HashMap<>(workspace.environment());
        environment.put("WECOM_CLI_CONFIG_DIR", credentialDirectory(workspace).toString());
        environment.put("WECOM_CLI_ACCESS_TOKEN", "");
        return Map.copyOf(environment);
    }

    private Path credentialDirectory(ConnectorCliWorkspace workspace) {
        Path config = workspace.home().resolve(".config");
        Path wecomConfig = config.resolve("wecom");
        try {
            for (Path directory : List.of(workspace.home(), config, wecomConfig)) {
                if (Files.exists(directory, LinkOption.NOFOLLOW_LINKS)
                        && (!Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS)
                            || !directory.toRealPath().startsWith(workspace.home().toRealPath()))) {
                    throw new IllegalStateException("Invalid WeCom credential directory");
                }
            }
        } catch (IOException e) {
            throw new IllegalStateException("Unable to resolve WeCom credential directory");
        }
        return wecomConfig;
    }

    private final class RemoteContext implements Context {
        private final String sandboxId;
        private RemoteContext(String sandboxId) { this.sandboxId = sandboxId; }

        private SandboxCommandRequest request(List<String> command, Duration timeout, boolean background) {
            return new SandboxCommandRequest(List.copyOf(command), ENVIRONMENT, null,
                timeout, MAX_OUTPUT_BYTES, background);
        }

        @Override public CliResult run(List<String> command, Duration timeout) {
            return runLauncher(ConnectorSandboxCommandLauncher.wrap(Profile.WECOM,
                request(command, timeout, false)));
        }

        private CliResult runLauncher(SandboxCommandRequest request) {
            SandboxCommandResult result = executor.run(sandboxId, request);
            if (result == null || result.stdout() == null || result.stderr() == null) {
                throw new IllegalStateException("Invalid WeCom command response");
            }
            String output = result.stdout() + result.stderr();
            boolean truncated = result.truncated() || output.getBytes(StandardCharsets.UTF_8).length > MAX_OUTPUT_BYTES;
            return new CliResult(result.timedOut() ? 124 : result.exitCode(),
                truncated ? "" : output, truncated);
        }

        @Override public ManagedProcess start(List<String> command, Duration timeout) {
            SandboxProcessHandle process = executor.start(sandboxId, ConnectorSandboxCommandLauncher.wrap(
                Profile.WECOM, request(command, timeout, true)));
            if (process == null || !sandboxId.equals(process.sandboxId())
                    || process.processId() == null || process.processId().isBlank()) {
                throw new IllegalStateException("Invalid WeCom process response");
            }
            return new RemoteProcess(sandboxId, process.processId());
        }

        private void privateDirectory(String operation) {
            List<String> argv = "revoke".equals(operation) ? ConnectorSandboxCommandLauncher.revokeWecom()
                : ConnectorSandboxCommandLauncher.prepare(Profile.WECOM);
            CliResult result = runLauncher(request(argv, CONTROL_TIMEOUT, false));
            if (result.exitCode() != 0 || result.truncated()) {
                throw new IllegalStateException("Unable to prepare WeCom credential directory");
            }
        }

        @Override public void removeCredentials() { privateDirectory("revoke"); }
    }

    /** Adapts polling/cursor output to the local provider's existing process lifecycle contract. */
    private final class RemoteProcess implements ManagedProcess {
        private final String sandboxId;
        private final String processId;
        private final ByteArrayOutputStream output = new ByteArrayOutputStream();
        private long cursor;
        private long nextRefreshNanos;
        private boolean running = true;
        private boolean complete;
        private boolean truncated;
        private boolean destroyed;
        private Integer exitCode;

        private RemoteProcess(String sandboxId, String processId) {
            this.sandboxId = sandboxId;
            this.processId = processId;
        }

        private void refresh() {
            if (complete || destroyed || System.nanoTime() < nextRefreshNanos) return;
            SandboxProcessSnapshot status = executor.inspect(sandboxId, processId);
            if (status == null || status.state() == null) throw invalidProcess();
            if (status.state() == SandboxProcessSnapshot.State.NOT_FOUND) {
                running = false;
                complete = true;
                exitCode = -1;
                return;
            }
            SandboxProcessSnapshot logs = executor.readOutput(sandboxId, processId, cursor);
            if (logs == null || logs.output() == null || logs.state() == null
                    || logs.state() == SandboxProcessSnapshot.State.NOT_FOUND
                    || logs.nextCursor() < cursor
                    || (!logs.output().isEmpty() && logs.nextCursor() == cursor)) throw invalidProcess();
            byte[] bytes = logs.output().getBytes(StandardCharsets.UTF_8);
            truncated |= status.truncated() || logs.truncated() || bytes.length > MAX_OUTPUT_BYTES - output.size();
            output.write(bytes, 0, Math.min(bytes.length, MAX_OUTPUT_BYTES - output.size()));
            running = status.state() == SandboxProcessSnapshot.State.RUNNING;
            exitCode = running ? null : status.state() == SandboxProcessSnapshot.State.EXITED
                && status.exitCode() != null ? status.exitCode() : -1;
            complete = !running && logs.output().isEmpty() && logs.nextCursor() == cursor;
            cursor = logs.nextCursor();
            nextRefreshNanos = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(100);
        }

        @Override public synchronized boolean isAlive() { refresh(); return running && !destroyed; }
        @Override public synchronized Integer exitCode() { refresh(); return exitCode; }
        @Override public synchronized String output() { refresh(); return output.toString(StandardCharsets.UTF_8); }
        @Override public synchronized boolean outputComplete() { refresh(); return complete; }
        @Override public synchronized boolean outputTruncated() { refresh(); return truncated; }

        @Override public synchronized void destroy() {
            if (destroyed) return;
            for (int attempt = 0; attempt < 3; attempt++) {
                try {
                    executor.terminate(sandboxId, processId);
                    destroyed = true;
                    return;
                } catch (RuntimeException failure) {
                    if (attempt == 2) throw failure;
                }
            }
        }

        private IllegalStateException invalidProcess() {
            return new IllegalStateException("Invalid WeCom process response");
        }
    }
}
