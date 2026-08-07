package com.iwhalecloud.byai.manager.domain.connector.provider.lark;

import java.net.URI;
import java.net.URISyntaxException;
import java.time.Duration;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
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

/** Lark authorization orchestration backed by OpenSandbox remote processes. */
@Component
public class LarkSandboxAuthorizationRuntime {

    private static final Logger log = LoggerFactory.getLogger(LarkSandboxAuthorizationRuntime.class);

    private static final String APP_PHASE = "app_initialization";
    private static final String USER_PHASE = "user_authorization";
    private static final Pattern URL_PATTERN = Pattern.compile("https://[^\\s\\p{Cntrl}]+",
        Pattern.CASE_INSENSITIVE);
    /** Lark app-initialization hosts plus the device-verification hosts used by the device-code flow. */
    private static final Set<String> ALLOWED_AUTHORIZATION_HOSTS = Set.of(
        "open.feishu.cn", "open.larksuite.com", "accounts.feishu.cn", "accounts.larksuite.com");
    private static final Duration COMMAND_TIMEOUT = Duration.ofSeconds(30);
    private static final Duration INIT_TIMEOUT = Duration.ofMinutes(10);
    private static final long DEFAULT_EXPIRES_SECONDS = 600;

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
            UserSandboxContext sandbox = sandboxResolver.resolve(userCode, properties.getSandboxServiceKey());
            SandboxCommandResult config = executor.run(sandbox.sandboxId(), policy.build(
                LarkSandboxCommandPolicy.Action.SHOW_CONFIG, null, COMMAND_TIMEOUT, properties.getMaxOutputBytes()));
            log.debug("Checked Lark sandbox configuration: userCode={}, sandboxId={}, exitCode={}",
                userCode, sandbox.sandboxId(), config.exitCode());
            if (config.exitCode() == 0) {
                return startUserAuthorization(sandbox, null);
            }
            if (!isNotConfigured(config)) {
                return failed("APP_CONFIG_CHECK_FAILED", "Unable to check Lark application configuration");
            }
            SandboxProcessHandle process = executor.start(sandbox.sandboxId(), policy.build(
                LarkSandboxCommandPolicy.Action.INITIALIZE_APP, null, INIT_TIMEOUT, properties.getMaxOutputBytes()));
            log.info("Started Lark app initialization: userCode={}, sandboxId={}, processId={}",
                userCode, sandbox.sandboxId(), process.processId());
            SandboxProcessSnapshot output = executor.readOutput(sandbox.sandboxId(), process.processId(), 0);
            String url = firstUrl(output.output());
            if (url == null) {
                log.warn("Lark app initialization did not return authorization URL: userCode={}, sandboxId={}, processId={}",
                    userCode, sandbox.sandboxId(), process.processId());
                executor.terminate(sandbox.sandboxId(), process.processId());
                return failed("APP_INIT_URL_MISSING", "Lark application initialization URL was not provided");
            }
            ObjectNode state = baseState(sandbox, APP_PHASE);
            state.put("authorizationUrl", url);
            putProcess(state, process, output.nextCursor(), "initialize_app");
            log.info("Lark app initialization authorization URL received: userCode={}, sandboxId={}, processId={}",
                userCode, sandbox.sandboxId(), process.processId());
            return pending(url, new Date(System.currentTimeMillis() + INIT_TIMEOUT.toMillis()), state);
        } catch (RuntimeException e) {
            log.warn("Lark sandbox authorization unavailable: userCode={}, reason={}", userCode, e.getMessage());
            return failed("LARK_SANDBOX_UNAVAILABLE", "User sandbox is unavailable");
        }
    }

    public AuthorizationStatusResult verify(String userId) {
        String userCode = resolveUserCode(userId);
        log.debug("Verifying Lark authorization in user sandbox: userCode={}", userCode);
        try {
            UserSandboxContext sandbox = sandboxResolver.resolve(userCode,
                properties.getSandboxServiceKey());
            return verified(sandbox.sandboxId());
        } catch (RuntimeException e) {
            log.warn("Lark sandbox verification unavailable: userCode={}, reason={}", userCode, e.getMessage());
            return failedStatus("LARK_SANDBOX_UNAVAILABLE", "User sandbox is unavailable");
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
            AuthorizationStatusResult verified = verified(sandboxId);
            if (verified.status() == AuthorizationStatus.CONNECTED) {
                return verified;
            }
            JsonNode process = state.get("process");
            if (process == null || !process.isObject()) {
                String deviceCode = text(state, "deviceCode");
                SandboxProcessHandle started = executor.start(sandboxId, policy.build(
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
            verified = verified(sandboxId);
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
        if (status.state() != SandboxProcessSnapshot.State.EXITED) {
            return failedStatus("APP_INIT_FAILED", "Unable to initialize Lark application");
        }
        SandboxCommandResult config = executor.run(sandboxId, policy.build(
            LarkSandboxCommandPolicy.Action.SHOW_CONFIG, null, COMMAND_TIMEOUT, properties.getMaxOutputBytes()));
        if (config.exitCode() != 0) {
            return progress(session, APP_PHASE, updated);
        }
        UserSandboxContext sandbox = new UserSandboxContext(sandboxId, text(updated, "userCode"),
            text(updated, "sandboxGeneration"), null);
        AuthorizationStartResult login = startUserAuthorization(sandbox, updated);
        return new AuthorizationStatusResult(AuthorizationStatus.PENDING, null, null, null, null, null, null,
            new AuthorizationProgress(USER_PHASE, login.authorizationUrl(), login.providerState(), login.expiresAt()));
    }

    private AuthorizationStartResult startUserAuthorization(UserSandboxContext sandbox, ObjectNode existingState) {
        SandboxCommandResult login = executor.run(sandbox.sandboxId(), policy.build(
            LarkSandboxCommandPolicy.Action.START_USER_AUTHORIZATION, null, COMMAND_TIMEOUT,
            properties.getMaxOutputBytes()));
        if (isNotConfigured(login)) {
            log.info("Binding Lark CLI to OpenClaw context: sandboxId={}, identity=user-default",
                sandbox.sandboxId());
            SandboxCommandResult bind = executor.run(sandbox.sandboxId(), policy.build(
                LarkSandboxCommandPolicy.Action.BIND_OPENCLAW_CONTEXT, null, COMMAND_TIMEOUT,
                properties.getMaxOutputBytes()));
            if (bind.exitCode() != 0 || isNotConfigured(bind)) {
                log.warn("Failed to bind Lark CLI to OpenClaw context: sandboxId={}, exitCode={}",
                    sandbox.sandboxId(), bind.exitCode());
                return failed("PROVIDER_BIND_FAILED", "Unable to bind Lark CLI to OpenClaw context");
            }
            log.info("Bound Lark CLI to OpenClaw context: sandboxId={}", sandbox.sandboxId());
            login = executor.run(sandbox.sandboxId(), policy.build(
                LarkSandboxCommandPolicy.Action.START_USER_AUTHORIZATION, null, COMMAND_TIMEOUT,
                properties.getMaxOutputBytes()));
        }
        if (login.exitCode() != 0 || login.truncated() || isNotConfigured(login)) {
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
            state.remove("process");
            return pending(url, new Date(System.currentTimeMillis() + seconds * 1000L), state);
        } catch (JsonProcessingException e) {
            return failed("PROVIDER_PROTOCOL_ERROR", "Lark authorization returned an invalid response");
        }
    }

    private AuthorizationStatusResult verified(String sandboxId) {
        SandboxCommandResult result = executor.run(sandboxId, policy.build(
            LarkSandboxCommandPolicy.Action.VERIFY_AUTHORIZATION, null, COMMAND_TIMEOUT,
            properties.getMaxOutputBytes()));
        if (result.exitCode() != 0 || result.truncated()) {
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
            return new AuthorizationStatusResult(AuthorizationStatus.CONNECTED,
                firstText(identity, "openId", "open_id", "userId", "user_id"),
                firstText(identity, "name", "displayName", "display_name"), null, null, null, null);
        } catch (JsonProcessingException e) {
            return failedStatus("PROVIDER_PROTOCOL_ERROR", "Lark authorization returned an invalid response");
        }
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

    private boolean isNotConfigured(SandboxCommandResult result) {
        if (result == null || result.truncated()) {
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

    private String text(JsonNode node, String field) {
        return firstText(node, field);
    }

    private Duration remaining(Date expiresAt) {
        long millis = expiresAt.getTime() - System.currentTimeMillis();
        return Duration.ofMillis(Math.max(1_000L, millis));
    }
}
