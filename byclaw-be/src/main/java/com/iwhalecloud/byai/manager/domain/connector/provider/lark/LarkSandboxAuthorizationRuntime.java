package com.iwhalecloud.byai.manager.domain.connector.provider.lark;

import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.springframework.stereotype.Component;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.iwhalecloud.byai.gateway.sandbox.command.SandboxCommandResult;
import com.iwhalecloud.byai.gateway.sandbox.command.SandboxProcessHandle;
import com.iwhalecloud.byai.gateway.sandbox.command.SandboxProcessSnapshot;
import com.iwhalecloud.byai.gateway.sandbox.command.SandboxCommandExecutor;
import com.iwhalecloud.byai.gateway.sandbox.service.UserSandboxResolver;
import com.iwhalecloud.byai.gateway.sandbox.service.UserSandboxResolver.UserSandboxContext;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationProgress;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationSessionContext;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStartContext;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStartResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatusResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorPermissionSummary;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialRenewalMode;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialLifecycleEvaluator;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialState;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ManifestCommandCatalog;

/** Lark authorization orchestration backed by OpenSandbox remote processes. */
@Component
public class LarkSandboxAuthorizationRuntime {

    private static final Logger log = LoggerFactory.getLogger(LarkSandboxAuthorizationRuntime.class);

    private static final String APP_PHASE = "app_initialization";
    private static final String USER_PHASE = "user_authorization";
    private static final Pattern URL_PATTERN = Pattern.compile("https://[^\\s\\p{Cntrl}]+",
        Pattern.CASE_INSENSITIVE);
    private static final Pattern MISSING_WORKSPACE_CONFIG_PATTERN = Pattern.compile(
        "[a-z][a-z0-9-]* context detected but lark-cli is not bound to it");
    /** Lark app-initialization hosts plus the device-verification hosts used by the device-code flow. */
    private static final Set<String> ALLOWED_AUTHORIZATION_HOSTS = Set.of(
        "open.feishu.cn", "open.larksuite.com", "accounts.feishu.cn", "accounts.larksuite.com");
    private static final Duration COMMAND_TIMEOUT = Duration.ofSeconds(30);
    private static final Duration INIT_TIMEOUT = Duration.ofMinutes(10);
    private static final long START_OUTPUT_POLL_MILLIS = 100;
    private static final long DEFAULT_EXPIRES_SECONDS = 600;
    private static final ManifestCommandCatalog.PlaceholderPolicy SCOPE_LIST =
        ManifestCommandCatalog.PlaceholderPolicy.scopeList(64 * 1024);

    private final SandboxCommandExecutor executor;
    private final UserSandboxResolver sandboxResolver;
    private final LarkSandboxCommandPolicy policy;
    private final ObjectMapper objectMapper;
    private final LarkAuthorizationProperties properties;
    private final UserService userService;

    public LarkSandboxAuthorizationRuntime(
            SandboxCommandExecutor executor,
            UserSandboxResolver sandboxResolver,
            LarkAuthorizationProperties properties,
            ObjectMapper objectMapper,
            UserService userService) {
        this.executor = executor;
        this.sandboxResolver = sandboxResolver;
        this.properties = properties;
        this.objectMapper = objectMapper;
        this.policy = new LarkSandboxCommandPolicy();
        this.userService = userService;
    }

    public AuthorizationStartResult start(AuthorizationStartContext context) {
        String userCode = resolveUserCode(context.userId());
        log.info("Starting Lark sandbox authorization: userCode={}, executor=sandbox", userCode);
        try {
            UserSandboxContext sandbox = sandboxResolver.resolve(userCode);
            SandboxCommandResult config = executor.run(sandbox.sandboxId(), policy.build(context.commandCatalog(),
                LarkSandboxCommandPolicy.Action.SHOW_CONFIG, null, COMMAND_TIMEOUT, properties.getMaxOutputBytes()));
            log.debug("Checked Lark sandbox configuration: userCode={}, sandboxId={}, exitCode={}",
                userCode, sandbox.sandboxId(), config.exitCode());
            if (isMissingConfiguration(config)) {
                return startApplicationInitialization(sandbox, context.commandCatalog());
            }
            if (config.exitCode() != 0 || config.truncated() || config.timedOut() || isNotConfigured(config)) {
                return failed("APP_CONFIG_CHECK_FAILED", "Unable to check Lark application configuration");
            }
            return startUserAuthorization(sandbox, null, context.commandCatalog());
        } catch (RuntimeException e) {
            log.warn("Lark sandbox authorization unavailable: userCode={}, reason={}", userCode, e.getMessage());
            return failed("LARK_SANDBOX_UNAVAILABLE", "User sandbox is unavailable");
        }
    }

