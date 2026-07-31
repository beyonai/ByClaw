package com.iwhalecloud.byai.manager.domain.connector.provider.lark;

import java.net.URI;
import java.net.URISyntaxException;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationSessionContext;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStartContext;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStartResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatusResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorAuthorizationProvider;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCliRunner;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCliRunner.CliResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCliRunner.ManagedProcess;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialWorkspaceService;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialWorkspaceService.ConnectorCliWorkspace;

@Component
public class LarkCliAuthorizationProvider implements ConnectorAuthorizationProvider {

    private static final String PROVIDER_CODE = "lark-cli";
    private static final long DEFAULT_EXPIRES_IN_SECONDS = 600L;
    private static final int AUTHORIZATION_LOCK_COUNT = 64;
    private static final int MAX_COMPLETION_TERMINAL_RESULTS = 256;
    private static final Duration CLI_TIMEOUT = Duration.ofSeconds(30);
    private static final Duration MAX_COMPLETION_TERMINAL_TTL = Duration.ofMinutes(15);
    private static final List<String> CONFIG_SHOW_COMMAND = List.of("lark-cli", "config", "show");
    private static final List<String> STATUS_COMMAND =
        List.of("lark-cli", "auth", "status", "--json", "--verify");

    private static final String INVALID_USER = "INVALID_USER";
    private static final String PROVIDER_WORKSPACE_ERROR = "PROVIDER_WORKSPACE_ERROR";
    private static final String APP_CONFIG_MISSING = "APP_CONFIG_MISSING";
    private static final String APP_CONFIG_FAILED = "APP_CONFIG_FAILED";
    private static final String APP_CONFIG_CHECK_FAILED = "APP_CONFIG_CHECK_FAILED";
    private static final String PROVIDER_CONFIG_INVALID = "PROVIDER_CONFIG_INVALID";
    private static final String PROVIDER_START_FAILED = "PROVIDER_START_FAILED";
    private static final String PROVIDER_PROTOCOL_ERROR = "PROVIDER_PROTOCOL_ERROR";
    private static final String PROVIDER_AUTH_FAILED = "PROVIDER_AUTH_FAILED";
    private static final String PROVIDER_AUTH_CANCELLED = "PROVIDER_AUTH_CANCELLED";

    private static final String INVALID_USER_MESSAGE = "Invalid user";
    private static final String WORKSPACE_ERROR_MESSAGE = "Unable to prepare the Lark credential workspace";
    private static final String APP_CONFIG_MISSING_MESSAGE = "Lark application configuration is missing";
    private static final String APP_CONFIG_FAILED_MESSAGE = "Unable to initialize Lark application configuration";
    private static final String APP_CONFIG_CHECK_FAILED_MESSAGE = "Unable to check Lark application configuration";
    private static final String PROVIDER_CONFIG_INVALID_MESSAGE = "Invalid Lark authorization configuration";
    private static final String PROVIDER_START_FAILED_MESSAGE = "Unable to start Lark authorization";
    private static final String PROVIDER_PROTOCOL_ERROR_MESSAGE = "Lark authorization returned an invalid response";
    private static final String PROVIDER_AUTH_FAILED_MESSAGE = "Unable to complete Lark authorization";
    private static final String PROVIDER_AUTH_CANCELLED_MESSAGE = "Lark authorization was cancelled";

    private final ConnectorCliRunner cliRunner;
    private final ConnectorCredentialWorkspaceService workspaceService;
    private final ObjectMapper objectMapper;
    private final String appId;
    private final String appSecret;
    private final ConcurrentHashMap<String, ManagedProcess> completionProcesses = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, CompletionTerminalResult> completionTerminalResults =
        new ConcurrentHashMap<>();
    private final Object completionTerminalResultsLock = new Object();
    private final Object[] authorizationLocks = createAuthorizationLocks();

    public LarkCliAuthorizationProvider(
        ConnectorCliRunner cliRunner,
        ConnectorCredentialWorkspaceService workspaceService,
        ObjectMapper objectMapper,
        @Value("${CONNECTOR_LARK_APP_ID:}") String appId,
        @Value("${CONNECTOR_LARK_APP_SECRET:}") String appSecret) {
        this.cliRunner = cliRunner;
        this.workspaceService = workspaceService;
        this.objectMapper = objectMapper;
        this.appId = appId;
        this.appSecret = appSecret;
    }

    @Override
    public String providerCode() {
        return PROVIDER_CODE;
    }

