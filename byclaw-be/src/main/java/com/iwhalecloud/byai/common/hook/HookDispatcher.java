package com.iwhalecloud.byai.common.hook;

import io.micrometer.core.instrument.MeterRegistry;
import java.net.ProtocolException;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executor;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Best-effort delivery; transaction synchronization is a timing guarantee, not durable storage. */
public class HookDispatcher implements AutoCloseable {
    private static final Logger logger = LoggerFactory.getLogger(HookDispatcher.class);
    private final HookProperties properties;
    private final List<HookEventSchema> schemas;
    private final Executor executor;
    private final MeterRegistry meters;
    private final HookRequestMapper mapper = new HookRequestMapper();
    private final OkHttpClient client;
    private final HmacHookSigner signer = new HmacHookSigner();
    private final ScheduledThreadPoolExecutor retries = new ScheduledThreadPoolExecutor(1,
        Thread.ofPlatform().name("outbound-hook-retry-", 0).inheritInheritableThreadLocals(false).factory());
    private final Semaphore retrySlots = new Semaphore(100);
    private volatile boolean closed;

    public HookDispatcher(HookProperties properties, List<HookEventSchema> schemas, Executor executor, MeterRegistry meters) {
        mapper.validate(properties, schemas);
        this.properties = properties;
        this.schemas = List.copyOf(schemas);
        this.executor = executor;
        this.meters = meters;
        retries.setRemoveOnCancelPolicy(true);
        retries.setExecuteExistingDelayedTasksAfterShutdownPolicy(false);
        // Isolate timeouts and lifecycle from the existing long-running shared HTTP client.
        this.client = new OkHttpClient.Builder()
            .connectTimeout(properties.getDefaults().getConnectTimeout())
            .callTimeout(properties.getDefaults().getCallTimeout())
            .readTimeout(properties.getDefaults().getCallTimeout())
            .writeTimeout(properties.getDefaults().getCallTimeout())
            .retryOnConnectionFailure(false).followRedirects(false).followSslRedirects(false)
            .addNetworkInterceptor(chain -> {
                DeliveryAttempt attempt = chain.request().tag(DeliveryAttempt.class);
                // OkHttp may replay a 503 Retry-After: 0 even with connection retries disabled.
                // Guard every method, including bodyless GET, before a second request reaches the wire.
                if (attempt == null || attempt.started) {
                    throw new ProtocolException("Hook request replay is disabled");
                }
                attempt.started = true;
                Response response = chain.proceed(chain.request());
                attempt.status = response.code();
                return response;
            }).build();
    }

    public void publish(String type, int version, Map<String, Object> data) {
        HookEventSchema schema = schemas.stream().filter(item -> item.type().equals(type) && item.version() == version)
            .findFirst().orElse(null);
        if (schema == null) {
            return;
        }
        String eventId = UUID.randomUUID().toString();
        properties.getSubscriptions().forEach((id, subscription) -> {
            if (!subscription.isEnabled() || !type.equals(subscription.getEvent()) || version != subscription.getEventVersion()) {
                return;
            }
            if (!TransactionSynchronizationManager.isActualTransactionActive()
                || !TransactionSynchronizationManager.isSynchronizationActive()) {
                record(id, eventId, "no_transaction", 0, 0);
                return;
            }
            try {
                // Copy values now: entities and maps may be mutated before the transaction completes.
                var envelope = mapper.snapshot(schema, eventId, data);
                boolean missingRequired = subscription.getRequiredDataFields().stream().anyMatch(field -> {
                    var value = envelope.path("data").path(field);
                    return value.isMissingNode() || value.isNull() || (value.isTextual() && value.asText().isBlank());
                });
                if (missingRequired) {
                    record(id, eventId, "filtered", 0, 0);
                    return;
                }
                Request request = mapper.map(id, subscription, envelope);
                TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                    @Override
                    public void afterCommit() {
                        try {
                            executor.execute(() -> send(id, eventId, subscription, request, 1));
                        } catch (RuntimeException rejected) {
                            record(id, eventId, "rejected", 0, 0);
                        }
                    }
                });
            } catch (RuntimeException invalidPayload) {
                record(id, eventId, "mapping_error", 0, 0);
            }
        });
    }

    /** Each explicit attempt retains business idempotency and refreshes the short-lived transport authentication. */
    private void send(String subscriptionId, String eventId, HookProperties.Subscription subscription, Request request, int number) {
        long start = System.nanoTime();
        DeliveryAttempt attempt = new DeliveryAttempt();
        try {
            Request signed = signer.sign(request, subscription.getHttp().getAuth());
            try (Response response = client.newCall(signed.newBuilder().tag(DeliveryAttempt.class, attempt).build()).execute()) {
                if (response.isSuccessful()) {
                    record(subscriptionId, eventId, "success", response.code(), System.nanoTime() - start);
                    return;
                }
            }
        } catch (Exception failure) {
            // Diagnostics exclude the URL, credentials, response body and raw exception message.
        }
        HookProperties.Retry policy = subscription.getRetry();
        boolean retryable = attempt.status == 0 ? policy.isTransportErrors() : policy.getStatuses().contains(attempt.status);
        if (!closed && retryable && number < policy.getMaxAttempts() && retrySlots.tryAcquire()) {
            try {
                retries.schedule(() -> {
                    retrySlots.release();
                    try {
                        executor.execute(() -> send(subscriptionId, eventId, subscription, request, number + 1));
                    } catch (RuntimeException rejected) {
                        record(subscriptionId, eventId, "rejected", 0, 0);
                    }
                }, policy.getDelay().toMillis(), TimeUnit.MILLISECONDS);
                record(subscriptionId, eventId, "retry_scheduled", attempt.status, System.nanoTime() - start);
                return;
            } catch (RuntimeException rejected) {
                retrySlots.release();
            }
        }
        record(subscriptionId, eventId, attempt.status == 0 ? "transport_error" : "http_error", attempt.status,
            System.nanoTime() - start);
    }

    private void record(String subscriptionId, String eventId, String outcome, int status, long nanos) {
        // Never log request/response bodies, URLs, headers or exception messages containing credentials.
        if ("success".equals(outcome)) {
            logger.debug("Hook delivery subscription={} event={} outcome={} status={} durationMs={}",
                subscriptionId, eventId, outcome, status, TimeUnit.NANOSECONDS.toMillis(nanos));
        } else {
            logger.warn("Hook delivery subscription={} event={} outcome={} status={} durationMs={}",
                subscriptionId, eventId, outcome, status, TimeUnit.NANOSECONDS.toMillis(nanos));
        }
        if (meters != null) {
            try {
                meters.counter("byclaw.hooks.deliveries", "subscription", subscriptionId, "outcome", outcome).increment();
                meters.timer("byclaw.hooks.duration", "subscription", subscriptionId).record(nanos, TimeUnit.NANOSECONDS);
            } catch (RuntimeException ignored) {
                // An unavailable metrics backend must not alter a committed business outcome.
            }
        }
    }

    /** Mutable only within one synchronous call; never shared across subscriptions or events. */
    private static final class DeliveryAttempt {
        private boolean started;
        private int status;
    }

    @Override
    public void close() {
        closed = true;
        retries.shutdownNow();
        client.dispatcher().executorService().shutdown();
        client.connectionPool().evictAll();
    }
}