    private AuthorizationStartResult startApplicationInitialization(
            UserSandboxContext sandbox, ManifestCommandCatalog commandCatalog) {
        SandboxProcessHandle process = null;
        boolean pending = false;
        boolean interrupted = false;
        try {
            process = executor.start(sandbox.sandboxId(), policy.build(commandCatalog,
                LarkSandboxCommandPolicy.Action.INITIALIZE_APP, null, INIT_TIMEOUT, properties.getMaxOutputBytes()));
            log.info("Started Lark app initialization: userCode={}, sandboxId={}, processId={}",
                sandbox.userCode(), sandbox.sandboxId(), process.processId());
            InitializationOutput output = waitForInitializationUrl(sandbox.sandboxId(), process.processId());
            if (output.url() == null) {
                log.warn("Lark app initialization did not return authorization URL: userCode={}, sandboxId={}, "
                        + "processId={}, timedOut={}", sandbox.userCode(), sandbox.sandboxId(), process.processId(),
                    output.timedOut());
                return output.timedOut()
                    ? failed("APP_INIT_URL_MISSING", "Lark application initialization URL was not provided")
                    : failed("APP_INIT_FAILED", "Unable to initialize Lark application");
            }
            ObjectNode state = baseState(sandbox, APP_PHASE);
            state.put("authorizationUrl", output.url());
            putProcess(state, process, output.cursor(), "initialize_app");
            AuthorizationStartResult result = pending(output.url(),
                new Date(System.currentTimeMillis() + INIT_TIMEOUT.toMillis()), state);
            log.info("Lark app initialization authorization URL received: userCode={}, sandboxId={}, processId={}",
                sandbox.userCode(), sandbox.sandboxId(), process.processId());
            pending = true;
            return result;
        } catch (InterruptedException e) {
            interrupted = true;
            return failed("APP_INIT_FAILED", "Unable to initialize Lark application");
        } catch (RuntimeException e) {
            log.warn("Unable to read Lark app initialization: userCode={}, sandboxId={}",
                sandbox.userCode(), sandbox.sandboxId());
            return failed("APP_INIT_FAILED", "Unable to initialize Lark application");
        } finally {
            // A transport may preserve the interrupt flag when throwing; let cleanup make its own bounded RPC.
            interrupted = Thread.interrupted() || interrupted;
            // Keep the process only after its complete URL and cursor have been handed to the authorization session.
            if (!pending && process != null) {
                try {
                    executor.terminate(sandbox.sandboxId(), process.processId());
                } catch (RuntimeException e) {
                    log.warn("Unable to terminate Lark app initialization: sandboxId={}, processId={}",
                        sandbox.sandboxId(), process.processId());
                }
            }
            if (interrupted) {
                Thread.currentThread().interrupt();
            }
        }
    }

    private InitializationOutput waitForInitializationUrl(String sandboxId, String processId)
            throws InterruptedException {
        Duration timeout = properties.getInitializationOutputTimeout();
        if (timeout == null || timeout.isZero() || timeout.isNegative()) {
            throw new IllegalArgumentException("Invalid Lark initialization output timeout");
        }
        long deadline = System.nanoTime() + timeout.toNanos();
        StringBuilder output = new StringBuilder();
        int outputBytes = 0;
        long cursor = 0;
        boolean exited = false;
        while (System.nanoTime() < deadline) {
            if (Thread.interrupted()) {
                throw new InterruptedException();
            }
            SandboxProcessSnapshot chunk = executor.readOutput(sandboxId, processId, cursor);
            if (failedInitializationSnapshot(chunk) || chunk.nextCursor() < cursor) {
                return new InitializationOutput(null, cursor, false);
            }
            String text = chunk.output() == null ? "" : chunk.output();
            int bytes = text.getBytes(StandardCharsets.UTF_8).length;
            if (bytes > properties.getMaxOutputBytes() - outputBytes
                    || (!text.isEmpty() && chunk.nextCursor() == cursor)) {
                return new InitializationOutput(null, cursor, false);
            }
            outputBytes += bytes;
            output.append(text);
            boolean drained = exited && text.isEmpty() && chunk.nextCursor() == cursor;
            cursor = chunk.nextCursor();
            // OpenSandbox log snapshots always say RUNNING, so the status API is authoritative for exit.
            SandboxProcessSnapshot status = executor.inspect(sandboxId, processId);
            if (Thread.interrupted()) {
                throw new InterruptedException();
            }
            if (failedInitializationSnapshot(status)) {
                return new InitializationOutput(null, cursor, false);
            }
            exited = status.state() == SandboxProcessSnapshot.State.EXITED;
            String completeOutput = output.toString();
            if (!drained || !exited) {
                // A syntactically valid URL may still be only the first chunk of its query string.
                int lineEnd = Math.max(completeOutput.lastIndexOf('\n'), completeOutput.lastIndexOf('\r'));
                completeOutput = completeOutput.substring(0, lineEnd + 1);
            }
            String url = firstUrl(completeOutput);
            if (url != null || (drained && exited)) {
                return new InitializationOutput(url, cursor, false);
            }
            long remaining = deadline - System.nanoTime();
            if (!exited && remaining > 0) {
                TimeUnit.NANOSECONDS.sleep(
                    Math.min(TimeUnit.MILLISECONDS.toNanos(START_OUTPUT_POLL_MILLIS), remaining));
            }
        }
        return new InitializationOutput(null, cursor, true);
    }