    @Override
    public AuthorizationStartResult start(AuthorizationStartContext context) {
        Long userId = parseUserId(context == null ? null : context.userId());
        if (userId == null) {
            return failedStart(INVALID_USER, INVALID_USER_MESSAGE);
        }

        List<String> loginCommand;
        try {
            loginCommand = buildLoginCommand(context.providerConfig());
        } catch (RuntimeException e) {
            return failedStart(PROVIDER_CONFIG_INVALID, PROVIDER_CONFIG_INVALID_MESSAGE);
        }

        ConnectorCliWorkspace workspace;
        try {
            workspace = workspaceService.resolve(userId, PROVIDER_CODE);
        } catch (RuntimeException e) {
            return failedStart(PROVIDER_WORKSPACE_ERROR, WORKSPACE_ERROR_MESSAGE);
        }

        CliResult configResult;
        try {
            configResult = cliRunner.run(CONFIG_SHOW_COMMAND, workspace.environment(), null, CLI_TIMEOUT);
        } catch (RuntimeException e) {
            return failedStart(APP_CONFIG_CHECK_FAILED, APP_CONFIG_CHECK_FAILED_MESSAGE);
        }

        if (configResult == null) {
            return failedStart(APP_CONFIG_CHECK_FAILED, APP_CONFIG_CHECK_FAILED_MESSAGE);
        }
        if (configResult.exitCode() != 0) {
            if (!isNotConfigured(configResult)) {
                return failedStart(APP_CONFIG_CHECK_FAILED, APP_CONFIG_CHECK_FAILED_MESSAGE);
            }
            if (isBlank(appId) || isBlank(appSecret)) {
                return failedStart(APP_CONFIG_MISSING, APP_CONFIG_MISSING_MESSAGE);
            }
            CliResult initResult;
            try {
                initResult = cliRunner.run(
                    configInitCommand(),
                    workspace.environment(),
                    appSecret + System.lineSeparator(),
                    CLI_TIMEOUT);
            } catch (RuntimeException e) {
                return failedStart(APP_CONFIG_FAILED, APP_CONFIG_FAILED_MESSAGE);
            }
            if (initResult == null || initResult.exitCode() != 0 || initResult.truncated()) {
                return failedStart(APP_CONFIG_FAILED, APP_CONFIG_FAILED_MESSAGE);
            }
        }

        CliResult loginResult;
        try {
            loginResult = cliRunner.run(loginCommand, workspace.environment(), null, CLI_TIMEOUT);
        } catch (RuntimeException e) {
            return failedStart(PROVIDER_START_FAILED, PROVIDER_START_FAILED_MESSAGE);
        }
        if (loginResult == null || loginResult.exitCode() != 0 || loginResult.truncated()) {
            return failedStart(PROVIDER_START_FAILED, PROVIDER_START_FAILED_MESSAGE);
        }

        try {
            DeviceAuthorization authorization = parseDeviceAuthorization(loginResult.output());
            ObjectNode state = objectMapper.createObjectNode();
            state.put("deviceCode", authorization.deviceCode());
            String providerState = objectMapper.writeValueAsString(state);
            long expiresAtMillis = Math.addExact(
                System.currentTimeMillis(),
                Math.multiplyExact(authorization.expiresInSeconds(), 1_000L));
            return new AuthorizationStartResult(
                AuthorizationStatus.PENDING,
                authorization.verificationUrl(),
                new Date(expiresAtMillis),
                null,
                providerState,
                null,
                null
            );
        } catch (RuntimeException | JsonProcessingException e) {
            return failedStart(PROVIDER_PROTOCOL_ERROR, PROVIDER_PROTOCOL_ERROR_MESSAGE);
        }
    }

    @Override
    public AuthorizationStatusResult queryStatus(AuthorizationSessionContext session) {
        Long userId = parseUserId(session == null ? null : session.userId());
        if (userId == null) {
            return failedStatus(INVALID_USER, INVALID_USER_MESSAGE);
        }

        ConnectorCliWorkspace workspace;
        try {
            workspace = workspaceService.resolve(userId, PROVIDER_CODE);
        } catch (RuntimeException e) {
            return failedStatus(PROVIDER_WORKSPACE_ERROR, WORKSPACE_ERROR_MESSAGE);
        }

        String authorizationId = session.authorizationId();
        if (isBlank(authorizationId)) {
            return failedStatus(PROVIDER_PROTOCOL_ERROR, PROVIDER_PROTOCOL_ERROR_MESSAGE);
        }
        synchronized (authorizationLock(authorizationId)) {
            return queryStatusLocked(session, workspace, authorizationId);
        }
    }

