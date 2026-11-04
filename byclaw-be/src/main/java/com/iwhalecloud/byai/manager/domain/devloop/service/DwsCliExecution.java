package com.iwhalecloud.byai.manager.domain.devloop.service;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.gateway.sandbox.command.SandboxCommandExecutor;
import com.iwhalecloud.byai.gateway.sandbox.command.SandboxCommandRequest;
import com.iwhalecloud.byai.gateway.sandbox.command.SandboxCommandResult;
import com.iwhalecloud.byai.gateway.sandbox.command.SandboxProcessHandle;
import com.iwhalecloud.byai.gateway.sandbox.command.SandboxProcessSnapshot;
import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformRemoteGateway;
import com.iwhalecloud.byai.gateway.sandbox.service.UserSandboxResolver;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCliRunner.CliResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCliRunner.ManagedProcess;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorSandboxCommandLauncher;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorSandboxCommandLauncher.Profile;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.users.Users;

/** Routes DWS to the same private storage and execution identity used by the user's agent. */
@Component
public class DwsCliExecution {
    static final int DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;
    static final int MAX_CALLER_OUTPUT_BYTES = 16 * 1024 * 1024;
    private static final String HOME = "/by/.connector-auth/.dws";
    private static final Map<String, String> ENVIRONMENT = Map.of(
        "HOME", HOME, "DWS_HOME", HOME, "DWS_CONFIG_DIR", HOME + "/config", "DWS_DISABLE_KEYCHAIN", "1",
        "DWS_CLIENT_ID", "", "DWS_CLIENT_SECRET", "");

    private final PlatformRemoteGateway gateway;
    private final UserSandboxResolver resolver;
    private final SandboxCommandExecutor executor;
    private final UserService users;

    public DwsCliExecution(PlatformRemoteGateway gateway, UserSandboxResolver resolver,
            SandboxCommandExecutor executor, UserService users) {
        this.gateway = gateway;
        this.resolver = resolver;
        this.executor = executor;
        this.users = users;
    }

    public boolean isRemote() { return gateway.isRemote(); }

    public Context resolve(Long userId) {
        if (userId == null || userId <= 0) throw new WorkspaceUnavailableException();
        try {
            Users user = users.findById(userId);
            if (user == null || user.getUserCode() == null || user.getUserCode().isBlank()) {
                throw new WorkspaceUnavailableException();
            }
            UserSandboxResolver.UserSandboxContext sandbox = resolver.resolve(user.getUserCode());
            if (sandbox == null || sandbox.sandboxId() == null || sandbox.sandboxId().isBlank()
                    || !user.getUserCode().equals(sandbox.userCode())) {
                throw new WorkspaceUnavailableException();
            }
            return new RemoteContext(sandbox.sandboxId());
        } catch (WorkspaceUnavailableException e) {
            throw e;
        } catch (RuntimeException e) {
            // Never expose platform connection details or fall back to BE-local credentials.
            throw new WorkspaceUnavailableException();
        }
    }

    public interface Context {
        CliResult run(List<String> command, Duration timeout, int maxOutputBytes);
        ManagedProcess start(List<String> command, Duration timeout);
    }

    public static final class WorkspaceUnavailableException extends IllegalStateException {
        public WorkspaceUnavailableException() { super("Unable to resolve DWS credential workspace"); }
    }

    static void validate(List<String> command, Duration timeout, int maxOutputBytes) {
        if (command == null || command.isEmpty() || command.getFirst() == null || command.getFirst().isBlank()
                || command.stream().anyMatch(argument -> argument == null || argument.indexOf('\0') >= 0)
                || timeout == null || timeout.isNegative() || timeout.isZero()
                || maxOutputBytes <= 0 || maxOutputBytes > MAX_CALLER_OUTPUT_BYTES) {
            throw new IllegalArgumentException("Invalid DWS command request");
        }
    }

    private final class RemoteContext implements Context {
        private final String sandboxId;

        private RemoteContext(String sandboxId) { this.sandboxId = sandboxId; }

        private SandboxCommandRequest request(List<String> command, Duration timeout, int maxOutputBytes,
                boolean background) {
            validate(command, timeout, maxOutputBytes);
            return ConnectorSandboxCommandLauncher.wrap(Profile.DWS, new SandboxCommandRequest(
                List.copyOf(command), ENVIRONMENT, null, timeout, maxOutputBytes, background));
        }

        @Override public CliResult run(List<String> command, Duration timeout, int maxOutputBytes) {
            SandboxCommandResult result = executor.run(sandboxId, request(command, timeout, maxOutputBytes, false));
            if (result == null || result.stdout() == null || result.stderr() == null) {
                throw new IllegalStateException("Invalid DWS command response");
            }
            String output = result.stdout() + result.stderr();
            boolean truncated = result.truncated() || output.getBytes(StandardCharsets.UTF_8).length > maxOutputBytes;
            return new CliResult(result.timedOut() ? 124 : result.exitCode(), truncated ? "" : output, truncated);
        }

        @Override public ManagedProcess start(List<String> command, Duration timeout) {
            SandboxProcessHandle process = executor.start(sandboxId,
                request(command, timeout, DEFAULT_MAX_OUTPUT_BYTES, true));
            if (process == null || !sandboxId.equals(process.sandboxId())
                    || process.processId() == null || process.processId().isBlank()) {
                throw new IllegalStateException("Invalid DWS process response");
            }
            return new RemoteProcess(sandboxId, process.processId());
        }
    }

    /** Polls a pinned process handle; output cursors are independent of process status. */
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
                    || logs.state() == SandboxProcessSnapshot.State.NOT_FOUND || logs.nextCursor() < cursor
                    || (!logs.output().isEmpty() && logs.nextCursor() == cursor)) throw invalidProcess();
            byte[] bytes = logs.output().getBytes(StandardCharsets.UTF_8);
            truncated |= status.truncated() || logs.truncated()
                || bytes.length > DEFAULT_MAX_OUTPUT_BYTES - output.size();
            output.write(bytes, 0, Math.min(bytes.length, DEFAULT_MAX_OUTPUT_BYTES - output.size()));
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
            return new IllegalStateException("Invalid DWS process response");
        }
    }
}