    private boolean failedInitializationSnapshot(SandboxProcessSnapshot snapshot) {
        return snapshot == null || snapshot.truncated()
            || (snapshot.state() != SandboxProcessSnapshot.State.RUNNING
                && (snapshot.state() != SandboxProcessSnapshot.State.EXITED
                    || !Integer.valueOf(0).equals(snapshot.exitCode())));
    }

    private record InitializationOutput(String url, long cursor, boolean timedOut) { }

    public AuthorizationStatusResult verify(String userId, ManifestCommandCatalog commandCatalog) {
        String userCode = resolveUserCode(userId);
        log.debug("Verifying Lark authorization in user sandbox: userCode={}", userCode);
        try {
            UserSandboxContext sandbox = sandboxResolver.resolve(userCode);
            return verified(sandbox.sandboxId(), commandCatalog);
        } catch (RuntimeException e) {
            log.warn("Lark sandbox verification unavailable: userCode={}, reason={}", userCode, e.getMessage());
            return failedStatus("LARK_SANDBOX_UNAVAILABLE", "User sandbox is unavailable");
        }
    }

    public void revoke(String userId, ManifestCommandCatalog commandCatalog) {
        String userCode = resolveUserCode(userId);
        UserSandboxContext sandbox = sandboxResolver.resolve(userCode);
        SandboxCommandResult result = executor.run(sandbox.sandboxId(), policy.build(commandCatalog,
            LarkSandboxCommandPolicy.Action.LOGOUT, null, COMMAND_TIMEOUT, properties.getMaxOutputBytes()));
        if (result == null || result.exitCode() != 0 || result.truncated() || result.timedOut()) {
            throw new IllegalStateException("Unable to revoke Lark credential");
        }
    }

