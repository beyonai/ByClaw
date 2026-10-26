package com.iwhalecloud.byai.common.hook;

import com.fasterxml.jackson.databind.node.ObjectNode;
import com.iwhalecloud.byai.common.datasource.config.CustomerContextHolder;
import java.time.Instant;
import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.sql.DataSource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.ConnectionHolder;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Writes critical events on the connection already owned by the business transaction. */
public final class DurableHookPublisher {
    private final DataSource source;
    private final JdbcTemplate db;
    private final HookProperties properties;
    private final List<HookEventSchema> schemas;
    private final HookRequestMapper mapper = new HookRequestMapper();

    public DurableHookPublisher(DataSource source, HookProperties properties, List<HookEventSchema> schemas) {
        this.source = source;
        this.db = new JdbcTemplate(source);
        this.properties = properties;
        this.schemas = List.copyOf(schemas);
    }

    public String publish(String type, int version, String aggregateId, String aggregateRevision,
        String generation, String correlationId, Map<String, Object> data) {
        String route = CustomerContextHolder.getCustomerType();
        Object resource = TransactionSynchronizationManager.getResource(source);
        if (!TransactionSynchronizationManager.isActualTransactionActive()
            || !(resource instanceof ConnectionHolder holder) || !holder.isSynchronizedWithTransaction()
            || (route != null && !CustomerContextHolder.DATA_SOURCE_BYAI.equals(route))) {
            throw new IllegalStateException("Durable events require the authoritative business transaction");
        }
        if (version < 1 || type == null || !type.matches("[A-Za-z0-9_.-]{1,128}")
            || aggregateId == null || !aggregateId.matches("[0-9]{1,19}")
            || aggregateRevision == null || !aggregateRevision.matches("[0-9]{1,19}")
            || generation == null || !generation.matches("[0-9]{1,19}")
            || correlationId == null || correlationId.isBlank() || correlationId.length() > 128) {
            throw new IllegalArgumentException("Invalid durable event metadata");
        }
        HookEventSchema schema = schemas.stream().filter(s -> type.equals(s.type()) && version == s.version())
            .findFirst().orElseThrow(() -> new IllegalArgumentException("Unsupported durable event schema"));
        // The schema is the business-owned whitelist; arbitrary entity fields never enter the outbox.
        String eventId = UUID.randomUUID().toString();
        ObjectNode envelope = mapper.snapshot(schema, eventId, data);
        envelope.put("eventId", eventId).put("type", type).put("eventVersion", version)
            .put("occurredAt", envelope.path("event").path("occurredAt").asText()).put("sourceSystem", "byclaw")
            .put("aggregateId", aggregateId).put("aggregateRevision", aggregateRevision)
            .put("generation", generation).put("correlationId", correlationId);
        rejectCredentials(envelope.path("data"));
        if (envelope.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 262144) {
            throw new IllegalArgumentException("Durable event exceeds maximum payload size");
        }
        Instant now = Instant.now();
        db.update("INSERT INTO byai.integration_outbox(event_id,event_type,event_version,aggregate_id,"
            + "aggregate_revision,generation,correlation_id,payload,created_at) VALUES (?,?,?,?,?,?,?,CAST(? AS jsonb),?)",
            eventId, type, version, aggregateId, aggregateRevision, generation, correlationId,
            envelope.toString(), Timestamp.from(now));
        // Even zero matching subscriptions retain the event. Delivery identity never contains credentials.
        properties.getSubscriptions().forEach((id, subscription) -> {
            if (subscription.isEnabled() && type.equals(subscription.getEvent()) && version == subscription.getEventVersion()) {
                boolean filtered = subscription.getRequiredDataFields().stream().anyMatch(field -> {
                    var value = envelope.path("data").path(field);
                    return value.isMissingNode() || value.isNull() || (value.isTextual() && value.asText().isBlank());
                });
                db.update("INSERT INTO byai.integration_delivery(event_id,subscription_id,status,attempt,next_attempt_at,"
                    + "fencing_token) VALUES (?,?,?,0,?,0)", eventId, id, filtered ? "FILTERED" : "PENDING", Timestamp.from(now));
            }
        });
        return eventId;
    }

    /** A defensive safeguard supplements schema whitelists; secret fields are never durable business data. */
    private static void rejectCredentials(com.fasterxml.jackson.databind.JsonNode node) {
        if (node.isObject()) {
            node.fields().forEachRemaining(field -> {
                String key = field.getKey().replace("_", "").replace("-", "").toLowerCase(java.util.Locale.ROOT);
                if (java.util.Set.of("password", "secret", "token", "accesstoken", "refreshtoken", "apikey",
                    "authorization", "credentials", "credential", "clientsecret", "privatekey").contains(key)) {
                    throw new IllegalArgumentException("Credential fields are forbidden in durable events");
                }
                rejectCredentials(field.getValue());
            });
        } else if (node.isArray()) {
            node.forEach(DurableHookPublisher::rejectCredentials);
        }
    }
}
