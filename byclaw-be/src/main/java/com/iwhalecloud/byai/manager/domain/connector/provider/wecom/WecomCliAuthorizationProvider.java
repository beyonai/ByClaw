package com.iwhalecloud.byai.manager.domain.connector.provider.wecom;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.net.URI;
import java.net.URISyntaxException;
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
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;

@Component
public class WecomCliAuthorizationProvider
        implements ConnectorAuthorizationProvider, ConnectorCredentialVerifier, ConnectorCredentialRevoker {

    private static final String PROVIDER_CODE = "wecom-cli";
    private static final List<String> INIT_COMMAND =
        List.of("wecom-cli", "init", "--noninteractive", "--no-open");
    private static final List<String> CACHE_STATUS_COMMAND =
        List.of("wecom-cli", "cache", "status");
    private static final List<String> CACHE_CLEAR_COMMAND =
        List.of("wecom-cli", "cache", "clear");
    private static final List<String> DEFAULT_PROBE_COMMAND =
        List.of("wecom-cli", "contact", "get_userlist", "{}");
    private static final Duration CLI_TIMEOUT = Duration.ofSeconds(30);
    private static final long DEFAULT_AUTHORIZATION_TIMEOUT_SECONDS = 120L;
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
    private static final int MAX_JSON_RPC_STRING_ID_LENGTH = 256;
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
    private static final String PROVIDER_CACHE_INVALID = "PROVIDER_CACHE_INVALID";
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
    private static final String PROVIDER_CACHE_INVALID_MESSAGE = "WeCom credential cache is unavailable";
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
        ObjectMapper objectMapper) {
        this(
            cliRunner,
            workspaceService,
            objectMapper,
            DEFAULT_START_OUTPUT_TIMEOUT,
            DEFAULT_START_OUTPUT_POLL_INTERVAL
        );
    }

    WecomCliAuthorizationProvider(
        ConnectorCliRunner cliRunner,
        ConnectorCredentialWorkspaceService workspaceService,
        ObjectMapper objectMapper,
        Duration startOutputTimeout,
        Duration startOutputPollInterval) {
        this(
            cliRunner,
            workspaceService,
            objectMapper,
            startOutputTimeout,
            startOutputPollInterval,
            Clock.systemUTC(),
            newCleanupExecutor()
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
        this.cliRunner = Objects.requireNonNull(cliRunner, "cliRunner");
        this.workspaceService = Objects.requireNonNull(workspaceService, "workspaceService");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper");
        this.startOutputTimeoutNanos = positiveNanos(startOutputTimeout, "startOutputTimeout");
        this.startOutputPollIntervalNanos = positiveNanos(startOutputPollInterval, "startOutputPollInterval");
        this.clock = Objects.requireNonNull(clock, "clock");
        this.cleanupExecutor = Objects.requireNonNull(cleanupExecutor, "cleanupExecutor");
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
        CliResult result = cliRunner.run(CACHE_CLEAR_COMMAND, workspace.environment(), null, CLI_TIMEOUT);
        if (result == null || result.exitCode() != 0 || result.truncated()) {
            throw new IllegalStateException("Unable to revoke WeCom credential");
        }
    }

    @Override
    public AuthorizationStatusResult verify(String userId, ConnectorInfo connector) {
        Long numericUserId = parseUserId(userId);
        if (numericUserId == null) {
            return credentialVerificationFailure();
        }
        ProviderState providerState;
        try {
            providerState = decodeProviderState(connector == null ? null : connector.getAuthConfig());
        } catch (RuntimeException | JsonProcessingException e) {
            return failedStatus("CONNECTOR_VERIFICATION_FAILED", "Unable to verify connector credential");
        }
        ConnectorCliWorkspace workspace;
        try {
            workspace = workspaceService.resolve(numericUserId, PROVIDER_CODE);
        } catch (RuntimeException e) {
            return failedStatus(
                "CREDENTIAL_WORKSPACE_UNAVAILABLE",
                "Connector credential workspace is unavailable"
            );
        }
        try {
            CliResult cacheResult = cliRunner.run(
                CACHE_STATUS_COMMAND,
                workspace.environment(),
                null,
                CLI_TIMEOUT
            );
            if (timedOut(cacheResult)) {
                return credentialVerificationTimeout();
            }
            if (!validCacheResult(cacheResult)) {
                return credentialCacheInvalid();
            }
            CliResult probeResult = cliRunner.run(
                providerState.probeCommand(),
                workspace.environment(),
                null,
                CLI_TIMEOUT
            );
            if (timedOut(probeResult)) {
                return credentialVerificationTimeout();
            }
            return validBusinessProbeResult(probeResult) ? connectedStatus() : businessProbeInvalid();
        } catch (RuntimeException e) {
            return credentialVerificationFailure();
        }
    }

    private AuthorizationStatusResult credentialInvalid() {
        return failedStatus("CONNECTOR_CREDENTIAL_INVALID", "Connector credential is invalid");
    }

    private AuthorizationStatusResult credentialCacheInvalid() {
        return failedStatus("CONNECTOR_CACHE_INVALID", "Connector credential cache is invalid");
    }

    private AuthorizationStatusResult businessProbeInvalid() {
        return failedStatus(
            "CONNECTOR_BUSINESS_PROBE_INVALID",
            "Connector business probe did not succeed"
        );
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
        try {
            providerState = validatedProviderState(context.providerConfig());
            serializedProviderState = objectMapper.writeValueAsString(providerState);
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
            workspace
        );
        if (processStartFailure != null) {
            return processStartFailure;
        }
        return waitForAuthorizationUrl(
            authorizationId,
            lifecycle,
            workspace,
            providerState,
            serializedProviderState
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

        return runAvailabilityProbes(providerState, workspace, lifecycle, processState);
    }

    private AuthorizationStatusResult runAvailabilityProbes(
        ProviderState providerState,
        ConnectorCliWorkspace workspace,
        AuthorizationLifecycle lifecycle,
        ProcessState processState) {
        CliResult cacheResult;
        try {
            cacheResult = cliRunner.run(
                CACHE_STATUS_COMMAND,
                workspace.environment(),
                null,
                CLI_TIMEOUT
            );
        } catch (RuntimeException e) {
            return probeFailure(processState, PROVIDER_CACHE_INVALID, PROVIDER_CACHE_INVALID_MESSAGE);
        }
        if (!validCacheResult(cacheResult)) {
            return probeFailure(processState, PROVIDER_CACHE_INVALID, PROVIDER_CACHE_INVALID_MESSAGE);
        }
        AuthorizationStatusResult lifecycleResult = lifecycle.completedProbeResult();
        if (lifecycleResult != null) {
            return lifecycleResult;
        }

        CliResult probeResult;
        try {
            probeResult = cliRunner.run(
                providerState.probeCommand(),
                workspace.environment(),
                null,
                CLI_TIMEOUT
            );
        } catch (RuntimeException e) {
            return probeFailure(processState, PROVIDER_PROBE_FAILED, PROVIDER_PROBE_FAILED_MESSAGE);
        }
        if (!validBusinessProbeResult(probeResult)) {
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
        String serializedProviderState) {
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
                            providerState,
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
            : DEFAULT_PROBE_COMMAND;
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

    private List<String> validatedProbeCommand(Object configured) throws JsonProcessingException {
        if (!(configured instanceof List<?> values) || values.size() != DEFAULT_PROBE_COMMAND.size()) {
            throw new IllegalArgumentException("Expected four probe command elements");
        }
        List<String> strings = values.stream()
            .map(value -> {
                if (!(value instanceof String string)
                    || string.isBlank()
                    || string.codePoints().anyMatch(Character::isISOControl)) {
                    throw new IllegalArgumentException("Expected a non-empty string");
                }
                return string;
            })
            .toList();
        if (!DEFAULT_PROBE_COMMAND.subList(0, 3).equals(strings.subList(0, 3))) {
            throw new IllegalArgumentException("Unsupported probe command");
        }
        if (!objectMapper.reader()
            .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .readTree(strings.get(3))
            .isObject()) {
            throw new IllegalArgumentException("Expected probe arguments to be a JSON object");
        }
        return List.copyOf(strings);
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
        ConnectorCliWorkspace workspace) {
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
                process = cliRunner.start(INIT_COMMAND, workspace.environment(), null);
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
        return new AuthorizationStatusResult(
            AuthorizationStatus.CONNECTED,
            null,
            null,
            null,
            null,
            null,
            null
        );
    }

    private boolean validCacheResult(CliResult result) {
        if (result == null || result.exitCode() != 0 || result.truncated() || result.output() == null) {
            return false;
        }
        try {
            JsonNode root = objectMapper.reader()
                .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                .readTree(result.output());
            // wecom-cli 0.1.9 reports only service-discovery cache files here.
            // A freshly initialized credential can therefore legitimately return [].
            // Credential usability is established by the business probe below.
            return root != null && root.isArray();
        } catch (JsonProcessingException | RuntimeException e) {
            return false;
        }
    }

    private boolean validBusinessProbeResult(CliResult result) {
        if (result == null || result.exitCode() != 0 || result.truncated() || result.output() == null
            || result.output().isBlank()) {
            return false;
        }
        try {
            JsonNode root = readJson(result.output());
            if (isJsonRpcEnvelope(root)) {
                if (!validJsonRpcEnvelope(root)) {
                    return false;
                }
                JsonNode content = root.get("result").get("content");
                boolean validBusinessResult = false;
                for (JsonNode item : content) {
                    if (!validBusinessContentItem(item)) {
                        return false;
                    }
                    BusinessTextValidation validation = validateBusinessText(item.get("text"));
                    if (validation == BusinessTextValidation.DUPLICATE_KEYS) {
                        return false;
                    }
                    if (validation == BusinessTextValidation.VALID) {
                        validBusinessResult = true;
                    }
                }
                return validBusinessResult;
            }
            return validBusinessJson(root);
        } catch (JsonProcessingException | RuntimeException e) {
            return false;
        }
    }

    private BusinessTextValidation validateBusinessText(JsonNode text) {
        if (!text.isTextual() || text.textValue().isBlank()) {
            return BusinessTextValidation.NOT_BUSINESS;
        }
        try {
            return validBusinessJson(readJson(text.textValue()))
                ? BusinessTextValidation.VALID
                : BusinessTextValidation.NOT_BUSINESS;
        } catch (JsonProcessingException e) {
            return validJsonWithoutDuplicateDetection(text.textValue())
                ? BusinessTextValidation.DUPLICATE_KEYS
                : BusinessTextValidation.NOT_BUSINESS;
        } catch (RuntimeException e) {
            return BusinessTextValidation.NOT_BUSINESS;
        }
    }

    private boolean validJsonWithoutDuplicateDetection(String content) {
        try {
            objectMapper.reader()
                .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
                .readTree(content);
            return true;
        } catch (JsonProcessingException | RuntimeException e) {
            return false;
        }
    }

    private boolean validBusinessContentItem(JsonNode item) {
        if (item == null || !item.isObject()) {
            return false;
        }
        JsonNode type = item.get("type");
        JsonNode text = item.get("text");
        return type != null
            && type.isTextual()
            && "text".equals(type.textValue())
            && text != null
            && text.isTextual();
    }

    private JsonNode readJson(String content) throws JsonProcessingException {
        return objectMapper.reader()
            .with(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
            .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .readTree(content);
    }

    private boolean isJsonRpcEnvelope(JsonNode root) {
        return root != null && root.isObject()
            && (root.has("jsonrpc") || root.has("id") || root.has("result"));
    }

    private boolean validJsonRpcEnvelope(JsonNode root) {
        JsonNode version = root.get("jsonrpc");
        JsonNode id = root.get("id");
        JsonNode result = root.get("result");
        if (version == null
            || !version.isTextual()
            || !"2.0".equals(version.textValue())
            || !validJsonRpcId(id)
            || root.has("error")
            || result == null
            || !result.isObject()
            || result.has("error")) {
            return false;
        }
        JsonNode isError = result.get("isError");
        if (isError != null && (!isError.isBoolean() || isError.booleanValue())) {
            return false;
        }
        JsonNode content = result.get("content");
        return content != null
            && content.isArray()
            && !content.isEmpty();
    }

    private boolean validJsonRpcId(JsonNode id) {
        if (id == null) {
            return false;
        }
        if (id.isIntegralNumber()) {
            return id.canConvertToLong() && id.longValue() > 0L;
        }
        if (!id.isTextual()) {
            return false;
        }
        String value = id.textValue();
        return !value.isEmpty()
            && value.length() <= MAX_JSON_RPC_STRING_ID_LENGTH
            && value.chars().noneMatch(Character::isISOControl);
    }

    private boolean validBusinessJson(JsonNode root) {
        if (root == null || !root.isObject() || root.has("error")) {
            return false;
        }
        JsonNode errorCode = root.get("errcode");
        JsonNode userList = root.get("userlist");
        return errorCode != null
            && errorCode.isIntegralNumber()
            && errorCode.canConvertToInt()
            && errorCode.intValue() == 0
            && userList != null
            && userList.isArray();
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
            return ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme))
                && uri.getHost() != null
                && !uri.getHost().isBlank()
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

    private enum BusinessTextValidation {
        VALID,
        NOT_BUSINESS,
        DUPLICATE_KEYS
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