    public AuthorizationStatusResult queryStatus(AuthorizationSessionContext session) {
        try {
            JsonNode state = objectMapper.readTree(session.providerState());
            String sandboxId = text(state, "sandboxId");
            if (sandboxId == null) {
                return failedStatus("PROVIDER_PROTOCOL_ERROR", "Lark authorization state is invalid");
            }
            if (APP_PHASE.equals(text(state, "phase"))) {
                return queryInitialization(session, state, sandboxId);
            }
            JsonNode process = state.get("process");
            if (process == null || !process.isObject()) {
                String deviceCode = text(state, "deviceCode");
                SandboxProcessHandle started = executor.start(sandboxId, policy.build(session.commandCatalog(),
                    LarkSandboxCommandPolicy.Action.COMPLETE_USER_AUTHORIZATION,
                    deviceCode, session.expiresAt() == null ? COMMAND_TIMEOUT : remaining(session.expiresAt()),
                    properties.getMaxOutputBytes()));
                putProcess((ObjectNode) state, started, 0, "complete_user_authorization");
                log.info("Started Lark user authorization completion: sandboxId={}, processId={}",
                    sandboxId, started.processId());
                return progress(session, USER_PHASE, state);
            }
            String processId = text(process, "processId");
            SandboxProcessSnapshot status = executor.inspect(sandboxId, processId);
            if (status.state() == SandboxProcessSnapshot.State.RUNNING) {
                return progress(session, USER_PHASE, state);
            }
            if (status.state() == SandboxProcessSnapshot.State.NOT_FOUND) {
                return failedStatus("LARK_SANDBOX_PROCESS_LOST", "Lark authorization process was lost");
            }
            // A previous token can remain usable throughout a new device flow, including after it fails.
            // Only this flow's successful completion may establish a new authorization result.
            boolean successfulExit = status.state() == SandboxProcessSnapshot.State.EXITED
                && Integer.valueOf(0).equals(status.exitCode());
            // The sandbox adapter represents every nonzero exit as FAILED, including CLI partial grants.
            boolean possiblePartialExit = Integer.valueOf(3).equals(status.exitCode())
                && (status.state() == SandboxProcessSnapshot.State.EXITED
                    || status.state() == SandboxProcessSnapshot.State.FAILED);
            if (status.truncated() || (!successfulExit && !possiblePartialExit)) {
                return failedStatus("PROVIDER_AUTH_FAILED", "Unable to complete Lark authorization");
            }
            JsonNode completion = readAuthorizationCompletion(sandboxId, processId);
            if (completion == null) {
                // Existing custom manifests can use text output. Only this process's successful exit
                // permits their legacy verification flow; JSON commands must always supply the event.
                if (!successfulExit || policy.completionUsesJson(session.commandCatalog(), text(state, "deviceCode"))) {
                    return failedStatus("PROVIDER_AUTH_FAILED", "Unable to complete Lark authorization");
                }
            } else if (text(completion, "user_open_id") == null
                    || (possiblePartialExit
                        && (scopes(completion.get("missing")) == null || scopes(completion.get("missing")).isEmpty()))) {
                return failedStatus("PROVIDER_AUTH_FAILED", "Unable to complete Lark authorization");
            }
            AuthorizationStatusResult verified = verified(sandboxId, session.commandCatalog(), state, completion);
            return verified.status() == AuthorizationStatus.CONNECTED
                ? verified : failedStatus("PROVIDER_AUTH_FAILED", "Unable to complete Lark authorization");
        } catch (RuntimeException | JsonProcessingException e) {
            return failedStatus("PROVIDER_PROTOCOL_ERROR", "Lark authorization state is invalid");
        }
    }

    public void cancel(AuthorizationSessionContext session) {
        if (session == null || session.providerState() == null) {
            return;
        }
        try {
            JsonNode state = objectMapper.readTree(session.providerState());
            JsonNode process = state.get("process");
            if (process != null) {
                log.info("Cancelling Lark sandbox authorization process: sandboxId={}, processId={}",
                    text(state, "sandboxId"), text(process, "processId"));
                executor.terminate(text(state, "sandboxId"), text(process, "processId"));
            }
        } catch (RuntimeException | JsonProcessingException ignored) {
            // Cancellation is terminal in the Redis state machine; remote termination is best effort.
        }
    }

    private AuthorizationStatusResult queryInitialization(AuthorizationSessionContext session, JsonNode state,
                                                           String sandboxId) throws JsonProcessingException {
        JsonNode process = state.get("process");
        String processId = text(process, "processId");
        long cursor = process.path("outputCursor").asLong(0);
        SandboxProcessSnapshot output = executor.readOutput(sandboxId, processId, cursor);
        String url = firstUrl(output.output());
        ObjectNode updated = (ObjectNode) state;
        ObjectNode processNode = updated.with("process");
        processNode.put("outputCursor", output.nextCursor());
        if (url != null) {
            updated.put("authorizationUrl", url);
        }
        SandboxProcessSnapshot status = executor.inspect(sandboxId, processId);
        if (status.state() == SandboxProcessSnapshot.State.RUNNING) {
            String authorizationUrl = text(updated, "authorizationUrl");
            return authorizationUrl == null
                ? failedStatus("APP_INIT_URL_MISSING", "Lark application initialization URL was not provided")
                : progress(session, APP_PHASE, updated);
        }
        if (status.state() != SandboxProcessSnapshot.State.EXITED || !Integer.valueOf(0).equals(status.exitCode())) {
            return failedStatus("APP_INIT_FAILED", "Unable to initialize Lark application");
        }
        SandboxCommandResult config = executor.run(sandboxId, policy.build(session.commandCatalog(),
            LarkSandboxCommandPolicy.Action.SHOW_CONFIG, null, COMMAND_TIMEOUT, properties.getMaxOutputBytes()));
        if (config == null || config.exitCode() != 0 || config.truncated() || config.timedOut()
                || isNotConfigured(config)) {
            return failedStatus("APP_INIT_FAILED", "Lark application configuration is unavailable after initialization");
        }
        UserSandboxContext sandbox = new UserSandboxContext(sandboxId, text(updated, "userCode"),
            text(updated, "sandboxGeneration"), null);
        AuthorizationStartResult login = startUserAuthorization(sandbox, updated, session.commandCatalog());
        if (login.status() == AuthorizationStatus.FAILED) {
            return failedStatus(login.errorCode(), login.errorMessage());
        }
        return new AuthorizationStatusResult(AuthorizationStatus.PENDING, null, null, null, null, null, null,
            new AuthorizationProgress(USER_PHASE, login.authorizationUrl(), login.providerState(), login.expiresAt()));
    }

