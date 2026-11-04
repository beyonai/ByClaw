package com.iwhalecloud.byai.manager.domain.connector.provider.wecom;

import java.io.IOException;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.locks.ReentrantLock;
import java.util.concurrent.locks.ReentrantReadWriteLock;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import jakarta.annotation.PreDestroy;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationSessionContext;
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
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorManifestCommandResolver;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ManifestCommandCatalog;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;

@Component
public class WecomCliAuthorizationProvider
        implements ConnectorAuthorizationProvider, ConnectorCredentialVerifier, ConnectorCredentialRevoker {

    private static final String PROVIDER_CODE = "wecom-cli";
    private static final List<String> INIT_COMMAND =
        List.of("wecom-cli", "auth", "init", "--noninteractive", "--no-browser");
    private static final List<String> CACHE_CLEAR_COMMAND =
        List.of("wecom-cli", "cache", "clear");
    private static final List<String> AUTH_STATUS_COMMAND =
        List.of("wecom-cli", "auth", "show", "--status");
    private static final Duration CLI_TIMEOUT = Duration.ofSeconds(30);
    private static final long DEFAULT_AUTHORIZATION_TIMEOUT_SECONDS = 300L;
    private static final long MIN_AUTHORIZATION_TIMEOUT_SECONDS = 90L;
    private static final long MAX_AUTHORIZATION_TIMEOUT_SECONDS = 900L;
    private static final Duration DEFAULT_START_OUTPUT_TIMEOUT = Duration.ofSeconds(10);
    private static final Duration DEFAULT_START_OUTPUT_POLL_INTERVAL = Duration.ofMillis(20);
    private static final int AUTHORIZATION_LOCK_COUNT = 64;
    private static final int MAX_TERMINAL_RESULTS = 256;
    private static final Duration MAX_TERMINAL_TTL = Duration.ofMinutes(15);
    private static final Duration LIFECYCLE_CLEANUP_INTERVAL = Duration.ofSeconds(30);
    private static final Duration TERMINAL_HANDOFF_PROTECTION = Duration.ofSeconds(5);
    private static final int MAX_ACTIVE_LIFECYCLES = 256;
    private static final Pattern ANSI_CSI_SEQUENCE = Pattern.compile("\u001B\\[[0-?]*[ -/]*[@-~]");
    private static final Pattern ANSI_OSC_SEQUENCE =
        Pattern.compile("\u001B\\].*?(?:\u0007|\u001B\\\\)", Pattern.DOTALL);
    private static final Pattern AUTHORIZATION_URL = Pattern.compile("https?://[^\\s\\p{Cntrl}]+");

    private static final String INVALID_USER = "INVALID_USER";
    private static final String PROVIDER_CONFIG_INVALID = "PROVIDER_CONFIG_INVALID";
    private static final String PROVIDER_WORKSPACE_ERROR = "PROVIDER_WORKSPACE_ERROR";
    private static final String PROVIDER_START_FAILED = "PROVIDER_START_FAILED";
    private static final String PROVIDER_AUTH_URL_MISSING = "PROVIDER_AUTH_URL_MISSING";
    private static final String PROVIDER_AUTH_FAILED = "PROVIDER_AUTH_FAILED";
    private static final String PROVIDER_PROBE_FAILED = "PROVIDER_PROBE_FAILED";
    private static final String PROVIDER_AUTH_CANCELLED = "PROVIDER_AUTH_CANCELLED";
    private static final String PROVIDER_CAPACITY_EXCEEDED = "PROVIDER_CAPACITY_EXCEEDED";

    private static final String INVALID_USER_MESSAGE = "Invalid user";
    private static final String PROVIDER_CONFIG_INVALID_MESSAGE = "Invalid WeCom authorization configuration";
    private static final String PROVIDER_WORKSPACE_ERROR_MESSAGE =
        "Unable to prepare the WeCom credential workspace";
    private static final String PROVIDER_START_FAILED_MESSAGE = "Unable to start WeCom authorization";
    private static final String PROVIDER_AUTH_URL_MISSING_MESSAGE = "WeCom authorization URL was not provided";
    private static final String PROVIDER_AUTH_FAILED_MESSAGE = "Unable to complete WeCom authorization";
    private static final String PROVIDER_PROBE_FAILED_MESSAGE = "WeCom authorization probe failed";
    private static final String PROVIDER_AUTH_CANCELLED_MESSAGE = "WeCom authorization was cancelled";
    private static final String PROVIDER_CAPACITY_EXCEEDED_MESSAGE =
        "WeCom authorization capacity is unavailable";

    private final ConnectorCliRunner cliRunner;
    private final ConnectorCredentialWorkspaceService workspaceService;
    private final ObjectMapper objectMapper;
    private final long startOutputTimeoutNanos;
    private final long startOutputPollIntervalNanos;
    private final Clock clock;
    private final ScheduledExecutorService cleanupExecutor;
    private final ScheduledFuture<?> cleanupFuture;
    private final ConnectorManifestCommandResolver manifestCommandResolver;
    private final ConcurrentHashMap<String, AuthorizationLifecycle> authorizationLifecycles =
        new ConcurrentHashMap<>();
    private final ReentrantReadWriteLock admissionGate = new ReentrantReadWriteLock(true);
    private final Object lifecycleAdmissionLock = new Object();
    private boolean admissionClosed;
    private final ReentrantLock[] authorizationLocks = createAuthorizationLocks();
    private final Object terminalResultsLock = new Object();
    private final Map<String, TerminalResult> terminalResults = new HashMap<>();
    private final AtomicLong terminalSequence = new AtomicLong();

    @Autowired
    public WecomCliAuthorizationProvider(
        ConnectorCliRunner cliRunner,
        ConnectorCredentialWorkspaceService workspaceService,
        ObjectMapper objectMapper,
        ConnectorManifestCommandResolver manifestCommandResolver) {
        this(
            cliRunner,
            workspaceService,
            objectMapper,
            DEFAULT_START_OUTPUT_TIMEOUT,
            DEFAULT_START_OUTPUT_POLL_INTERVAL,
            manifestCommandResolver
        );
    }

    public WecomCliAuthorizationProvider(
        ConnectorCliRunner cliRunner,
        ConnectorCredentialWorkspaceService workspaceService,
        ObjectMapper objectMapper) {
        this(cliRunner, workspaceService, objectMapper, DEFAULT_START_OUTPUT_TIMEOUT,
            DEFAULT_START_OUTPUT_POLL_INTERVAL, null);
    }

    WecomCliAuthorizationProvider(
        ConnectorCliRunner cliRunner,
        ConnectorCredentialWorkspaceService workspaceService,
        ObjectMapper objectMapper,
        Duration startOutputTimeout,
        Duration startOutputPollInterval) {
        this(cliRunner, workspaceService, objectMapper, startOutputTimeout, startOutputPollInterval, null);
    }

    WecomCliAuthorizationProvider(
        ConnectorCliRunner cliRunner,
        ConnectorCredentialWorkspaceService workspaceService,
        ObjectMapper objectMapper,
        Duration startOutputTimeout,
        Duration startOutputPollInterval,
        ConnectorManifestCommandResolver manifestCommandResolver) {
        this(
            cliRunner,
            workspaceService,
            objectMapper,
            startOutputTimeout,
            startOutputPollInterval,
            Clock.systemUTC(),
            newCleanupExecutor(),
            manifestCommandResolver
        );
    }

    WecomCliAuthorizationProvider(
        ConnectorCliRunner cliRunner,
        ConnectorCredentialWorkspaceService workspaceService,
        ObjectMapper objectMapper,
        Duration startOutputTimeout,
        Duration startOutputPollInterval,
        Clock clock,
        ScheduledExecutorService cleanupExecutor) {
        this(cliRunner, workspaceService, objectMapper, startOutputTimeout, startOutputPollInterval,
            clock, cleanupExecutor, null);
    }

    WecomCliAuthorizationProvider(
        ConnectorCliRunner cliRunner,
        ConnectorCredentialWorkspaceService workspaceService,
        ObjectMapper objectMapper,
        Duration startOutputTimeout,
        Duration startOutputPollInterval,
        Clock clock,
        ScheduledExecutorService cleanupExecutor,
        ConnectorManifestCommandResolver manifestCommandResolver) {
        this.cliRunner = Objects.requireNonNull(cliRunner, "cliRunner");
        this.workspaceService = Objects.requireNonNull(workspaceService, "workspaceService");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper");
        this.startOutputTimeoutNanos = positiveNanos(startOutputTimeout, "startOutputTimeout");
        this.startOutputPollIntervalNanos = positiveNanos(startOutputPollInterval, "startOutputPollInterval");
        this.clock = Objects.requireNonNull(clock, "clock");
        this.cleanupExecutor = Objects.requireNonNull(cleanupExecutor, "cleanupExecutor");
        this.manifestCommandResolver = manifestCommandResolver;
        this.cleanupFuture = cleanupExecutor.scheduleWithFixedDelay(
            this::cleanupExpiredLifecycles,
            LIFECYCLE_CLEANUP_INTERVAL.toMillis(),
            LIFECYCLE_CLEANUP_INTERVAL.toMillis(),
            TimeUnit.MILLISECONDS
        );
    }

    @Override
    public String providerCode() {
        return PROVIDER_CODE;
    }

    @Override
    public void revoke(String userId, ConnectorInfo connector) {
        Long numericUserId = parseUserId(userId);
        if (numericUserId == null) {
            throw new IllegalArgumentException(INVALID_USER_MESSAGE);
        }
        ConnectorCliWorkspace workspace = workspaceService.resolve(numericUserId, PROVIDER_CODE);
        ManifestCommandCatalog catalog = catalogFor(connector);
        List<String> clearCommand = command(catalog, "logout", CACHE_CLEAR_COMMAND);
        List<String> statusCommand = command(catalog, "status", AUTH_STATUS_COMMAND);
        Map<String, String> environment = commandEnvironment(workspace);
        // Every 1.3.4 CLI startup can migrate bot.enc through a network request.
        // Remove credentials before launching it so local revocation never triggers migration.
        removeCredentials(workspace);
        CliResult result = cliRunner.run(
            clearCommand,
            environment,
            null,
            CLI_TIMEOUT
        );
        if (result == null || result.exitCode() != 0 || result.truncated()) {
            throw new IllegalStateException("Unable to clear WeCom discovery cache");
        }
        CliResult status = cliRunner.run(
            statusCommand,
            environment, null, CLI_TIMEOUT);
        if (!validAuthorizationStatus(status, "unauthorized")) {
            throw new IllegalStateException("Unable to revoke WeCom credential");
        }
    }

    private Map<String, String> commandEnvironment(ConnectorCliWorkspace workspace) {
        Path wecomConfig = credentialDirectory(workspace);
        Map<String, String> environment = new HashMap<>(workspace.environment());
        environment.put("WECOM_CLI_CONFIG_DIR", wecomConfig.toString());
        // The CLI loads .env before resolving authorization. Keep a parent .env token from
        // overriding the per-user file even though ConnectorCliRunner clears inherited env.
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

    private void removeCredentials(ConnectorCliWorkspace workspace) {
        // cache clear only removes service discovery metadata in CLI 1.3.4. Delete the
        // legacy bot too: otherwise the next CLI startup recreates credentials.enc.
        // Match the existing private projection boundary: fixed file names under the
        // resolved user home, rejecting symlink directory components before each delete.
        try {
            for (String file : List.of("bot.enc", "token.enc", "credentials.enc")) {
                Files.deleteIfExists(credentialDirectory(workspace).resolve(file));
            }
        } catch (IOException e) {
            throw new IllegalStateException("Unable to remove WeCom credential");
        }
    }

    @Override
    public AuthorizationStatusResult verify(Long userId, ConnectorInfo connector) {
        if (userId == null || userId <= 0) {
            return credentialVerificationFailure();
        }
        try {
            String config = connector == null ? null : connector.getAuthConfig();
            JsonNode root = config == null || config.isBlank() ? objectMapper.createObjectNode() : readJson(config);
            if (root == null || !root.isObject()) {
                return credentialVerificationFailure();
            }
            validatedProviderState(objectMapper.convertValue(root, new TypeReference<Map<String, Object>>() { }));
        } catch (RuntimeException | JsonProcessingException e) {
            return failedStatus("CONNECTOR_VERIFICATION_FAILED", "Unable to verify connector credential");
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
            CliResult status = cliRunner.run(
                command(catalogFor(connector), "status", AUTH_STATUS_COMMAND),
                commandEnvironment(workspace),
                null,
                CLI_TIMEOUT
            );
            if (timedOut(status)) {
                return credentialVerificationTimeout();
            }
            return validAuthorizationStatus(status, "authorized") ? connectedStatus() : credentialInvalid();
        } catch (RuntimeException e) {
            return credentialVerificationFailure();
        }
    }

    private AuthorizationStatusResult credentialInvalid() {
        return failedStatus("CONNECTOR_CREDENTIAL_INVALID", "Connector credential is invalid");
    }

    private AuthorizationStatusResult credentialVerificationFailure() {
        return failedStatus("CONNECTOR_VERIFICATION_FAILED", "Unable to verify connector credential");
    }

    private AuthorizationStatusResult credentialVerificationTimeout() {
        return failedStatus(
            "CONNECTOR_VERIFICATION_TIMEOUT",
            "Connector credential verification timed out"
        );
    }

    private boolean timedOut(CliResult result) {
        return result != null && result.exitCode() == 124;
    }

    @Override
    public AuthorizationStartResult start(AuthorizationStartContext context) {
        Long userId = parseUserId(context == null ? null : context.userId());
        if (userId == null) {
            return failedStart(INVALID_USER, INVALID_USER_MESSAGE);
        }

        String authorizationId = context.authorizationId();
        if (authorizationId == null || authorizationId.isBlank()) {
            return failedStart(PROVIDER_START_FAILED, PROVIDER_START_FAILED_MESSAGE);
        }

        ProviderState providerState;
        String serializedProviderState;
        List<String> initCommand;
        try {
            providerState = validatedProviderState(context.providerConfig());
            serializedProviderState = objectMapper.writeValueAsString(providerState);
            initCommand = command(context.commandCatalog(), "login", INIT_COMMAND);
        } catch (RuntimeException | JsonProcessingException e) {
            return failedStart(PROVIDER_CONFIG_INVALID, PROVIDER_CONFIG_INVALID_MESSAGE);
        }

        long reservationExpiresAt = safeAddMillis(
            clock.millis(),
            Math.multiplyExact(providerState.authorizationTimeoutSeconds(), 1_000L)
        );
        AuthorizationLifecycle lifecycle = AuthorizationLifecycle.starting(reservationExpiresAt);
        ReentrantLock authorizationLock = authorizationLock(authorizationId);
        AdmissionResult admissionResult;
        authorizationLock.lock();
        try {
            removeTerminalResult(authorizationId);
            removeCompletedLifecycleForRestart(authorizationId);
            admissionResult = admitLifecycle(authorizationId, lifecycle);
        } finally {
            authorizationLock.unlock();
        }
        if (admissionResult != AdmissionResult.ADMITTED) {
            return admissionFailureStart(admissionResult);
        }

        ConnectorCliWorkspace workspace;
        try {
            workspace = workspaceService.resolve(userId, PROVIDER_CODE);
        } catch (RuntimeException e) {
            return failReservedStart(
                authorizationId,
                lifecycle,
                PROVIDER_WORKSPACE_ERROR,
                PROVIDER_WORKSPACE_ERROR_MESSAGE
            );
        }

        AuthorizationStartResult processStartFailure = startAndAttachReservedProcess(
            authorizationId,
            lifecycle,
            workspace,
            initCommand
        );
        if (processStartFailure != null) {
            return processStartFailure;
        }
        return waitForAuthorizationUrl(
            authorizationId,
            lifecycle,
            workspace,
            providerState,
            serializedProviderState,
            context.commandCatalog()
        );
    }

    @Override
    public AuthorizationStatusResult queryStatus(AuthorizationSessionContext session) {
        String authorizationId = session == null ? null : session.authorizationId();
        if (authorizationId == null || authorizationId.isBlank()) {
            return failedStatus(PROVIDER_AUTH_FAILED, PROVIDER_AUTH_FAILED_MESSAGE);
        }
        Long userId = parseUserId(session.userId());
        AuthorizationLifecycle lifecycle;
        CompletableFuture<AuthorizationStatusResult> probeFuture;
        ProcessState processState = ProcessState.MISSING;
        boolean executeProbe = false;
        ReentrantLock authorizationLock = authorizationLock(authorizationId);
        authorizationLock.lock();
        try {
            AuthorizationStatusResult terminalResult = terminalResult(authorizationId);
            if (terminalResult != null) {
                return terminalResult;
            }
            removeExpiredCompletedLifecycle(authorizationId, clock.millis());
            lifecycle = authorizationLifecycles.get(authorizationId);
            if (lifecycle != null && lifecycle.completedProbeResult() != null) {
                return lifecycle.completedProbeResult();
            }
            if (lifecycle != null && lifecycle.probeFuture() != null) {
                probeFuture = lifecycle.probeFuture();
            } else {
                if (userId != null) {
                    processState = processState(lifecycle);
                    if (processState == ProcessState.PENDING) {
                        return pendingStatus();
                    }
                }
                if (lifecycle == null) {
                    lifecycle = AuthorizationLifecycle.recovery(sessionExpiryMillis(session));
                    AdmissionResult admissionResult = admitLifecycle(authorizationId, lifecycle);
                    if (admissionResult == AdmissionResult.CAPACITY_EXCEEDED) {
                        AuthorizationStatusResult capacityFailure = failedStatus(
                            PROVIDER_CAPACITY_EXCEEDED,
                            PROVIDER_CAPACITY_EXCEEDED_MESSAGE
                        );
                        recordTerminalResult(authorizationId, session.expiresAt(), capacityFailure);
                        return capacityFailure;
                    }
                    if (admissionResult == AdmissionResult.CLOSED) {
                        AuthorizationStatusResult cancelled = cancelledStatus();
                        recordTerminalResult(authorizationId, session.expiresAt(), cancelled);
                        return cancelled;
                    }
                    if (admissionResult == AdmissionResult.ALREADY_EXISTS) {
                        lifecycle = authorizationLifecycles.get(authorizationId);
                    }
                }
                probeFuture = new CompletableFuture<>();
                lifecycle.probeFuture(probeFuture);
                executeProbe = true;
            }
        } finally {
            authorizationLock.unlock();
        }
        if (executeProbe) {
            executeProbe(session, userId, authorizationId, lifecycle, processState);
        }
        return awaitProbeResult(probeFuture);
    }

    private void executeProbe(
        AuthorizationSessionContext session,
        Long userId,
        String authorizationId,
        AuthorizationLifecycle lifecycle,
        ProcessState processState) {
        AuthorizationStatusResult candidate;
        try {
            candidate = probeStatus(session, userId, lifecycle, processState);
        } catch (RuntimeException e) {
            candidate = failedStatus(PROVIDER_AUTH_FAILED, PROVIDER_AUTH_FAILED_MESSAGE);
        }
        publishProbeResult(session, authorizationId, lifecycle, candidate);
    }

    private AuthorizationStatusResult probeStatus(
        AuthorizationSessionContext session,
        Long userId,
        AuthorizationLifecycle lifecycle,
        ProcessState processState) {
        AuthorizationStatusResult lifecycleResult = lifecycle.completedProbeResult();
        if (lifecycleResult != null) {
            return lifecycleResult;
        }
        if (userId == null) {
            return failedStatus(INVALID_USER, INVALID_USER_MESSAGE);
        }
        ProviderState providerState;
        try {
            providerState = decodeProviderState(session.providerState());
        } catch (RuntimeException | JsonProcessingException e) {
            return failedStatus(PROVIDER_CONFIG_INVALID, PROVIDER_CONFIG_INVALID_MESSAGE);
        }

        ConnectorCliWorkspace workspace;
        try {
            workspace = workspaceService.resolve(userId, PROVIDER_CODE);
        } catch (RuntimeException e) {
            return failedStatus(PROVIDER_WORKSPACE_ERROR, PROVIDER_WORKSPACE_ERROR_MESSAGE);
        }

        return runAvailabilityProbes(session.commandCatalog(), workspace, lifecycle, processState);
    }

    private AuthorizationStatusResult runAvailabilityProbes(
        ManifestCommandCatalog commandCatalog,
        ConnectorCliWorkspace workspace,
        AuthorizationLifecycle lifecycle,
        ProcessState processState) {
        AuthorizationStatusResult lifecycleResult = lifecycle.completedProbeResult();
        if (lifecycleResult != null) {
            return lifecycleResult;
        }
        // Local credentials can predate this authorization attempt. Only a successful
        // init exit proves the current scan completed; failed or lost processes cannot
        // be recovered by checking whether old credentials still exist.
        if (processState != ProcessState.SUCCEEDED) {
            return failedStatus(PROVIDER_AUTH_FAILED, PROVIDER_AUTH_FAILED_MESSAGE);
        }
        CliResult status;
        try {
            status = cliRunner.run(
                command(commandCatalog, "status", AUTH_STATUS_COMMAND),
                commandEnvironment(workspace),
                null,
                CLI_TIMEOUT
            );
        } catch (RuntimeException e) {
            return probeFailure(processState, PROVIDER_PROBE_FAILED, PROVIDER_PROBE_FAILED_MESSAGE);
        }
        if (!validAuthorizationStatus(status, "authorized")) {
            return probeFailure(processState, PROVIDER_PROBE_FAILED, PROVIDER_PROBE_FAILED_MESSAGE);
        }
        return connectedStatus();
    }

    @Override
    public void cancel(AuthorizationSessionContext session) {
        String authorizationId = session == null ? null : session.authorizationId();
        if (authorizationId == null || authorizationId.isBlank()) {
            return;
        }
        ReentrantLock authorizationLock = authorizationLock(authorizationId);
        ManagedProcess processToDestroy = null;
        AuthorizationLifecycle lifecycleToProtect = null;
        authorizationLock.lock();
        try {
            if (terminalResult(authorizationId) != null) {
                return;
            }
            AuthorizationLifecycle lifecycle = authorizationLifecycles.get(authorizationId);
            if (lifecycle != null && lifecycle.completedProbeResult() != null) {
                recordTerminalResult(
                    authorizationId,
                    session.expiresAt(),
                    lifecycle.completedProbeResult()
                );
                return;
            }
            AuthorizationStatusResult cancelled =
                failedStatus(PROVIDER_AUTH_CANCELLED, PROVIDER_AUTH_CANCELLED_MESSAGE);
            recordTerminalResult(authorizationId, session.expiresAt(), cancelled);
            if (lifecycle != null) {
                lifecycle.close(cancelled);
                processToDestroy = lifecycle.claimProcessForDestroy();
                lifecycleToProtect = lifecycle;
            }
        } finally {
            authorizationLock.unlock();
        }
        destroyProcess(processToDestroy);
        if (lifecycleToProtect != null) {
            authorizationLock.lock();
            try {
                if (authorizationLifecycles.get(authorizationId) == lifecycleToProtect) {
                    lifecycleToProtect.protectHandoffUntil(handoffExpiresAt(session));
                }
            } finally {
                authorizationLock.unlock();
            }
        }
    }

    private AuthorizationStartResult waitForAuthorizationUrl(
        String authorizationId,
        AuthorizationLifecycle lifecycle,
        ConnectorCliWorkspace workspace,
        ProviderState providerState,
        String serializedProviderState,
        ManifestCommandCatalog commandCatalog) {
        ManagedProcess process = lifecycle.process();
        if (process == null) {
            return failedStartFromStatus(lifecycleFailureResult(lifecycle));
        }
        long deadlineNanos = deadlineFromNow(startOutputTimeoutNanos);
        try {
            while (true) {
                AuthorizationStatusResult lifecycleResult = lifecycle.completedProbeResult();
                if (lifecycleResult != null) {
                    return failedStartFromStatus(lifecycleResult);
                }
                if (process.outputTruncated()) {
                    return removeProcessAndFail(
                        authorizationId,
                        lifecycle,
                        PROVIDER_START_FAILED,
                        PROVIDER_START_FAILED_MESSAGE
                    );
                }

                boolean processAlive = process.isAlive();
                boolean outputComplete = process.outputComplete();
                if (processAlive || outputComplete) {
                    String output = process.output();
                    String authorizationUrl = firstAuthorizationUrl(output, !processAlive);
                    if (authorizationUrl != null) {
                        return pendingStart(
                            authorizationId,
                            authorizationUrl,
                            lifecycle,
                            providerState,
                            serializedProviderState
                        );
                    }
                }

                if (!processAlive && outputComplete) {
                    Integer exitCode = process.exitCode();
                    if (exitCode != null && exitCode == 0) {
                        AuthorizationStatusResult probeResult = runAvailabilityProbes(
                            commandCatalog,
                            workspace,
                            lifecycle,
                            ProcessState.SUCCEEDED
                        );
                        return completeStartAfterProbe(
                            authorizationId,
                            lifecycle,
                            providerState,
                            serializedProviderState,
                            probeResult
                        );
                    }
                    return removeProcessAndFail(
                        authorizationId,
                        lifecycle,
                        PROVIDER_AUTH_URL_MISSING,
                        PROVIDER_AUTH_URL_MISSING_MESSAGE
                    );
                }

                long remainingNanos = deadlineNanos - System.nanoTime();
                if (remainingNanos <= 0) {
                    return removeProcessAndFail(
                        authorizationId,
                        lifecycle,
                        PROVIDER_AUTH_URL_MISSING,
                        PROVIDER_AUTH_URL_MISSING_MESSAGE
                    );
                }
                TimeUnit.NANOSECONDS.sleep(Math.min(startOutputPollIntervalNanos, remainingNanos));
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return removeProcessAndFail(
                authorizationId,
                lifecycle,
                PROVIDER_START_FAILED,
                PROVIDER_START_FAILED_MESSAGE
            );
        } catch (RuntimeException e) {
            return removeProcessAndFail(
                authorizationId,
                lifecycle,
                PROVIDER_START_FAILED,
                PROVIDER_START_FAILED_MESSAGE
            );
        }
    }

    private ProviderState validatedProviderState(Map<String, Object> config) throws JsonProcessingException {
        Map<String, Object> safeConfig = config == null ? Map.of() : config;
        long authorizationTimeoutSeconds = positiveWholeNumber(
            safeConfig.get("authorizationTimeoutSeconds"),
            DEFAULT_AUTHORIZATION_TIMEOUT_SECONDS
        );
        if (authorizationTimeoutSeconds < MIN_AUTHORIZATION_TIMEOUT_SECONDS
            || authorizationTimeoutSeconds > MAX_AUTHORIZATION_TIMEOUT_SECONDS) {
            throw new IllegalArgumentException("Authorization timeout is out of range");
        }
        List<String> probeCommand = safeConfig.containsKey("probeCommand")
            ? validatedProbeCommand(safeConfig.get("probeCommand"))
            : AUTH_STATUS_COMMAND;
        return new ProviderState(authorizationTimeoutSeconds, probeCommand);
    }

    private long positiveWholeNumber(Object configured, long defaultValue) {
        if (configured == null) {
            return defaultValue;
        }
        if (!(configured instanceof Number number)) {
            throw new IllegalArgumentException("Expected a number");
        }
        long value;
        try {
            value = new BigDecimal(number.toString()).longValueExact();
        } catch (ArithmeticException | NumberFormatException e) {
            throw new IllegalArgumentException("Expected a whole number");
        }
        if (value <= 0) {
            throw new IllegalArgumentException("Expected a positive number");
        }
        return value;
    }

    private List<String> validatedProbeCommand(Object configured) {
        if (!AUTH_STATUS_COMMAND.equals(configured)) {
            throw new IllegalArgumentException("Unsupported WeCom authorization status command");
        }
        return AUTH_STATUS_COMMAND;
    }

    private AuthorizationStartResult pendingStart(
        String authorizationId,
        String authorizationUrl,
        AuthorizationLifecycle lifecycle,
        ProviderState providerState,
        String serializedProviderState) {
        long expiresAtMillis = safeAddMillis(
            clock.millis(),
            Math.multiplyExact(providerState.authorizationTimeoutSeconds(), 1_000L)
        );
        ManagedProcess processToDestroy = null;
        AuthorizationStatusResult failure = null;
        ReentrantLock authorizationLock = authorizationLock(authorizationId);
        authorizationLock.lock();
        try {
            if (authorizationLifecycles.get(authorizationId) == lifecycle && !lifecycle.closed()) {
                lifecycle.expiresAtMillis(expiresAtMillis);
            } else {
                failure = lifecycleFailureResult(lifecycle);
                processToDestroy = lifecycle.claimProcessForDestroy();
            }
        } finally {
            authorizationLock.unlock();
        }
        if (failure != null) {
            destroyProcess(processToDestroy);
            return failedStartFromStatus(failure);
        }
        return new AuthorizationStartResult(
            AuthorizationStatus.PENDING,
            authorizationUrl,
            new Date(expiresAtMillis),
            null,
            serializedProviderState,
            null,
            null
        );
    }

    private AuthorizationStartResult completeStartAfterProbe(
        String authorizationId,
        AuthorizationLifecycle lifecycle,
        ProviderState providerState,
        String serializedProviderState,
        AuthorizationStatusResult probeResult) {
        AuthorizationStatusResult winner;
        ManagedProcess processToDestroy;
        ReentrantLock authorizationLock = authorizationLock(authorizationId);
        authorizationLock.lock();
        try {
            if (authorizationLifecycles.get(authorizationId) == lifecycle
                && !lifecycle.closed()
                && authorizationLifecycles.remove(authorizationId, lifecycle)) {
                lifecycle.close(probeResult);
                winner = probeResult;
            } else {
                winner = lifecycleFailureResult(lifecycle);
            }
            processToDestroy = lifecycle.claimProcessForDestroy();
        } finally {
            authorizationLock.unlock();
        }
        destroyProcess(processToDestroy);
        if (winner.status() != AuthorizationStatus.CONNECTED) {
            return failedStartFromStatus(winner);
        }
        long expiresAtMillis = safeAddMillis(
            clock.millis(),
            Math.multiplyExact(providerState.authorizationTimeoutSeconds(), 1_000L)
        );
        return new AuthorizationStartResult(
            AuthorizationStatus.CONNECTED,
            null,
            new Date(expiresAtMillis),
            null,
            serializedProviderState,
            null,
            null
        );
    }

    private AuthorizationStartResult removeProcessAndFail(
        String authorizationId,
        AuthorizationLifecycle lifecycle,
        String errorCode,
        String errorMessage) {
        AuthorizationStatusResult fallback = failedStatus(errorCode, errorMessage);
        AuthorizationStatusResult winner;
        ManagedProcess processToDestroy;
        ReentrantLock authorizationLock = authorizationLock(authorizationId);
        authorizationLock.lock();
        try {
            if (authorizationLifecycles.get(authorizationId) == lifecycle
                && !lifecycle.closed()
                && authorizationLifecycles.remove(authorizationId, lifecycle)) {
                lifecycle.close(fallback);
                winner = fallback;
            } else {
                winner = lifecycleFailureResult(lifecycle);
            }
            processToDestroy = lifecycle.claimProcessForDestroy();
        } finally {
            authorizationLock.unlock();
        }
        destroyProcess(processToDestroy);
        return failedStartFromStatus(winner);
    }

    private AuthorizationStartResult failReservedStart(
        String authorizationId,
        AuthorizationLifecycle lifecycle,
        String errorCode,
        String errorMessage) {
        return removeProcessAndFail(authorizationId, lifecycle, errorCode, errorMessage);
    }

    private AuthorizationStartResult attachStartedProcess(
        String authorizationId,
        AuthorizationLifecycle lifecycle,
        ManagedProcess process) {
        AuthorizationStatusResult failure = null;
        ReentrantLock authorizationLock = authorizationLock(authorizationId);
        authorizationLock.lock();
        try {
            if (authorizationLifecycles.get(authorizationId) == lifecycle
                && lifecycle.attachStartedProcess(process)) {
                return null;
            }
            failure = lifecycleFailureResult(lifecycle);
        } finally {
            authorizationLock.unlock();
        }
        destroyProcess(process);
        return failedStartFromStatus(failure);
    }

    private AuthorizationStartResult startAndAttachReservedProcess(
        String authorizationId,
        AuthorizationLifecycle lifecycle,
        ConnectorCliWorkspace workspace,
        List<String> initCommand) {
        ReentrantReadWriteLock.ReadLock readLock = admissionGate.readLock();
        readLock.lock();
        try {
            AuthorizationStartResult reservationFailure = reservedStartFailure(
                authorizationId,
                lifecycle
            );
            if (reservationFailure != null) {
                return reservationFailure;
            }

            ManagedProcess process;
            try {
                process = cliRunner.start(initCommand, commandEnvironment(workspace), null);
            } catch (RuntimeException e) {
                return failReservedStart(
                    authorizationId,
                    lifecycle,
                    PROVIDER_START_FAILED,
                    PROVIDER_START_FAILED_MESSAGE
                );
            }
            if (process == null) {
                return failReservedStart(
                    authorizationId,
                    lifecycle,
                    PROVIDER_START_FAILED,
                    PROVIDER_START_FAILED_MESSAGE
                );
            }
            return attachStartedProcess(authorizationId, lifecycle, process);
        } finally {
            readLock.unlock();
        }
    }

    private AuthorizationStartResult reservedStartFailure(
        String authorizationId,
        AuthorizationLifecycle lifecycle) {
        ReentrantLock authorizationLock = authorizationLock(authorizationId);
        authorizationLock.lock();
        try {
            if (!admissionClosed()
                && authorizationLifecycles.get(authorizationId) == lifecycle
                && lifecycle.starting()
                && !lifecycle.closed()) {
                return null;
            }
            return failedStartFromStatus(lifecycleFailureResult(lifecycle));
        } finally {
            authorizationLock.unlock();
        }
    }

    private AuthorizationStartResult admissionFailureStart(AdmissionResult admissionResult) {
        if (admissionResult == AdmissionResult.CAPACITY_EXCEEDED) {
            return failedStart(PROVIDER_CAPACITY_EXCEEDED, PROVIDER_CAPACITY_EXCEEDED_MESSAGE);
        }
        if (admissionResult == AdmissionResult.CLOSED) {
            return failedStart(PROVIDER_AUTH_CANCELLED, PROVIDER_AUTH_CANCELLED_MESSAGE);
        }
        return failedStart(PROVIDER_START_FAILED, PROVIDER_START_FAILED_MESSAGE);
    }

    private AuthorizationStartResult failedStartFromStatus(AuthorizationStatusResult result) {
        return failedStart(result.errorCode(), result.errorMessage());
    }

    private AuthorizationStatusResult lifecycleFailureResult(AuthorizationLifecycle lifecycle) {
        AuthorizationStatusResult result = lifecycle.completedProbeResult();
        return result == null ? cancelledStatus() : result;
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
        return new AuthorizationStatusResult(
            AuthorizationStatus.PENDING,
            null,
            null,
            null,
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

    private AuthorizationStatusResult cancelledStatus() {
        return failedStatus(PROVIDER_AUTH_CANCELLED, PROVIDER_AUTH_CANCELLED_MESSAGE);
    }

    private AuthorizationStatusResult connectedStatus() {
        return AuthorizationStatusResult.connected(
            null,
            null,
            com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialState.READY,
            com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialRenewalMode.PROBE_ONLY,
            null,
            null,
            new Date(),
            null
        );
    }

    /** CLI 1.3.4 reports local authorization material, not remote API permission or token validity. */
    private boolean validAuthorizationStatus(CliResult result, String expected) {
        return result != null
            && result.exitCode() == 0
            && !result.truncated()
            && result.output() != null
            && expected.equals(result.output().strip());
    }

    private JsonNode readJson(String content) throws JsonProcessingException {
        return objectMapper.reader()
            .with(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
            .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .readTree(content);
    }

    private ProviderState decodeProviderState(String serialized) throws JsonProcessingException {
        if (serialized == null || serialized.isBlank()) {
            throw new IllegalArgumentException("Missing provider state");
        }
        JsonNode root = readJson(serialized);
        if (root == null || !root.isObject() || root.size() != 2
            || !root.has("authorizationTimeoutSeconds") || !root.has("probeCommand")) {
            throw new IllegalArgumentException("Invalid provider state");
        }
        JsonNode timeout = root.get("authorizationTimeoutSeconds");
        if (!timeout.isIntegralNumber() || !timeout.canConvertToLong()) {
            throw new IllegalArgumentException("Invalid provider state timeout");
        }
        long timeoutSeconds = timeout.longValue();
        if (timeoutSeconds < MIN_AUTHORIZATION_TIMEOUT_SECONDS
            || timeoutSeconds > MAX_AUTHORIZATION_TIMEOUT_SECONDS) {
            throw new IllegalArgumentException("Invalid provider state timeout");
        }
        JsonNode probe = root.get("probeCommand");
        if (!probe.isArray()) {
            throw new IllegalArgumentException("Invalid provider state probe");
        }
        List<Object> probeValues = new ArrayList<>(probe.size());
        for (JsonNode value : probe) {
            if (!value.isTextual()) {
                throw new IllegalArgumentException("Invalid provider state probe");
            }
            probeValues.add(value.textValue());
        }
        return new ProviderState(timeoutSeconds, validatedProbeCommand(probeValues));
    }

    private List<String> command(
            ManifestCommandCatalog commandCatalog,
            String action,
            List<String> expected) {
        if (commandCatalog == null || commandCatalog.size(action) != 1) {
            throw new IllegalArgumentException("WeCom manifest commands are unavailable");
        }
        List<String> command = commandCatalog.command(action, 0);
        if (!expected.equals(command)) {
            throw new IllegalArgumentException("WeCom manifest command is not allowed");
        }
        return command;
    }

    private ManifestCommandCatalog catalogFor(ConnectorInfo connector) {
        if (manifestCommandResolver != null) {
            return manifestCommandResolver.resolve(connector);
        }
        return new ManifestCommandCatalog(
            Map.of(
                "login", List.of(INIT_COMMAND),
                "status", List.of(AUTH_STATUS_COMMAND),
                "logout", List.of(CACHE_CLEAR_COMMAND)
            ),
            "wecom-1.3.4-test-catalog",
            Map.of()
        );
    }

    private ProcessState processState(AuthorizationLifecycle lifecycle) {
        if (lifecycle == null) {
            return ProcessState.MISSING;
        }
        if (lifecycle.starting()) {
            return ProcessState.PENDING;
        }
        ManagedProcess process = lifecycle.process();
        if (process == null) {
            return ProcessState.MISSING;
        }
        try {
            if (process.isAlive() || !process.outputComplete()) {
                return ProcessState.PENDING;
            }
            return process.exitCode() != null
                && process.exitCode() == 0
                && !process.outputTruncated()
                ? ProcessState.SUCCEEDED
                : ProcessState.FAILED;
        } catch (RuntimeException e) {
            return ProcessState.FAILED;
        }
    }

    private AuthorizationStatusResult probeFailure(
        ProcessState processState,
        String probeErrorCode,
        String probeErrorMessage) {
        return processState == ProcessState.FAILED
            ? failedStatus(PROVIDER_AUTH_FAILED, PROVIDER_AUTH_FAILED_MESSAGE)
            : failedStatus(probeErrorCode, probeErrorMessage);
    }

    private void publishProbeResult(
        AuthorizationSessionContext session,
        String authorizationId,
        AuthorizationLifecycle lifecycle,
        AuthorizationStatusResult candidate) {
        AuthorizationStatusResult winner;
        ManagedProcess processToDestroy = null;
        boolean ownsLifecycle = false;
        ReentrantLock authorizationLock = authorizationLock(authorizationId);
        authorizationLock.lock();
        try {
            AuthorizationStatusResult terminalResult = terminalResult(authorizationId);
            if (terminalResult != null) {
                winner = terminalResult;
            } else if (authorizationLifecycles.get(authorizationId) != lifecycle || lifecycle.closed()) {
                winner = lifecycle.probeFuture().getNow(
                    failedStatus(PROVIDER_AUTH_FAILED, PROVIDER_AUTH_FAILED_MESSAGE)
                );
            } else {
                winner = candidate;
                recordTerminalResult(authorizationId, session.expiresAt(), winner);
                lifecycle.completedProbeResult(winner);
                ownsLifecycle = true;
                processToDestroy = lifecycle.claimProcessForDestroy();
            }
            lifecycle.probeFuture().complete(winner);
        } finally {
            authorizationLock.unlock();
        }

        if (!ownsLifecycle) {
            return;
        }
        destroyProcess(processToDestroy);
        authorizationLock.lock();
        try {
            if (authorizationLifecycles.get(authorizationId) == lifecycle) {
                AuthorizationStatusResult completedResult = lifecycle.completedProbeResult();
                if (completedResult != null && terminalResult(authorizationId) == null) {
                    recordTerminalResult(authorizationId, session.expiresAt(), completedResult);
                }
                lifecycle.protectHandoffUntil(handoffExpiresAt(session));
            }
        } finally {
            authorizationLock.unlock();
        }
    }

    private AuthorizationStatusResult awaitProbeResult(
        CompletableFuture<AuthorizationStatusResult> probeFuture) {
        try {
            return probeFuture.join();
        } catch (CompletionException e) {
            return failedStatus(PROVIDER_AUTH_FAILED, PROVIDER_AUTH_FAILED_MESSAGE);
        }
    }

    private long sessionExpiryMillis(AuthorizationSessionContext session) {
        Date expiresAt = session == null ? null : session.expiresAt();
        return expiresAt == null
            ? safeAddMillis(clock.millis(), MAX_TERMINAL_TTL.toMillis())
            : expiresAt.getTime();
    }

    private long handoffExpiresAt(AuthorizationSessionContext session) {
        long maximumHandoffExpiry = safeAddMillis(
            clock.millis(),
            TERMINAL_HANDOFF_PROTECTION.toMillis()
        );
        Date sessionExpiresAt = session == null ? null : session.expiresAt();
        return sessionExpiresAt == null
            ? maximumHandoffExpiry
            : Math.min(maximumHandoffExpiry, sessionExpiresAt.getTime());
    }

    private AuthorizationStatusResult terminalResult(String authorizationId) {
        long now = clock.millis();
        synchronized (terminalResultsLock) {
            pruneExpiredTerminalResults(now);
            TerminalResult terminalResult = terminalResults.get(authorizationId);
            return terminalResult == null ? null : terminalResult.result();
        }
    }

    private void recordTerminalResult(
        String authorizationId,
        Date sessionExpiresAt,
        AuthorizationStatusResult result) {
        long now = clock.millis();
        long maximumExpiresAt = safeAddMillis(now, MAX_TERMINAL_TTL.toMillis());
        long expiresAt = sessionExpiresAt == null
            ? maximumExpiresAt
            : Math.min(maximumExpiresAt, sessionExpiresAt.getTime());
        if (expiresAt <= now) {
            return;
        }
        synchronized (terminalResultsLock) {
            pruneExpiredTerminalResults(now);
            terminalResults.put(
                authorizationId,
                new TerminalResult(result, expiresAt, terminalSequence.getAndIncrement())
            );
            while (terminalResults.size() > MAX_TERMINAL_RESULTS) {
                String oldestAuthorizationId = terminalResults.entrySet().stream()
                    .min(Comparator
                        .comparingLong((Map.Entry<String, TerminalResult> entry) ->
                            entry.getValue().sequence())
                        .thenComparing(Map.Entry::getKey))
                    .map(Map.Entry::getKey)
                    .orElseThrow();
                terminalResults.remove(oldestAuthorizationId);
            }
        }
    }

    private void removeTerminalResult(String authorizationId) {
        synchronized (terminalResultsLock) {
            terminalResults.remove(authorizationId);
        }
    }

    private void pruneExpiredTerminalResults(long now) {
        terminalResults.entrySet().removeIf(entry -> entry.getValue().expiresAtMillis() <= now);
    }

    private AdmissionResult admitLifecycle(
        String authorizationId,
        AuthorizationLifecycle lifecycle) {
        synchronized (lifecycleAdmissionLock) {
            if (admissionClosed) {
                return AdmissionResult.CLOSED;
            }
            pruneCompletedHandoffs(clock.millis());
            if (authorizationLifecycles.containsKey(authorizationId)) {
                return AdmissionResult.ALREADY_EXISTS;
            }
            if (authorizationLifecycles.size() >= MAX_ACTIVE_LIFECYCLES) {
                return AdmissionResult.CAPACITY_EXCEEDED;
            }
            authorizationLifecycles.put(authorizationId, lifecycle);
            return AdmissionResult.ADMITTED;
        }
    }

    private void pruneCompletedHandoffs(long now) {
        authorizationLifecycles.entrySet().stream()
            .filter(entry -> entry.getValue().completedHandoffExpired(now))
            .sorted(Map.Entry.comparingByKey())
            .forEach(entry -> authorizationLifecycles.remove(entry.getKey(), entry.getValue()));
    }

    private void removeCompletedLifecycleForRestart(String authorizationId) {
        AuthorizationLifecycle lifecycle = authorizationLifecycles.get(authorizationId);
        if (lifecycle != null && lifecycle.completedProbeResult() != null) {
            authorizationLifecycles.remove(authorizationId, lifecycle);
        }
    }

    private void removeExpiredCompletedLifecycle(String authorizationId, long now) {
        AuthorizationLifecycle lifecycle = authorizationLifecycles.get(authorizationId);
        if (lifecycle != null && lifecycle.completedHandoffExpired(now)) {
            authorizationLifecycles.remove(authorizationId, lifecycle);
        }
    }

    private ReentrantLock authorizationLock(String authorizationId) {
        int hash = authorizationId.hashCode();
        return authorizationLocks[(hash ^ (hash >>> 16)) & (AUTHORIZATION_LOCK_COUNT - 1)];
    }

    private static ReentrantLock[] createAuthorizationLocks() {
        ReentrantLock[] locks = new ReentrantLock[AUTHORIZATION_LOCK_COUNT];
        for (int index = 0; index < locks.length; index++) {
            locks[index] = new ReentrantLock();
        }
        return locks;
    }

    private void cleanupExpiredLifecycles() {
        synchronized (lifecycleAdmissionLock) {
            if (admissionClosed) {
                return;
            }
        }
        long now = clock.millis();
        List<String> expiredAuthorizationIds = authorizationLifecycles.entrySet().stream()
            .filter(entry -> entry.getValue().cleanupEligible(now))
            .map(Map.Entry::getKey)
            .sorted()
            .toList();
        List<ManagedProcess> processesToDestroy = new ArrayList<>();
        for (String authorizationId : expiredAuthorizationIds) {
            ReentrantLock authorizationLock = authorizationLock(authorizationId);
            authorizationLock.lock();
            try {
                AuthorizationLifecycle lifecycle = authorizationLifecycles.get(authorizationId);
                if (lifecycle != null
                    && !admissionClosed()
                    && lifecycle.cleanupEligible(clock.millis())
                    && authorizationLifecycles.remove(authorizationId, lifecycle)) {
                    if (lifecycle.completedProbeResult() == null) {
                        lifecycle.close(failedStatus(
                            PROVIDER_AUTH_FAILED,
                            PROVIDER_AUTH_FAILED_MESSAGE
                        ));
                    }
                    ManagedProcess processToDestroy = lifecycle.claimProcessForDestroy();
                    if (processToDestroy != null) {
                        processesToDestroy.add(processToDestroy);
                    }
                }
            } finally {
                authorizationLock.unlock();
            }
        }
        for (ManagedProcess process : processesToDestroy) {
            destroyProcess(process);
        }
    }

    @PreDestroy
    void shutdown() {
        ReentrantReadWriteLock.WriteLock writeLock = admissionGate.writeLock();
        writeLock.lock();
        try {
            List<String> authorizationIds;
            synchronized (lifecycleAdmissionLock) {
                if (admissionClosed) {
                    return;
                }
                admissionClosed = true;
                authorizationIds = authorizationLifecycles.keySet().stream().sorted().toList();
            }
            cleanupFuture.cancel(false);
            cleanupExecutor.shutdownNow();
            for (String authorizationId : authorizationIds) {
                ManagedProcess processToDestroy = null;
                ReentrantLock authorizationLock = authorizationLock(authorizationId);
                authorizationLock.lock();
                try {
                    AuthorizationLifecycle lifecycle = authorizationLifecycles.get(authorizationId);
                    if (lifecycle != null
                        && authorizationLifecycles.remove(authorizationId, lifecycle)) {
                        if (lifecycle.completedProbeResult() == null) {
                            lifecycle.close(cancelledStatus());
                        }
                        processToDestroy = lifecycle.claimProcessForDestroy();
                    }
                } finally {
                    authorizationLock.unlock();
                }
                destroyProcess(processToDestroy);
            }
        } finally {
            writeLock.unlock();
        }
    }

    private boolean admissionClosed() {
        synchronized (lifecycleAdmissionLock) {
            return admissionClosed;
        }
    }

    private static ScheduledExecutorService newCleanupExecutor() {
        return Executors.newSingleThreadScheduledExecutor(runnable -> {
            Thread thread = new Thread(runnable, "wecom-authorization-cleanup");
            thread.setDaemon(true);
            return thread;
        });
    }

    private String firstAuthorizationUrl(String output, boolean includeTrailingLine) {
        if (output == null || output.isEmpty()) {
            return null;
        }
        String completeOutput = completeOutput(output, includeTrailingLine);
        String sanitizedOutput = ANSI_OSC_SEQUENCE.matcher(completeOutput).replaceAll("");
        sanitizedOutput = ANSI_CSI_SEQUENCE.matcher(sanitizedOutput).replaceAll("");
        Matcher matcher = AUTHORIZATION_URL.matcher(sanitizedOutput);
        while (matcher.find()) {
            String candidate = matcher.group();
            if (isValidAuthorizationUrl(candidate)) {
                return candidate;
            }
        }
        return null;
    }

    private boolean isValidAuthorizationUrl(String candidate) {
        try {
            URI uri = new URI(candidate);
            String scheme = uri.getScheme();
            return "https".equalsIgnoreCase(scheme)
                && "work.weixin.qq.com".equalsIgnoreCase(uri.getHost())
                && "/ai/qc/gen".equals(uri.getPath())
                && uri.getPort() == -1
                && uri.getUserInfo() == null;
        } catch (URISyntaxException e) {
            return false;
        }
    }

    private String completeOutput(String output, boolean includeTrailingLine) {
        if (includeTrailingLine) {
            return output;
        }
        int lastLineTerminator = Math.max(output.lastIndexOf('\r'), output.lastIndexOf('\n'));
        return lastLineTerminator < 0 ? "" : output.substring(0, lastLineTerminator + 1);
    }

    private Long parseUserId(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            BigInteger parsed = new BigInteger(value);
            if (parsed.signum() <= 0 || parsed.bitLength() > Long.SIZE - 1) {
                return null;
            }
            return parsed.longValue();
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static long positiveNanos(Duration duration, String name) {
        if (duration == null || duration.isZero() || duration.isNegative()) {
            throw new IllegalArgumentException(name + " must be positive");
        }
        try {
            return duration.toNanos();
        } catch (ArithmeticException e) {
            throw new IllegalArgumentException(name + " is too large");
        }
    }

    private static long safeAddMillis(long baseMillis, long additionalMillis) {
        if (additionalMillis < 0L) {
            throw new IllegalArgumentException("additionalMillis must not be negative");
        }
        try {
            return Math.addExact(baseMillis, additionalMillis);
        } catch (ArithmeticException e) {
            return Long.MAX_VALUE;
        }
    }

    private long deadlineFromNow(long timeoutNanos) {
        try {
            return Math.addExact(System.nanoTime(), timeoutNanos);
        } catch (ArithmeticException e) {
            return Long.MAX_VALUE;
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

    private static final class AuthorizationLifecycle {

        private volatile ManagedProcess process;
        private volatile long expiresAtMillis;
        private volatile long handoffProtectedUntilMillis = Long.MAX_VALUE;
        private CompletableFuture<AuthorizationStatusResult> probeFuture;
        private volatile AuthorizationStatusResult completedProbeResult;
        private volatile LifecycleState state;
        private volatile boolean closed;

        private AuthorizationLifecycle(long expiresAtMillis, LifecycleState state) {
            this.expiresAtMillis = expiresAtMillis;
            this.state = state;
        }

        private static AuthorizationLifecycle starting(long expiresAtMillis) {
            return new AuthorizationLifecycle(expiresAtMillis, LifecycleState.STARTING);
        }

        private static AuthorizationLifecycle recovery(long expiresAtMillis) {
            return new AuthorizationLifecycle(expiresAtMillis, LifecycleState.RECOVERY);
        }

        private ManagedProcess process() {
            return process;
        }

        private ManagedProcess claimProcessForDestroy() {
            ManagedProcess claimedProcess = process;
            process = null;
            return claimedProcess;
        }

        private boolean attachStartedProcess(ManagedProcess startedProcess) {
            if (closed || state != LifecycleState.STARTING || process != null) {
                return false;
            }
            process = startedProcess;
            state = LifecycleState.ACTIVE;
            return true;
        }

        private boolean starting() {
            return state == LifecycleState.STARTING;
        }

        private long expiresAtMillis() {
            return expiresAtMillis;
        }

        private void expiresAtMillis(long expiresAtMillis) {
            this.expiresAtMillis = expiresAtMillis;
        }

        private CompletableFuture<AuthorizationStatusResult> probeFuture() {
            return probeFuture;
        }

        private void probeFuture(CompletableFuture<AuthorizationStatusResult> probeFuture) {
            this.probeFuture = probeFuture;
        }

        private AuthorizationStatusResult completedProbeResult() {
            return completedProbeResult;
        }

        private void completedProbeResult(AuthorizationStatusResult result) {
            completedProbeResult = result;
            state = LifecycleState.COMPLETED;
        }

        private void protectHandoffUntil(long expiresAtMillis) {
            handoffProtectedUntilMillis = expiresAtMillis;
        }

        private boolean completedHandoffExpired(long now) {
            return completedProbeResult != null && handoffProtectedUntilMillis <= now;
        }

        private boolean cleanupEligible(long now) {
            return completedProbeResult == null
                ? expiresAtMillis <= now
                : handoffProtectedUntilMillis <= now;
        }

        private boolean closed() {
            return closed;
        }

        private void close(AuthorizationStatusResult result) {
            closed = true;
            completedProbeResult = result;
            state = LifecycleState.COMPLETED;
            if (probeFuture != null) {
                probeFuture.complete(result);
            }
        }
    }

    private enum AdmissionResult {
        ADMITTED,
        ALREADY_EXISTS,
        CAPACITY_EXCEEDED,
        CLOSED
    }

    private enum LifecycleState {
        STARTING,
        ACTIVE,
        RECOVERY,
        COMPLETED
    }

    private enum ProcessState {
        MISSING,
        PENDING,
        SUCCEEDED,
        FAILED
    }


    private record ProviderState(long authorizationTimeoutSeconds, List<String> probeCommand) {

        private ProviderState {
            probeCommand = List.copyOf(probeCommand);
        }
    }

    private record TerminalResult(
        AuthorizationStatusResult result,
        long expiresAtMillis,
        long sequence) {
    }
}
