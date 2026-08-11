package com.iwhalecloud.byai.manager.domain.connector.provider.lark;

import java.net.URI;
import java.net.URISyntaxException;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.springframework.stereotype.Component;
import org.springframework.beans.factory.annotation.Autowired;

import jakarta.annotation.PreDestroy;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationSessionContext;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationProgress;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStartContext;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStartResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatusResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorAuthorizationProvider;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCliRunner;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCliRunner.CliResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCliRunner.ManagedProcess;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialVerifier;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialRevoker;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialWorkspaceService;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialWorkspaceService.ConnectorCliWorkspace;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ManifestCommandCatalog;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorManifestCommandResolver;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;

@Component
public class LarkCliAuthorizationProvider
        implements ConnectorAuthorizationProvider, ConnectorCredentialVerifier, ConnectorCredentialRevoker {

    private static final String PROVIDER_CODE = "lark-cli";
    private static final long DEFAULT_EXPIRES_IN_SECONDS = 600L;
    private static final int AUTHORIZATION_LOCK_COUNT = 64;
    private static final int MAX_COMPLETION_TERMINAL_RESULTS = 256;
    private static final Duration CLI_TIMEOUT = Duration.ofSeconds(30);
    private static final Duration MAX_COMPLETION_TERMINAL_TTL = Duration.ofMinutes(15);
    private static final Duration APP_INITIALIZATION_TIMEOUT = Duration.ofMinutes(10);
    private static final Duration START_OUTPUT_TIMEOUT = Duration.ofSeconds(10);
    private static final long START_OUTPUT_POLL_MILLIS = 20L;
    private static final List<String> STATUS_COMMAND =
        List.of("lark-cli", "auth", "status", "--json", "--verify");
    private static final List<String> LOGOUT_COMMAND =
        List.of("lark-cli", "auth", "logout", "--json");

    private static final String INVALID_USER = "INVALID_USER";
    private static final String PROVIDER_WORKSPACE_ERROR = "PROVIDER_WORKSPACE_ERROR";
    private static final String APP_INIT_URL_MISSING = "APP_INIT_URL_MISSING";
    private static final String APP_INIT_FAILED = "APP_INIT_FAILED";
    private static final String APP_INIT_EXPIRED = "APP_INIT_EXPIRED";
    private static final String APP_CONFIG_CHECK_FAILED = "APP_CONFIG_CHECK_FAILED";
    private static final String PROVIDER_CONFIG_INVALID = "PROVIDER_CONFIG_INVALID";
    private static final String PROVIDER_START_FAILED = "PROVIDER_START_FAILED";
    private static final String PROVIDER_PROTOCOL_ERROR = "PROVIDER_PROTOCOL_ERROR";
    private static final String PROVIDER_AUTH_FAILED = "PROVIDER_AUTH_FAILED";
    private static final String PROVIDER_AUTH_CANCELLED = "PROVIDER_AUTH_CANCELLED";

    private static final String INVALID_USER_MESSAGE = "Invalid user";
    private static final String WORKSPACE_ERROR_MESSAGE = "Unable to prepare the Lark credential workspace";
    private static final String APP_INIT_URL_MISSING_MESSAGE = "Lark application initialization URL was not provided";
    private static final String APP_INIT_FAILED_MESSAGE = "Unable to initialize Lark application";
    private static final String APP_INIT_EXPIRED_MESSAGE = "Lark application initialization expired";
    private static final String APP_CONFIG_CHECK_FAILED_MESSAGE = "Unable to check Lark application configuration";
    private static final String PROVIDER_CONFIG_INVALID_MESSAGE = "Invalid Lark authorization configuration";
    private static final String PROVIDER_START_FAILED_MESSAGE = "Unable to start Lark authorization";
    private static final String PROVIDER_PROTOCOL_ERROR_MESSAGE = "Lark authorization returned an invalid response";
    private static final String PROVIDER_AUTH_FAILED_MESSAGE = "Unable to complete Lark authorization";
    private static final String PROVIDER_AUTH_CANCELLED_MESSAGE = "Lark authorization was cancelled";

    private final ConnectorCliRunner cliRunner;
    private final ConnectorCredentialWorkspaceService workspaceService;
    private final ObjectMapper objectMapper;
    private final LarkSandboxAuthorizationRuntime sandboxRuntime;
    private final LarkAuthorizationProperties authorizationProperties;
    private final ConnectorManifestCommandResolver manifestCommandResolver;
    private static final String APP_INITIALIZATION_PHASE = "app_initialization";
    private static final String USER_AUTHORIZATION_PHASE = "user_authorization";
    private static final Pattern HTTPS_URL = Pattern.compile("https://[^\\s\\p{Cntrl}]+", Pattern.CASE_INSENSITIVE);
    private final ConcurrentHashMap<String, ManagedProcess> completionProcesses = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, ManagedProcess> initializationProcesses = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, AuthorizationStatusResult> initializationProgressResults =
        new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, CompletionTerminalResult> completionTerminalResults =
        new ConcurrentHashMap<>();
    private final Object completionTerminalResultsLock = new Object();
    private final Object lifecycleGate = new Object();
    private boolean shuttingDown;
    private final Object[] authorizationLocks = createAuthorizationLocks();

    @Autowired
    public LarkCliAuthorizationProvider(
        ConnectorCliRunner cliRunner,
        ConnectorCredentialWorkspaceService workspaceService,
        ObjectMapper objectMapper,
        LarkSandboxAuthorizationRuntime sandboxRuntime,
        LarkAuthorizationProperties authorizationProperties,
        ConnectorManifestCommandResolver manifestCommandResolver) {
        this.cliRunner = cliRunner;
        this.workspaceService = workspaceService;
        this.objectMapper = objectMapper;
        this.sandboxRuntime = sandboxRuntime;
        this.authorizationProperties = authorizationProperties;
        this.manifestCommandResolver = manifestCommandResolver;
    }

    public LarkCliAuthorizationProvider(
        ConnectorCliRunner cliRunner,
        ConnectorCredentialWorkspaceService workspaceService,
        ObjectMapper objectMapper) {
        this(cliRunner, workspaceService, objectMapper, null, new LarkAuthorizationProperties(), null);
    }

    @Override
    public String providerCode() {
        return PROVIDER_CODE;
    }

    @Override
    public AuthorizationStatusResult verify(Long userId, ConnectorInfo connector) {
        if (userId == null || userId <= 0) {
            return failedStatus("CONNECTOR_VERIFICATION_FAILED", "Unable to verify connector credential");
        }
        if (useSandboxExecutor()) {
            return sandboxRuntime.verify(String.valueOf(userId), catalogFor(connector));
        }
        ConnectorCliWorkspace workspace;
        try {
            workspace = workspaceService.resolve(userId, PROVIDER_CODE);
        } catch (RuntimeException e) {
            return failedStatus(
                "CREDENTIAL_WORKSPACE_UNAVAILABLE",
                "Connector credential workspace is unavailable"
            );
        }
        try {
            CliResult statusResult = cliRunner.run(
                command(catalogFor(connector), "status", 0, "auth", "status"),
                workspace.environment(),
                null,
                CLI_TIMEOUT
            );
            if (statusResult != null && statusResult.exitCode() == 124) {
                return failedStatus(
                    "CONNECTOR_VERIFICATION_TIMEOUT",
                    "Connector credential verification timed out"
                );
            }
            ConnectedAccount account = parseVerifiedUserAccount(statusResult);
            return account == null
                ? failedStatus("CONNECTOR_CREDENTIAL_INVALID", "Connector credential is invalid")
                : connectedStatus(account);
        } catch (RuntimeException e) {
            return failedStatus("CONNECTOR_VERIFICATION_FAILED", "Unable to verify connector credential");
        }
    }

    @Override
    public void revoke(String userId, ConnectorInfo connector) {
        if (useSandboxExecutor()) {
            sandboxRuntime.revoke(userId, catalogFor(connector));
            return;
        }
        Long numericUserId = parseUserId(userId);
        if (numericUserId == null) {
            throw new IllegalArgumentException(INVALID_USER_MESSAGE);
        }
        ConnectorCliWorkspace workspace = workspaceService.resolve(numericUserId, PROVIDER_CODE);
        CliResult result = cliRunner.run(
            command(catalogFor(connector), "logout", 0, "auth", "logout"),
            workspace.environment(),
            null,
            CLI_TIMEOUT
        );
        if (result == null || result.exitCode() != 0 || result.truncated()) {
            throw new IllegalStateException("Unable to revoke Lark credential");
        }
    }

    @Override
    public AuthorizationStartResult start(AuthorizationStartContext context) {
        if (useSandboxExecutor()) {
            return sandboxRuntime.start(context);
        }
        synchronized (lifecycleGate) {
            if (shuttingDown) {
                return failedStart(PROVIDER_START_FAILED, PROVIDER_START_FAILED_MESSAGE);
            }
        }
        Long userId = parseUserId(context == null ? null : context.userId());
        if (userId == null) {
            return failedStart(INVALID_USER, INVALID_USER_MESSAGE);
        }

        List<String> loginCommand;
        try {
            loginCommand = command(context.commandCatalog(), "login", 0, "auth", "login");
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
            configResult = cliRunner.run(
                command(context.commandCatalog(), "configCheck", 0, "config", "show"),
                workspace.environment(),
                null,
                CLI_TIMEOUT
            );
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
            return startAppInitialization(context, workspace);
        }

        return startUserAuthorization(loginCommand, workspace);
    }

    private AuthorizationStartResult startUserAuthorization(
            List<String> loginCommand,
            ConnectorCliWorkspace workspace) {
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
                null,
                USER_AUTHORIZATION_PHASE
            );
        } catch (RuntimeException | JsonProcessingException e) {
            return failedStart(PROVIDER_PROTOCOL_ERROR, PROVIDER_PROTOCOL_ERROR_MESSAGE);
        }
    }

    private AuthorizationStartResult startAppInitialization(
            AuthorizationStartContext context,
            ConnectorCliWorkspace workspace) {
        String authorizationId = context.authorizationId();
        if (isBlank(authorizationId)) {
            return failedStart(PROVIDER_PROTOCOL_ERROR, PROVIDER_PROTOCOL_ERROR_MESSAGE);
        }
        ManagedProcess process;
        try {
            process = cliRunner.start(
                command(context.commandCatalog(), "configInitialize", 0, "config", "init"),
                workspace.environment(),
                null
            );
        } catch (RuntimeException e) {
            return failedStart(APP_INIT_FAILED, APP_INIT_FAILED_MESSAGE);
        }
        if (process == null) {
            return failedStart(APP_INIT_FAILED, APP_INIT_FAILED_MESSAGE);
        }
        boolean admitted;
        synchronized (lifecycleGate) {
            admitted = !shuttingDown && initializationProcesses.putIfAbsent(authorizationId, process) == null;
        }
        if (!admitted) {
            destroyProcess(process);
            return failedStart(APP_INIT_FAILED, APP_INIT_FAILED_MESSAGE);
        }
        String authorizationUrl = waitForHttpsUrl(process);
        if (authorizationUrl == null) {
            initializationProcesses.remove(authorizationId, process);
            destroyProcess(process);
            return failedStart(APP_INIT_URL_MISSING, APP_INIT_URL_MISSING_MESSAGE);
        }
        try {
            ObjectNode state = objectMapper.createObjectNode();
            state.put("phase", APP_INITIALIZATION_PHASE);
            Date expiresAt = new Date(System.currentTimeMillis() + APP_INITIALIZATION_TIMEOUT.toMillis());
            String providerState = objectMapper.writeValueAsString(state);
            scheduleInitializationExpiry(authorizationId, process, expiresAt);
            return new AuthorizationStartResult(
                AuthorizationStatus.PENDING,
                authorizationUrl,
                expiresAt,
                null,
                providerState,
                null,
                null,
                APP_INITIALIZATION_PHASE
            );
        } catch (JsonProcessingException e) {
            initializationProcesses.remove(authorizationId, process);
            destroyProcess(process);
            return failedStart(PROVIDER_PROTOCOL_ERROR, PROVIDER_PROTOCOL_ERROR_MESSAGE);
        }
    }

    private String waitForHttpsUrl(ManagedProcess process) {
        long deadline = System.nanoTime() + START_OUTPUT_TIMEOUT.toNanos();
        try {
            while (System.nanoTime() < deadline) {
                if (process.outputTruncated()) {
                    return null;
                }
                String url = firstHttpsUrl(process.output());
                if (url != null) {
                    return url;
                }
                if (!process.isAlive() && process.outputComplete()) {
                    return null;
                }
                TimeUnit.MILLISECONDS.sleep(START_OUTPUT_POLL_MILLIS);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } catch (RuntimeException e) {
            return null;
        }
        return null;
    }

    private String firstHttpsUrl(String output) {
        if (output == null) {
            return null;
        }
        Matcher matcher = HTTPS_URL.matcher(output);
        while (matcher.find()) {
            String candidate = matcher.group();
            while (!candidate.isEmpty() && "\"'.,;)]}".indexOf(candidate.charAt(candidate.length() - 1)) >= 0) {
                candidate = candidate.substring(0, candidate.length() - 1);
            }
            if (validInitializationUrl(candidate)) {
                return candidate;
            }
        }
        return null;
    }

    private void scheduleInitializationExpiry(String authorizationId, ManagedProcess process, Date expiresAt) {
        long delayMillis = Math.max(0L, expiresAt.getTime() - System.currentTimeMillis());
        java.util.concurrent.CompletableFuture.delayedExecutor(
            delayMillis, TimeUnit.MILLISECONDS).execute(() -> {
                if (initializationProcesses.remove(authorizationId, process)) {
                    destroyProcess(process);
                }
                initializationProgressResults.remove(authorizationId);
            });
    }

    @Override
    public AuthorizationStatusResult queryStatus(AuthorizationSessionContext session) {
        if (useSandboxExecutor()) {
            return sandboxRuntime.queryStatus(session);
        }
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

        if (isApplicationInitializationState(session.providerState())) {
            return queryApplicationInitialization(session, workspace, authorizationId);
        }

        ConnectedAccount connected;
        try {
            connected = readConnectedAccount(workspace, session.commandCatalog());
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
            synchronized (lifecycleGate) {
                if (shuttingDown) {
                    return failedStatus(PROVIDER_AUTH_FAILED, PROVIDER_AUTH_FAILED_MESSAGE);
                }
                process = completionProcesses.computeIfAbsent(
                    authorizationId,
                    ignored -> cliRunner.start(
                        completionCommand(session.commandCatalog(), deviceCode),
                        workspace.environment(),
                        null
                    ));
            }
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
            connected = readConnectedAccount(workspace, session.commandCatalog());
            if (connected != null) {
                return recordConnected(session, authorizationId, connected);
            }
            return recordAuthFailure(session, authorizationId);
        } catch (RuntimeException e) {
            return recordAuthFailure(session, authorizationId);
        }
    }

    private AuthorizationStatusResult queryApplicationInitialization(
            AuthorizationSessionContext session,
            ConnectorCliWorkspace workspace,
            String authorizationId) {
        if (session.expiresAt() != null && session.expiresAt().getTime() <= System.currentTimeMillis()) {
            ManagedProcess expired = initializationProcesses.remove(authorizationId);
            destroyProcess(expired);
            return failedStatus(APP_INIT_EXPIRED, APP_INIT_EXPIRED_MESSAGE);
        }
        List<String> loginCommand = command(session.commandCatalog(), "login", 0, "auth", "login");
        AuthorizationStatusResult existingProgress = initializationProgressResults.get(authorizationId);
        if (existingProgress != null) {
            return existingProgress;
        }

        ManagedProcess process = initializationProcesses.get(authorizationId);
        if (process != null) {
            try {
                if (process.outputTruncated()) {
                    initializationProcesses.remove(authorizationId, process);
                    destroyProcess(process);
                    return failedStatus(APP_INIT_FAILED, APP_INIT_FAILED_MESSAGE);
                }
                if (process.isAlive()) {
                    return pendingStatus();
                }
                initializationProcesses.remove(authorizationId, process);
                if (process.exitCode() == null || process.exitCode() != 0) {
                    destroyProcess(process);
                    return failedStatus(APP_INIT_FAILED, APP_INIT_FAILED_MESSAGE);
                }
            } catch (RuntimeException e) {
                initializationProcesses.remove(authorizationId, process);
                destroyProcess(process);
                return failedStatus(APP_INIT_FAILED, APP_INIT_FAILED_MESSAGE);
            }
        }

        CliResult configResult;
        try {
            configResult = cliRunner.run(
                command(session.commandCatalog(), "configCheck", 0, "config", "show"),
                workspace.environment(),
                null,
                CLI_TIMEOUT
            );
        } catch (RuntimeException e) {
            return failedStatus(APP_CONFIG_CHECK_FAILED, APP_CONFIG_CHECK_FAILED_MESSAGE);
        }
        if (configResult == null || configResult.exitCode() != 0) {
            if (process == null && configResult != null && isNotConfigured(configResult)) {
                return pendingStatus();
            }
            return failedStatus(APP_INIT_FAILED, APP_INIT_FAILED_MESSAGE);
        }

        AuthorizationStartResult login = startUserAuthorization(loginCommand, workspace);
        if (login.status() != AuthorizationStatus.PENDING) {
            return failedStatus(login.errorCode(), login.errorMessage());
        }
        AuthorizationStatusResult progress = new AuthorizationStatusResult(
            AuthorizationStatus.PENDING,
            null,
            null,
            null,
            null,
            null,
            null,
            new AuthorizationProgress(
                USER_AUTHORIZATION_PHASE,
                login.authorizationUrl(),
                login.providerState(),
                login.expiresAt()
            )
        );
        AuthorizationStatusResult winner = initializationProgressResults.putIfAbsent(authorizationId, progress);
        return winner == null ? progress : winner;
    }

    private boolean isApplicationInitializationState(String providerState) {
        if (providerState == null) {
            return false;
        }
        try {
            JsonNode root = objectMapper.readTree(providerState);
            return root != null && APP_INITIALIZATION_PHASE.equals(textValue(root, "phase"));
        } catch (JsonProcessingException | RuntimeException e) {
            return false;
        }
    }

    @Override
    public void cancel(AuthorizationSessionContext session) {
        if (useSandboxExecutor()) {
            sandboxRuntime.cancel(session);
            return;
        }
        if (session == null || session.authorizationId() == null) {
            return;
        }
        String authorizationId = session.authorizationId();
        synchronized (authorizationLock(authorizationId)) {
            recordTerminalResult(session, authorizationId, CompletionTerminalState.CANCELLED);
            ManagedProcess initialization = initializationProcesses.remove(authorizationId);
            destroyProcess(initialization);
            initializationProgressResults.remove(authorizationId);
            removeAndDestroyCompletionProcess(authorizationId);
        }
    }

    @PreDestroy
    void shutdown() {
        List<ManagedProcess> initialization;
        List<ManagedProcess> completion;
        synchronized (lifecycleGate) {
            if (shuttingDown) {
                return;
            }
            shuttingDown = true;
            initialization = List.copyOf(initializationProcesses.values());
            completion = List.copyOf(completionProcesses.values());
            initializationProcesses.clear();
            completionProcesses.clear();
        }
        initialization.forEach(this::destroyProcess);
        completion.forEach(this::destroyProcess);
        initializationProgressResults.clear();
        completionTerminalResults.clear();
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

    private boolean useSandboxExecutor() {
        return sandboxRuntime != null && authorizationProperties != null
            && authorizationProperties.isSandboxExecutor();
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

    private ConnectedAccount readConnectedAccount(
            ConnectorCliWorkspace workspace,
            ManifestCommandCatalog commandCatalog) {
        CliResult result = cliRunner.run(
            command(commandCatalog, "status", 0, "auth", "status"),
            workspace.environment(),
            null,
            CLI_TIMEOUT
        );
        return parseConnectedAccount(result);
    }

    private ConnectedAccount parseConnectedAccount(CliResult result) {
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
            Date expiresAt = dateValue(identity, data);
            if (expiresAt == null) {
                expiresAt = dateValue(root, null);
            }
            return new ConnectedAccount(accountId, accountName, expiresAt);
        } catch (JsonProcessingException | RuntimeException e) {
            return null;
        }
    }

    private ConnectedAccount parseVerifiedUserAccount(CliResult result) {
        if (result == null || result.exitCode() != 0 || result.truncated() || result.output() == null) {
            return null;
        }
        try {
            JsonNode root = objectMapper.readTree(result.output());
            if (root == null || !root.isObject()) {
                return null;
            }
            JsonNode data = objectData(root);
            String activeIdentity = textValue(data, root, "identity");
            if (!"user".equalsIgnoreCase(activeIdentity) || !booleanValue(data, root, "verified")) {
                return null;
            }
            return parseConnectedAccount(result);
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

    private List<String> completionCommand(ManifestCommandCatalog commandCatalog, String deviceCode) {
        List<String> command = commandCatalog.command("login", 1, Map.of("deviceCode", deviceCode));
        validateCommand(command, "auth", "login");
        return command;
    }

    private List<String> command(
            ManifestCommandCatalog commandCatalog,
            String action,
            int index,
            String commandGroup,
            String subcommand) {
        if (commandCatalog == null) {
            throw new IllegalArgumentException("Lark manifest commands are unavailable");
        }
        List<String> command = commandCatalog.command(action, index);
        validateCommand(command, commandGroup, subcommand);
        return command;
    }

    private void validateCommand(List<String> command, String commandGroup, String subcommand) {
        if (command.size() < 3
                || !"lark-cli".equals(command.get(0))
                || !commandGroup.equals(command.get(1))
                || !subcommand.equals(command.get(2))) {
            throw new IllegalArgumentException("Lark manifest command is not allowed");
        }
    }

    private ManifestCommandCatalog catalogFor(ConnectorInfo connector) {
        if (manifestCommandResolver != null) {
            return manifestCommandResolver.resolve(connector);
        }
        return new ManifestCommandCatalog(
            Map.of("status", List.of(STATUS_COMMAND), "logout", List.of(LOGOUT_COMMAND)),
            "legacy-test-catalog",
            Map.of()
        );
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

    private boolean validInitializationUrl(String value) {
        if (isBlank(value)) {
            return false;
        }
        try {
            URI uri = new URI(value);
            String host = uri.getHost();
            return "https".equalsIgnoreCase(uri.getScheme())
                && ("open.feishu.cn".equalsIgnoreCase(host) || "open.larksuite.com".equalsIgnoreCase(host))
                && "/page/cli".equals(uri.getPath());
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
        if (process == null) {
            return;
        }
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