    private AuthorizationStartResult startUserAuthorization(
            UserSandboxContext sandbox,
            ObjectNode existingState,
            ManifestCommandCatalog commandCatalog) {
        ScopeDiscovery discovery = discoverUserScopes(sandbox.sandboxId(), commandCatalog);
        boolean expanded = !discovery.scopes().isEmpty();
        SandboxCommandResult login = executor.run(sandbox.sandboxId(), policy.build(commandCatalog,
            expanded ? LarkSandboxCommandPolicy.Action.START_USER_AUTHORIZATION_WITH_SCOPES
                : LarkSandboxCommandPolicy.Action.START_USER_AUTHORIZATION,
            expanded ? String.join(" ", discovery.scopes()) : null, COMMAND_TIMEOUT,
            properties.getMaxOutputBytes()));
        if (isNotConfigured(login)) {
            return failed("PROVIDER_START_FAILED", "Lark application credentials are unavailable");
        }
        if (login == null || login.exitCode() != 0 || login.truncated() || login.timedOut()) {
            return failed("PROVIDER_START_FAILED", "Unable to start Lark authorization");
        }
        try {
            JsonNode root = objectMapper.readTree(login.stdout());
            JsonNode data = root.has("data") ? root.get("data") : root;
            String url = firstText(data, "verification_url", "verificationUrl", "verification_uri_complete");
            String deviceCode = firstText(data, "device_code", "deviceCode");
            if (url == null || deviceCode == null || !validUrl(url)) {
                return failed("PROVIDER_PROTOCOL_ERROR", "Lark authorization returned an invalid response");
            }
            long seconds = data.path("expires_in").asLong(DEFAULT_EXPIRES_SECONDS);
            ObjectNode state = existingState == null ? baseState(sandbox, USER_PHASE) : existingState;
            state.put("phase", USER_PHASE);
            state.put("authorizationUrl", url);
            state.put("deviceCode", deviceCode);
            state.put("scopeDiscovery", discovery.status());
            state.set("requestedUserScopes", objectMapper.valueToTree(discovery.scopes()));
            state.remove("process");
            return pending(url, new Date(System.currentTimeMillis() + seconds * 1000L), state);
        } catch (JsonProcessingException e) {
            return failed("PROVIDER_PROTOCOL_ERROR", "Lark authorization returned an invalid response");
        }
    }

    private AuthorizationStatusResult verified(String sandboxId, ManifestCommandCatalog commandCatalog) {
        return verified(sandboxId, commandCatalog, null, null);
    }

    private AuthorizationStatusResult verified(String sandboxId, ManifestCommandCatalog commandCatalog,
                                               JsonNode state, JsonNode completion) {
        SandboxCommandResult result = executor.run(sandboxId, policy.build(commandCatalog,
            LarkSandboxCommandPolicy.Action.VERIFY_AUTHORIZATION, null, COMMAND_TIMEOUT,
            properties.getMaxOutputBytes()));
        if (result == null || result.exitCode() != 0 || result.truncated() || result.timedOut()) {
            return failedStatus("PROVIDER_AUTH_FAILED", "Unable to verify Lark authorization");
        }
        try {
            JsonNode root = objectMapper.readTree(result.stdout());
            JsonNode data = root.has("data") ? root.get("data") : root;
            boolean verified = data.path("verified").asBoolean(false)
                && "user".equalsIgnoreCase(data.path("identity").asText());
            if (!verified) {
                return failedStatus("PROVIDER_AUTH_FAILED", "Lark authorization is not active");
            }
            JsonNode identity = data.path("identities").path("user");
            String accountId = firstText(identity, "openId", "open_id", "userId", "user_id");
            if (completion != null && !text(completion, "user_open_id").equals(accountId)) {
                return failedStatus("PROVIDER_AUTH_FAILED", "Lark authorization identity does not match");
            }
            Date expiresAt = dateValue(identity, data);
            Date refreshExpiresAt = dateValue(identity, data, "refreshExpiresAt", "refresh_expires_at");
            String tokenStatus = firstText(identity, "tokenStatus", "token_status");
            CredentialState credentialState = CredentialLifecycleEvaluator.evaluate(
                tokenStatus,
                null,
                refreshExpiresAt,
                new Date()
            );
            return AuthorizationStatusResult.connected(
                accountId,
                firstText(identity, "name", "displayName", "display_name", "userName", "user_name"),
                credentialState,
                refreshExpiresAt == null ? CredentialRenewalMode.NONE : CredentialRenewalMode.REFRESH_TOKEN,
                expiresAt,
                refreshExpiresAt,
                new Date(),
                null,
                state == null ? Map.of() : permissionAttributes(state, identity, completion));
        } catch (JsonProcessingException e) {
            return failedStatus("PROVIDER_PROTOCOL_ERROR", "Lark authorization returned an invalid response");
        }
    }