    private AuthorizationStatusResult queryStatusLocked(
        AuthorizationSessionContext session,
        ConnectorCliWorkspace workspace,
        String authorizationId) {
        AuthorizationStatusResult terminalResult = terminalStatus(authorizationId);
        if (terminalResult != null) {
            return terminalResult;
        }

        ConnectedAccount connected;
        try {
            connected = readConnectedAccount(workspace);
        } catch (RuntimeException e) {
            return failedStatus(PROVIDER_AUTH_FAILED, PROVIDER_AUTH_FAILED_MESSAGE);
        }
        if (connected != null) {
            return recordConnected(session, authorizationId, connected);
        }

        String deviceCode;
        try {
            deviceCode = decodeDeviceCode(session.providerState());
        } catch (RuntimeException | JsonProcessingException e) {
            return failedStatus(PROVIDER_PROTOCOL_ERROR, PROVIDER_PROTOCOL_ERROR_MESSAGE);
        }

        ManagedProcess process;
        try {
            process = completionProcesses.computeIfAbsent(
                authorizationId,
                ignored -> cliRunner.start(completionCommand(deviceCode), workspace.environment(), null));
        } catch (RuntimeException e) {
            return recordAuthFailure(session, authorizationId);
        }
        if (process == null) {
            return recordAuthFailure(session, authorizationId);
        }

        try {
            if (process.isAlive()) {
                return pendingStatus();
            }
            Integer exitCode = process.exitCode();
            if (exitCode == null || exitCode != 0 || process.outputTruncated()) {
                return recordAuthFailure(session, authorizationId);
            }
            connected = readConnectedAccount(workspace);
            if (connected != null) {
                return recordConnected(session, authorizationId, connected);
            }
            return recordAuthFailure(session, authorizationId);
        } catch (RuntimeException e) {
            return recordAuthFailure(session, authorizationId);
        }
    }

    @Override
    public void cancel(AuthorizationSessionContext session) {
        if (session == null || session.authorizationId() == null) {
            return;
        }
        String authorizationId = session.authorizationId();
        synchronized (authorizationLock(authorizationId)) {
            recordTerminalResult(session, authorizationId, CompletionTerminalState.CANCELLED);
            removeAndDestroyCompletionProcess(authorizationId);
        }
    }

    private List<String> configInitCommand() {
        return List.of(
            "lark-cli",
            "config",
            "init",
            "--app-id",
            appId,
            "--app-secret-stdin",
            "--brand",
            "feishu");
    }

    private boolean isNotConfigured(CliResult result) {
        if (result.exitCode() != 3 || result.truncated() || result.output() == null) {
            return false;
        }
        try {
            JsonNode root = objectMapper.readTree(result.output());
            JsonNode subtype = root == null ? null : root.path("error").path("subtype");
            return subtype != null && subtype.isTextual() && "not_configured".equals(subtype.textValue());
        } catch (JsonProcessingException | RuntimeException e) {
            return false;
        }
    }

    private List<String> buildLoginCommand(Map<String, Object> providerConfig) {
        List<String> domains = configList(providerConfig, "domains");
        List<String> scopes = configList(providerConfig, "scopes");
        if (!domains.isEmpty() && !scopes.isEmpty()) {
            throw new IllegalArgumentException("domains and scopes are mutually exclusive");
        }

        List<String> command = new ArrayList<>();
        command.add("lark-cli");
        command.add("auth");
        command.add("login");
        if (!domains.isEmpty()) {
            for (String domain : domains) {
                command.add("--domain");
                command.add(domain);
            }
        } else if (!scopes.isEmpty()) {
            command.add("--scope");
            command.add(String.join(",", scopes));
        } else {
            command.add("--recommend");
        }
        command.add("--no-wait");
        command.add("--json");
        return List.copyOf(command);
    }

    private List<String> configList(Map<String, Object> providerConfig, String key) {
        if (providerConfig == null || !providerConfig.containsKey(key)) {
            return List.of();
        }
        Object value = providerConfig.get(key);
        if (!(value instanceof List<?> values)) {
            throw new IllegalArgumentException("Invalid provider configuration");
        }
        Set<String> deduplicated = new LinkedHashSet<>();
        for (Object element : values) {
            if (!(element instanceof String text)) {
                throw new IllegalArgumentException("Invalid provider configuration");
            }
            String normalized = text.trim();
            if (normalized.isEmpty() || normalized.indexOf('\0') >= 0
                || normalized.indexOf('\r') >= 0 || normalized.indexOf('\n') >= 0) {
                throw new IllegalArgumentException("Invalid provider configuration");
            }
            deduplicated.add(normalized);
        }
        return List.copyOf(deduplicated);
    }

