package com.iwhalecloud.byai.common.hook;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.net.ProtocolException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import javax.sql.DataSource;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;

/** Bounded database-backed delivery. All acknowledgements are fenced against expired workers. */
public final class DurableHookWorker implements AutoCloseable {
    private final JdbcTemplate db;
    private final HookProperties properties;
    private final HookRequestMapper mapper = new HookRequestMapper();
    private final ObjectMapper json = new ObjectMapper();
    private final HmacHookSigner signer = new HmacHookSigner();
    private final OkHttpClient client;

    public DurableHookWorker(DataSource source, HookProperties properties, List<HookEventSchema> schemas) {
        this.db = new JdbcTemplate(source);
        this.properties = properties;
        mapper.validate(properties, schemas);
        client = new OkHttpClient.Builder().connectTimeout(properties.getDefaults().getConnectTimeout())
            .callTimeout(properties.getDefaults().getCallTimeout()).readTimeout(properties.getDefaults().getCallTimeout())
            .writeTimeout(properties.getDefaults().getCallTimeout()).retryOnConnectionFailure(false)
            .followRedirects(false).followSslRedirects(false).addNetworkInterceptor(chain -> {
                Attempt attempt = chain.request().tag(Attempt.class);
                if (attempt == null || attempt.started) {
                    throw new ProtocolException("Durable hook automatic replay disabled");
                }
                attempt.started = true;
                return chain.proceed(chain.request());
            }).build();
    }

    /** One scheduler invocation executes at most ten bounded calls; no in-memory retry queue exists. */
    @Scheduled(fixedDelayString = "${byclaw.hooks.durable.poll-delay-ms:1000}")
    public synchronized void poll() {
        List<Delivery> candidates = db.query("SELECT d.event_id,d.subscription_id,d.attempt,d.fencing_token,o.payload "
            + "FROM byai.integration_delivery d JOIN byai.integration_outbox o ON o.event_id=d.event_id "
            + "WHERE (d.status IN ('PENDING','RETRY') AND d.next_attempt_at <= CURRENT_TIMESTAMP) "
            + "OR (d.status='PROCESSING' AND d.lease_until < CURRENT_TIMESTAMP) "
            + "ORDER BY d.next_attempt_at LIMIT 10", (rs, row) -> new Delivery(rs.getString(1), rs.getString(2),
                rs.getInt(3), rs.getLong(4), rs.getString(5)));
        for (Delivery delivery : candidates) {
            // The fence advances atomically; a second process can read the same candidate but cannot claim it.
            int claimed = db.update("UPDATE byai.integration_delivery SET status='PROCESSING',attempt=attempt+1,"
                + "fencing_token=fencing_token+1,lease_until=CURRENT_TIMESTAMP + INTERVAL '120' SECOND "
                + "WHERE event_id=? AND subscription_id=? AND fencing_token=? AND "
                + "((status IN ('PENDING','RETRY') AND next_attempt_at<=CURRENT_TIMESTAMP) "
                + "OR (status='PROCESSING' AND lease_until<CURRENT_TIMESTAMP))",
                delivery.eventId(), delivery.subscriptionId(), delivery.fence());
            if (claimed == 1) {
                send(delivery);
            }
        }
    }

    private void send(Delivery delivery) {
        HookProperties.Subscription subscription = properties.getSubscriptions().get(delivery.subscriptionId());
        String status = "FAILED";
        String error = "SUBSCRIPTION_UNAVAILABLE";
        Timestamp next = Timestamp.from(Instant.now());
        boolean success = false;
        if (subscription != null && subscription.isEnabled()
            && delivery.attempt() < subscription.getRetry().getMaxAttempts()) {
            int responseCode = 0;
            try {
                ObjectNode envelope = (ObjectNode) json.readTree(delivery.payload());
                if (!subscription.getEvent().equals(envelope.path("type").asText())
                    || subscription.getEventVersion() != envelope.path("eventVersion").asInt()) {
                    throw new IllegalArgumentException("Subscription event changed");
                }
                // Authentication is freshly signed per attempt; the event/subscription idempotency key stays fixed.
                Request request = signer.sign(mapper.map(delivery.subscriptionId(), subscription, envelope),
                    subscription.getHttp().getAuth());
                try (Response response = client.newCall(request.newBuilder().tag(Attempt.class, new Attempt()).build()).execute()) {
                    responseCode = response.code();
                    success = response.isSuccessful();
                }
                error = success ? null : "HTTP_" + responseCode;
            } catch (Exception failure) {
                // Persist a bounded classification only: URLs, response bodies and credential-bearing errors are excluded.
                error = "DELIVERY_ERROR";
            }
            HookProperties.Retry retry = subscription.getRetry();
            boolean retryable = responseCode == 0 ? retry.isTransportErrors() : retry.getStatuses().contains(responseCode);
            if (success) {
                status = "DELIVERED";
            } else if (retryable && delivery.attempt() + 1 < retry.getMaxAttempts()) {
                status = "RETRY";
                next = Timestamp.from(Instant.now().plus(retry.getDelay()));
            }
        }
        acknowledge(delivery, status, next, error, success);
    }

    /** Both fence and unexpired lease are required; stale responses cannot complete a newer claim. */
    int acknowledge(Delivery delivery, String status, Timestamp next, String error, boolean success) {
        return db.update("UPDATE byai.integration_delivery SET status=?,next_attempt_at=?,error_code=?,"
            + "delivered_at=?,lease_until=NULL WHERE event_id=? AND subscription_id=? AND status='PROCESSING' "
            + "AND fencing_token=? AND lease_until>CURRENT_TIMESTAMP", status, next, error,
            success ? Timestamp.from(Instant.now()) : null, delivery.eventId(), delivery.subscriptionId(), delivery.fence() + 1);
    }

    record Delivery(String eventId, String subscriptionId, int attempt, long fence, String payload) { }
    private static final class Attempt { private boolean started; }

    @Override
    public void close() {
        client.dispatcher().executorService().shutdown();
        client.connectionPool().evictAll();
    }
}