    private ScopeDiscovery discoverUserScopes(String sandboxId, ManifestCommandCatalog catalog) {
        if (!catalog.hasAction("scopesCheck") || !catalog.hasAction("loginWithScopes")) {
            return new ScopeDiscovery(List.of(), "unsupported");
        }
        try {
            SandboxCommandResult result = executor.run(sandboxId, policy.build(catalog,
                LarkSandboxCommandPolicy.Action.READ_USER_SCOPES, null, COMMAND_TIMEOUT, properties.getMaxOutputBytes()));
            if (result == null || result.exitCode() != 0 || result.truncated() || result.timedOut()) {
                return new ScopeDiscovery(List.of(), "unavailable");
            }
            JsonNode root = objectMapper.readTree(result.stdout());
            JsonNode data = root.has("data") ? root.get("data") : root;
            // New CLI releases can return unclassified scopes. Those must never be treated as user scopes.
            if (!"user".equals(text(data, "tokenType")) || !data.path("userScopes").isArray()) {
                return new ScopeDiscovery(List.of(), "unavailable");
            }
            List<String> enabled = scopes(data.get("userScopes"));
            return new ScopeDiscovery(enabled, "complete");
        } catch (RuntimeException | JsonProcessingException e) {
            // Preserve the existing domain-all flow if scope discovery cannot be completed.
            // The completion report explicitly marks the coverage as unknown instead of claiming completeness.
            log.warn("Unable to discover Lark user scopes: sandboxId={}", sandboxId);
            return new ScopeDiscovery(List.of(), "unavailable");
        }
    }

    private record ScopeDiscovery(List<String> scopes, String status) { }

    private JsonNode readAuthorizationCompletion(String sandboxId, String processId) throws JsonProcessingException {
        StringBuilder output = new StringBuilder();
        long cursor = 0;
        int bytes = 0;
        long deadline = System.nanoTime() + Duration.ofSeconds(15).toNanos();
        for (int chunkCount = 0; chunkCount < 64 && System.nanoTime() < deadline; chunkCount++) {
            SandboxProcessSnapshot chunk = executor.readOutput(sandboxId, processId, cursor);
            if (chunk == null || chunk.truncated() || chunk.nextCursor() < cursor) {
                throw new IllegalArgumentException("Invalid Lark authorization output");
            }
            String text = chunk.output() == null ? "" : chunk.output();
            int size = text.getBytes(StandardCharsets.UTF_8).length;
            if (size > properties.getMaxOutputBytes() - bytes || (!text.isEmpty() && chunk.nextCursor() == cursor)) {
                throw new IllegalArgumentException("Invalid Lark authorization output");
            }
            if (text.isEmpty() && chunk.nextCursor() == cursor) {
                JsonNode completion = null;
                // CLI --json emits the completion event as one JSON line; stderr progress may surround it.
                // Parse only after draining the exited process, so chunk boundaries cannot truncate a JSON line.
                for (String line : output.toString().split("\\R")) {
                    String trimmed = line.strip();
                    if (!trimmed.startsWith("{")) {
                        continue;
                    }
                    JsonNode candidate;
                    try {
                        candidate = objectMapper.readTree(trimmed);
                    } catch (JsonProcessingException ignored) {
                        continue;
                    }
                    if ("authorization_complete".equals(text(candidate, "event"))) {
                        if (completion != null) {
                            throw new IllegalArgumentException("Duplicate Lark authorization completion");
                        }
                        completion = candidate;
                    }
                }
                return completion;
            }
            output.append(text);
            bytes += size;
            cursor = chunk.nextCursor();
        }
        throw new IllegalArgumentException("Lark authorization output did not drain");
    }