    private DeviceAuthorization parseDeviceAuthorization(String output) throws JsonProcessingException {
        JsonNode root = objectMapper.readTree(output);
        if (root == null || !root.isObject()) {
            throw new IllegalArgumentException("Invalid authorization response");
        }
        JsonNode data = objectData(root);
        String verificationUrl = textValue(data, root, "verification_url", "verificationUrl");
        if (isBlank(verificationUrl)) {
            verificationUrl = textValue(
                data,
                root,
                "verification_uri_complete",
                "verificationUriComplete");
        }
        String deviceCode = textValue(data, root, "device_code", "deviceCode");
        if (!validWebUrl(verificationUrl) || isBlank(deviceCode)) {
            throw new IllegalArgumentException("Invalid authorization response");
        }
        long expiresIn = positiveLongValue(data, root, "expires_in", "expiresIn");
        if (expiresIn <= 0) {
            expiresIn = DEFAULT_EXPIRES_IN_SECONDS;
        }
        return new DeviceAuthorization(verificationUrl, deviceCode, expiresIn);
    }

    private ConnectedAccount readConnectedAccount(ConnectorCliWorkspace workspace) {
        CliResult result = cliRunner.run(STATUS_COMMAND, workspace.environment(), null, CLI_TIMEOUT);
        if (result == null || result.exitCode() != 0 || result.truncated() || result.output() == null) {
            return null;
        }
        try {
            JsonNode root = objectMapper.readTree(result.output());
            if (root == null || !root.isObject()) {
                return null;
            }
            JsonNode data = objectData(root);
            JsonNode identity = userIdentity(data);
            if (identity == null) {
                identity = userIdentity(root);
            }
            String identityId = textValue(identity, "openId", "open_id", "userId", "user_id");
            String activeIdentity = textValue(data, root, "identity");
            boolean verifiedUserIdentity = "user".equalsIgnoreCase(activeIdentity)
                && booleanValue(data, root, "verified");
            boolean explicitlyConnected = booleanValue(data, root, "authenticated")
                || booleanValue(data, root, "loggedIn", "logged_in")
                || connectedStatusValue(data, root)
                || verifiedUserIdentity;
            if (!explicitlyConnected) {
                return null;
            }

            String accountId = firstNonBlank(
                identityId,
                textValue(data, root, "accountId", "account_id", "userId", "user_id", "openId", "open_id"));
            String accountName = firstNonBlank(
                textValue(identity, "name", "displayName", "display_name", "userName", "user_name"),
                textValue(data, root, "accountName", "account_name", "userName", "user_name", "name"));
            Date expiresAt = dateValue(data, root);
            return new ConnectedAccount(accountId, accountName, expiresAt);
        } catch (JsonProcessingException | RuntimeException e) {
            return null;
        }
    }

    private JsonNode userIdentity(JsonNode node) {
        if (node == null || !node.isObject()) {
            return null;
        }
        JsonNode user = node.path("identities").path("user");
        return user.isObject() ? user : null;
    }

    private boolean connectedStatusValue(JsonNode primary, JsonNode fallback) {
        String status = textValue(primary, fallback, "status");
        if (status == null) {
            return false;
        }
        String normalized = status.trim().toLowerCase(Locale.ROOT);
        return "connected".equals(normalized) || "authenticated".equals(normalized);
    }

    private String decodeDeviceCode(String providerState) throws JsonProcessingException {
        JsonNode root = objectMapper.readTree(providerState);
        if (root == null || !root.isObject() || root.size() != 1) {
            throw new IllegalArgumentException("Invalid provider state");
        }
        JsonNode deviceCode = root.get("deviceCode");
        if (deviceCode == null || !deviceCode.isTextual() || deviceCode.textValue().isBlank()) {
            throw new IllegalArgumentException("Invalid provider state");
        }
        return deviceCode.textValue().trim();
    }

    private List<String> completionCommand(String deviceCode) {
        return List.of("lark-cli", "auth", "login", "--device-code", deviceCode, "--json");
    }

    private JsonNode objectData(JsonNode root) {
        JsonNode data = root.get("data");
        return data != null && data.isObject() ? data : null;
    }