    private Map<String, String> permissionAttributes(JsonNode state, JsonNode identity, JsonNode completion)
            throws JsonProcessingException {
        if (completion == null) {
            return ConnectorPermissionSummary.unknown().accountAttributes();
        }
        List<String> requested = scopes(completion.get("requested"));
        List<String> granted = scopes(identity.get("scope"));
        if (granted == null) {
            granted = scopes(completion.get("granted"));
        }
        Set<String> expected = new TreeSet<>();
        for (JsonNode node : List.of(state.path("requestedUserScopes"), completion.path("requested"),
                completion.path("missing"))) {
            List<String> names = scopes(node);
            if (names != null) {
                expected.addAll(names);
            }
        }
        if (expected.size() > 1024) {
            throw new IllegalArgumentException("Too many Lark authorization scopes");
        }
        Set<String> missing = new TreeSet<>(expected);
        if (granted != null) {
            missing.removeAll(granted);
        }
        String status = granted != null && !missing.isEmpty() ? "partial"
            : requested == null || granted == null || requested.isEmpty()
                || "unavailable".equals(text(state, "scopeDiscovery")) ? "unknown" : "complete";
        return Map.of("permissionStatus", status, "missingScopes",
            objectMapper.writeValueAsString(granted == null ? List.of() : missing));
    }

    private List<String> scopes(JsonNode value) {
        if (value == null || value.isNull() || value.isMissingNode()) {
            return null;
        }
        Set<String> names = new TreeSet<>();
        if (value.isTextual()) {
            String text = value.textValue();
            if (text.isEmpty()) {
                return List.of();
            }
            if (!SCOPE_LIST.isValid(text)) {
                throw new IllegalArgumentException("Invalid Lark scopes");
            }
            names.addAll(List.of(text.split(" ")));
        } else if (value.isArray() && value.size() <= 1024) {
            for (JsonNode item : value) {
                if (!item.isTextual() || item.textValue().contains(" ") || !SCOPE_LIST.isValid(item.textValue())) {
                    throw new IllegalArgumentException("Invalid Lark scope name");
                }
                names.add(item.textValue());
            }
        } else {
            throw new IllegalArgumentException("Invalid Lark scope list");
        }
        if (!names.isEmpty() && !SCOPE_LIST.isValid(String.join(" ", names))) {
            throw new IllegalArgumentException("Lark scope list is too large");
        }
        return List.copyOf(names);
    }

    private AuthorizationStatusResult progress(AuthorizationSessionContext session, String phase, JsonNode state) {
        String url = text(state, "authorizationUrl");
        return new AuthorizationStatusResult(AuthorizationStatus.PENDING, null, null, null, null, null, null,
            new AuthorizationProgress(phase, url, state.toString(), session.expiresAt()));
    }

    private ObjectNode baseState(UserSandboxContext sandbox, String phase) {
        ObjectNode state = objectMapper.createObjectNode();
        state.put("schemaVersion", 1);
        state.put("phase", phase);
        state.put("sandboxId", sandbox.sandboxId());
        state.put("userCode", sandbox.userCode());
        if (sandbox.generation() != null) {
            state.put("sandboxGeneration", sandbox.generation());
        }
        return state;
    }

    private void putProcess(ObjectNode state, SandboxProcessHandle process, long cursor, String purpose) {
        ObjectNode node = state.putObject("process");
        node.put("purpose", purpose);
        node.put("processId", process.processId());
        node.put("outputCursor", cursor);
        node.put("startedAt", process.startedAt().toString());
    }

    private AuthorizationStartResult pending(String url, Date expiresAt, ObjectNode state) {
        return new AuthorizationStartResult(AuthorizationStatus.PENDING, url, expiresAt, null, state.toString(), null,
            null, text(state, "phase"));
    }

    private AuthorizationStartResult failed(String code, String message) {
        return new AuthorizationStartResult(AuthorizationStatus.FAILED, null, new Date(), null, null, code, message);
    }

    private AuthorizationStatusResult failedStatus(String code, String message) {
        return new AuthorizationStatusResult(AuthorizationStatus.FAILED, null, null, null, null, code, message);
    }

    private boolean isMissingConfiguration(SandboxCommandResult result) {
        if (!isNotConfigured(result)) {
            return false;
        }
        try {
            JsonNode error = objectMapper.readTree(commandOutput(result)).path("error");
            JsonNode field = error.get("field");
            String message = error.path("message").asText();
            // Missing profiles also use not_configured; only canonical missing-configuration responses may create an app.
            return "config".equals(error.path("type").asText())
                && ("not configured".equals(message) || MISSING_WORKSPACE_CONFIG_PATTERN.matcher(message).matches())
                && (field == null || field.isNull() || (field.isTextual() && field.textValue().isEmpty()));
        } catch (JsonProcessingException e) {
            return false;
        }
    }