    private String textValue(JsonNode primary, JsonNode fallback, String... names) {
        String value = textValue(primary, names);
        return isBlank(value) ? textValue(fallback, names) : value;
    }

    private String textValue(JsonNode node, String... names) {
        if (node == null || !node.isObject()) {
            return null;
        }
        for (String name : names) {
            JsonNode value = node.get(name);
            if (value != null && value.isTextual() && !value.textValue().isBlank()) {
                return value.textValue();
            }
        }
        return null;
    }

    private boolean booleanValue(JsonNode primary, JsonNode fallback, String... names) {
        return booleanValue(primary, names) || booleanValue(fallback, names);
    }

    private boolean booleanValue(JsonNode node, String... names) {
        if (node == null || !node.isObject()) {
            return false;
        }
        for (String name : names) {
            JsonNode value = node.get(name);
            if (value != null && value.isBoolean() && value.booleanValue()) {
                return true;
            }
        }
        return false;
    }

    private long positiveLongValue(JsonNode primary, JsonNode fallback, String... names) {
        Long value = longValue(primary, names);
        if (value == null) {
            value = longValue(fallback, names);
        }
        return value == null ? -1L : value;
    }

    private Long longValue(JsonNode node, String... names) {
        if (node == null || !node.isObject()) {
            return null;
        }
        for (String name : names) {
            JsonNode value = node.get(name);
            if (value == null) {
                continue;
            }
            if (value.isIntegralNumber() && value.canConvertToLong()) {
                return value.longValue();
            }
            if (value.isTextual()) {
                try {
                    return Long.parseLong(value.textValue().trim());
                } catch (NumberFormatException e) {
                    return null;
                }
            }
        }
        return null;
    }

    private Date dateValue(JsonNode primary, JsonNode fallback) {
        JsonNode value = fieldValue(
            primary,
            fallback,
            "expiresAt",
            "expires_at",
            "credentialExpiresAt",
            "credential_expires_at");
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

    private JsonNode fieldValue(JsonNode primary, JsonNode fallback, String... names) {
        JsonNode value = fieldValue(primary, names);
        return value == null ? fieldValue(fallback, names) : value;
    }

    private JsonNode fieldValue(JsonNode node, String... names) {
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

    private boolean validWebUrl(String value) {
        if (isBlank(value)) {
            return false;
        }
        try {
            URI uri = new URI(value);
            String scheme = uri.getScheme();
            return scheme != null
                && ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme))
                && uri.getHost() != null
                && !uri.getHost().isBlank();
        } catch (URISyntaxException e) {
            return false;
        }
    }

    private AuthorizationStatusResult recordConnected(
        AuthorizationSessionContext session,
        String authorizationId,
        ConnectedAccount account) {
        AuthorizationStatusResult result = connectedStatus(account);
        recordTerminalResult(session, authorizationId, CompletionTerminalState.CONNECTED);
        removeAndDestroyCompletionProcess(authorizationId);
        return result;
    }

    private AuthorizationStatusResult recordAuthFailure(
        AuthorizationSessionContext session,
        String authorizationId) {
        AuthorizationStatusResult result = failedStatus(PROVIDER_AUTH_FAILED, PROVIDER_AUTH_FAILED_MESSAGE);
        recordTerminalResult(session, authorizationId, CompletionTerminalState.FAILED);
        removeAndDestroyCompletionProcess(authorizationId);
        return result;
    }

    private AuthorizationStatusResult terminalStatus(String authorizationId) {
        long now = System.currentTimeMillis();
        CompletionTerminalResult terminalResult = completionTerminalResults.get(authorizationId);
        if (terminalResult == null) {
            return null;
        }
        if (terminalResult.expiresAtMillis() <= now) {
            completionTerminalResults.remove(authorizationId, terminalResult);
            return null;
        }
        return switch (terminalResult.state()) {
            case CONNECTED -> connectedStatus(new ConnectedAccount(null, null, null));
            case FAILED -> failedStatus(PROVIDER_AUTH_FAILED, PROVIDER_AUTH_FAILED_MESSAGE);
            case CANCELLED -> failedStatus(PROVIDER_AUTH_CANCELLED, PROVIDER_AUTH_CANCELLED_MESSAGE);
        };
    }