    private boolean isNotConfigured(SandboxCommandResult result) {
        if (result == null || result.truncated() || result.timedOut()) {
            return false;
        }
        try {
            String output = commandOutput(result);
            if (output.isBlank()) {
                return false;
            }
            JsonNode root = objectMapper.readTree(output);
            return "not_configured".equals(root.path("error").path("subtype").asText());
        } catch (JsonProcessingException e) {
            return false;
        }
    }

    private String commandOutput(SandboxCommandResult result) {
        String stdout = result.stdout() == null ? "" : result.stdout();
        String stderr = result.stderr() == null ? "" : result.stderr();
        if (stdout.isBlank()) {
            return stderr;
        }
        return stderr.isBlank() ? stdout : stdout + "\n" + stderr;
    }

    private String resolveUserCode(String userId) {
        if (userService == null || userId == null || userId.isBlank()) {
            return userId;
        }
        try {
            Users user = userService.findById(Long.valueOf(userId));
            if (user != null && user.getUserCode() != null && !user.getUserCode().isBlank()) {
                return user.getUserCode();
            }
        } catch (RuntimeException e) {
            log.warn("Unable to resolve userCode from userId={}, fallback to userId", userId);
        }
        return userId;
    }

    private String firstUrl(String output) {
        if (output == null) {
            return null;
        }
        Matcher matcher = URL_PATTERN.matcher(output);
        while (matcher.find()) {
            String candidate = matcher.group().replaceAll("[\\\"'.,;)]$", "");
            if (validUrl(candidate)) {
                return candidate;
            }
        }
        return null;
    }

    private boolean validUrl(String value) {
        if (value == null || value.isBlank()) {
            return false;
        }
        try {
            URI uri = new URI(value);
            String host = uri.getHost();
            return "https".equalsIgnoreCase(uri.getScheme())
                && host != null
                && ALLOWED_AUTHORIZATION_HOSTS.contains(host.toLowerCase(Locale.ROOT));
        } catch (URISyntaxException e) {
            return false;
        }
    }

    private String firstText(JsonNode node, String... names) {
        if (node == null) {
            return null;
        }
        for (String name : names) {
            if (node.has(name) && node.get(name).isTextual() && !node.get(name).asText().isBlank()) {
                return node.get(name).asText();
            }
        }
        return null;
    }

    private Date dateValue(JsonNode primary, JsonNode fallback) {
        return dateValue(primary, fallback, "expiresAt", "expires_at", "credentialExpiresAt",
            "credential_expires_at");
    }

    private Date dateValue(JsonNode primary, JsonNode fallback, String... names) {
        JsonNode value = firstValue(primary, names);
        if (value == null) {
            value = firstValue(fallback, names);
        }
        if (value == null) {
            return null;
        }
        if (value.isIntegralNumber() && value.canConvertToLong()) {
            return epochDate(value.longValue());
        }
        if (!value.isTextual() || value.textValue().isBlank()) {
            return null;
        }
        String text = value.textValue().trim();
        try {
            return Date.from(Instant.parse(text));
        } catch (DateTimeParseException e) {
            try {
                return Date.from(OffsetDateTime.parse(text).toInstant());
            } catch (DateTimeParseException ignored) {
                try {
                    return epochDate(Long.parseLong(text));
                } catch (NumberFormatException invalidNumber) {
                    return null;
                }
            }
        }
    }

    private JsonNode firstValue(JsonNode node, String... names) {
        if (node == null || !node.isObject()) {
            return null;
        }
        for (String name : names) {
            JsonNode value = node.get(name);
            if (value != null && !value.isNull()) {
                return value;
            }
        }
        return null;
    }

    private Date epochDate(long value) {
        if (value <= 0) {
            return null;
        }
        try {
            long millis = value < 1_000_000_000_000L ? Math.multiplyExact(value, 1_000L) : value;
            return new Date(millis);
        } catch (ArithmeticException e) {
            return null;
        }
    }

    private String text(JsonNode node, String field) {
        return firstText(node, field);
    }

    private Duration remaining(Date expiresAt) {
        long millis = expiresAt.getTime() - System.currentTimeMillis();
        return Duration.ofMillis(Math.max(1_000L, millis));
    }
}