    private void recordTerminalResult(
        AuthorizationSessionContext session,
        String authorizationId,
        CompletionTerminalState state) {
        long now = System.currentTimeMillis();
        long expiresAtMillis = terminalResultExpiresAt(session, now);
        CompletionTerminalResult terminalResult = new CompletionTerminalResult(state, expiresAtMillis);
        synchronized (completionTerminalResultsLock) {
            removeExpiredTerminalResults(now);
            completionTerminalResults.put(authorizationId, terminalResult);
            evictTerminalResultsOverCapacity(authorizationId);
        }
    }

    private long terminalResultExpiresAt(AuthorizationSessionContext session, long now) {
        long maxExpiresAt;
        try {
            maxExpiresAt = Math.addExact(now, MAX_COMPLETION_TERMINAL_TTL.toMillis());
        } catch (ArithmeticException e) {
            maxExpiresAt = Long.MAX_VALUE;
        }
        Date sessionExpiresAt = session == null ? null : session.expiresAt();
        if (sessionExpiresAt == null) {
            return maxExpiresAt;
        }
        return Math.min(sessionExpiresAt.getTime(), maxExpiresAt);
    }

    private void removeExpiredTerminalResults(long now) {
        completionTerminalResults.forEach((authorizationId, result) -> {
            if (result.expiresAtMillis() <= now) {
                completionTerminalResults.remove(authorizationId, result);
            }
        });
    }

    private void evictTerminalResultsOverCapacity(String retainedAuthorizationId) {
        while (completionTerminalResults.size() > MAX_COMPLETION_TERMINAL_RESULTS) {
            String evictionCandidate = null;
            long earliestExpiry = Long.MAX_VALUE;
            for (Map.Entry<String, CompletionTerminalResult> entry : completionTerminalResults.entrySet()) {
                if (entry.getKey().equals(retainedAuthorizationId)) {
                    continue;
                }
                long expiresAtMillis = entry.getValue().expiresAtMillis();
                if (expiresAtMillis < earliestExpiry) {
                    earliestExpiry = expiresAtMillis;
                    evictionCandidate = entry.getKey();
                }
            }
            if (evictionCandidate == null) {
                return;
            }
            completionTerminalResults.remove(evictionCandidate);
        }
    }

    private void removeAndDestroyCompletionProcess(String authorizationId) {
        ManagedProcess process = completionProcesses.remove(authorizationId);
        if (process != null) {
            destroyProcess(process);
        }
    }

    private void destroyProcess(ManagedProcess process) {
        try {
            process.destroy();
        } catch (RuntimeException e) {
            // Cleanup is best effort and must not expose process details.
        }
    }

    private Object authorizationLock(String authorizationId) {
        return authorizationLocks[Math.floorMod(authorizationId.hashCode(), authorizationLocks.length)];
    }

    private Object[] createAuthorizationLocks() {
        Object[] locks = new Object[AUTHORIZATION_LOCK_COUNT];
        for (int index = 0; index < locks.length; index++) {
            locks[index] = new Object();
        }
        return locks;
    }

    private AuthorizationStartResult failedStart(String errorCode, String errorMessage) {
        return new AuthorizationStartResult(
            AuthorizationStatus.FAILED,
            null,
            new Date(),
            null,
            null,
            errorCode,
            errorMessage
        );
    }

    private AuthorizationStatusResult pendingStatus() {
        return new AuthorizationStatusResult(AuthorizationStatus.PENDING, null, null, null, null, null, null);
    }

    private AuthorizationStatusResult connectedStatus(ConnectedAccount account) {
        return new AuthorizationStatusResult(
            AuthorizationStatus.CONNECTED,
            account.accountId(),
            account.accountName(),
            account.expiresAt(),
            null,
            null,
            null
        );
    }

    private AuthorizationStatusResult failedStatus(String errorCode, String errorMessage) {
        return new AuthorizationStatusResult(
            AuthorizationStatus.FAILED,
            null,
            null,
            null,
            null,
            errorCode,
            errorMessage
        );
    }

    private Long parseUserId(String value) {
        if (isBlank(value)) {
            return null;
        }
        try {
            long userId = Long.parseLong(value.trim());
            return userId > 0 ? userId : null;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private String firstNonBlank(String first, String second) {
        return isBlank(first) ? second : first;
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private record DeviceAuthorization(String verificationUrl, String deviceCode, long expiresInSeconds) {
    }

    private record ConnectedAccount(String accountId, String accountName, Date expiresAt) {
    }

    private record CompletionTerminalResult(CompletionTerminalState state, long expiresAtMillis) {
    }

    private enum CompletionTerminalState {
        CONNECTED,
        FAILED,
        CANCELLED
    }
}
