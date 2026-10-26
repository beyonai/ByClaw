package com.iwhalecloud.byai.common.hook;

import com.iwhalecloud.byai.common.datasource.config.CustomerContextHolder;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class DurableHookPublisherTest {
    private DriverManagerDataSource source;
    private JdbcTemplate db;
    private TransactionTemplate transaction;
    private HookProperties properties;
    private DurableHookPublisher publisher;

    @BeforeEach
    void setup() {
        source = new DriverManagerDataSource("jdbc:h2:mem:durable_" + java.util.UUID.randomUUID()
            + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1", "sa", "");
        db = new JdbcTemplate(source);
        db.execute("CREATE SCHEMA byai");
        db.execute("CREATE TABLE byai.integration_outbox(event_id varchar(36) PRIMARY KEY,event_type varchar(128),"
            + "event_version integer,aggregate_id varchar(19),aggregate_revision varchar(19),generation varchar(19),"
            + "correlation_id varchar(128),payload jsonb,created_at timestamp with time zone)");
        db.execute("CREATE TABLE byai.integration_delivery(event_id varchar(36),subscription_id varchar(64),"
            + "status varchar(16),attempt integer,next_attempt_at timestamp with time zone,"
            + "fencing_token bigint,lease_until timestamp with time zone,delivered_at timestamp with time zone,"
            + "error_code varchar(64),PRIMARY KEY(event_id,subscription_id))");
        transaction = new TransactionTemplate(new DataSourceTransactionManager(source));
        properties = new HookProperties();
        publisher = new DurableHookPublisher(source, properties,
            List.of(new HookEventSchema("tenant.ready", 1, Set.of("enterpriseId"))));
    }

    private String publish() {
        return publisher.publish("tenant.ready", 1, "42", "1", "1", "command-42", Map.of("enterpriseId", "42"));
    }

    @Test
    void durableOnlyConfigurationBindsTheSameSubscriptionsForPublisherAndWorker() {
        new org.springframework.boot.test.context.runner.ApplicationContextRunner()
            .withUserConfiguration(HookConfiguration.class)
            .withBean("multipleDataSource", javax.sql.DataSource.class, () -> source)
            .withBean("dataSourceByai", javax.sql.DataSource.class, () -> source)
            .withBean(HookEventSchema.class, () -> new HookEventSchema("tenant.ready", 1, Set.of("enterpriseId")))
            .withPropertyValues("byclaw.hooks.enabled=false", "byclaw.hooks.durable.enabled=true",
                "byclaw.hooks.subscriptions.receiver.event=tenant.ready",
                "byclaw.hooks.subscriptions.receiver.http.url=http://127.0.0.1/hook")
            .run(context -> {
                assertThat(context).hasNotFailed().hasSingleBean(DurableHookWorker.class).doesNotHaveBean(HookDispatcher.class);
                transaction.executeWithoutResult(status -> context.getBean(HookPublisher.class).publishDurable(
                    "tenant.ready", 1, "42", "1", "1", "command-42", Map.of("enterpriseId", "42")));
                assertThat(db.queryForObject("SELECT subscription_id FROM byai.integration_delivery", String.class)).isEqualTo("receiver");
            });
    }

    @Test
    void requiresRealTransactionForTheSameDatasource() {
        assertThatThrownBy(this::publish).isInstanceOf(IllegalStateException.class);
        var other = new DriverManagerDataSource("jdbc:h2:mem:other", "sa", "");
        new TransactionTemplate(new DataSourceTransactionManager(other)).executeWithoutResult(status ->
            assertThatThrownBy(this::publish).isInstanceOf(IllegalStateException.class));
        assertThat(db.queryForObject("SELECT count(*) FROM byai.integration_outbox", Integer.class)).isZero();
    }

    @Test
    void persistsWithoutSubscriptionsAndRollsBackTogetherWithBusinessWork() {
        transaction.executeWithoutResult(status -> {
            publish();
            assertThat(db.queryForObject("SELECT count(*) FROM byai.integration_outbox", Integer.class)).isEqualTo(1);
            status.setRollbackOnly();
        });
        assertThat(db.queryForObject("SELECT count(*) FROM byai.integration_outbox", Integer.class)).isZero();
        transaction.executeWithoutResult(status -> publish());
        assertThat(db.queryForObject("SELECT count(*) FROM byai.integration_outbox", Integer.class)).isEqualTo(1);
        assertThat(db.queryForObject("SELECT count(*) FROM byai.integration_delivery", Integer.class)).isZero();
    }

    @Test
    void subscriptionRowsRollbackWithTheOutbox() {
        HookProperties.Subscription subscription = new HookProperties.Subscription();
        subscription.setEvent("tenant.ready");
        properties.getSubscriptions().put("receiver", subscription);
        transaction.executeWithoutResult(status -> {
            publish();
            assertThat(db.queryForObject("SELECT count(*) FROM byai.integration_delivery", Integer.class)).isEqualTo(1);
            status.setRollbackOnly();
        });
        assertThat(db.queryForObject("SELECT count(*) FROM byai.integration_outbox", Integer.class)).isZero();
        assertThat(db.queryForObject("SELECT count(*) FROM byai.integration_delivery", Integer.class)).isZero();
    }

    @Test
    void subscriptionsAreIndependentAndStaleAcknowledgementCannotCompleteNewClaim() {
        for (String id : List.of("first", "second")) {
            HookProperties.Subscription subscription = new HookProperties.Subscription();
            subscription.setEvent("tenant.ready");
            subscription.getHttp().setUrl("http://127.0.0.1/hook");
            properties.getSubscriptions().put(id, subscription);
        }
        String event = transaction.execute(status -> publish());
        assertThat(db.queryForObject("SELECT count(*) FROM byai.integration_delivery", Integer.class)).isEqualTo(2);
        db.update("UPDATE byai.integration_delivery SET status='PROCESSING',fencing_token=2,"
            + "lease_until=DATEADD('SECOND',120,CURRENT_TIMESTAMP) WHERE subscription_id='first'");
        try (DurableHookWorker worker = new DurableHookWorker(source, properties,
            List.of(new HookEventSchema("tenant.ready", 1, Set.of("enterpriseId"))))) {
            assertThat(worker.acknowledge(new DurableHookWorker.Delivery(event, "first", 0, 0, "{}"),
                "DELIVERED", java.sql.Timestamp.from(java.time.Instant.now()), null, true)).isZero();
            assertThat(worker.acknowledge(new DurableHookWorker.Delivery(event, "first", 1, 1, "{}"),
                "DELIVERED", java.sql.Timestamp.from(java.time.Instant.now()), null, true)).isEqualTo(1);
        }
        assertThat(db.queryForObject("SELECT status FROM byai.integration_delivery WHERE subscription_id='second'",
            String.class)).isEqualTo("PENDING");
    }

    @Test
    void retriesWithStableIdentityAfterWorkerRestart() throws Exception {
        var server = com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
        var keys = new java.util.ArrayList<String>();
        server.createContext("/hook", exchange -> {
            keys.add(exchange.getRequestHeaders().getFirst("Idempotency-Key"));
            exchange.getRequestBody().readAllBytes();
            exchange.sendResponseHeaders(keys.size() == 1 ? 503 : 204, -1);
            exchange.close();
        });
        server.start();
        try {
            HookProperties.Subscription subscription = new HookProperties.Subscription();
            subscription.setEvent("tenant.ready");
            subscription.getRetry().setMaxAttempts(3);
            subscription.getRetry().setDelay(java.time.Duration.ofMillis(100));
            subscription.getHttp().setUrl("http://127.0.0.1:" + server.getAddress().getPort() + "/hook");
            properties.getSubscriptions().put("receiver", subscription);
            String event = transaction.execute(status -> publish());
            // H2 encodes CAST(varchar AS jsonb) as a JSON string; normalize this test fixture to PostgreSQL semantics.
            String encoded = db.queryForObject("SELECT payload FROM byai.integration_outbox", String.class);
            String body = new com.fasterxml.jackson.databind.ObjectMapper().readTree(encoded).asText();
            db.update("UPDATE byai.integration_outbox SET payload=? FORMAT JSON", body);
            var schemas = List.of(new HookEventSchema("tenant.ready", 1, Set.of("enterpriseId")));
            try (DurableHookWorker worker = new DurableHookWorker(source, properties, schemas)) {
                worker.poll();
            }
            assertThat(db.queryForObject("SELECT status FROM byai.integration_delivery", String.class)).isEqualTo("RETRY");
            db.update("UPDATE byai.integration_delivery SET next_attempt_at=CURRENT_TIMESTAMP");
            try (DurableHookWorker restarted = new DurableHookWorker(source, properties, schemas)) {
                restarted.poll();
            }
            assertThat(keys).hasSize(2);
            assertThat(keys.get(0)).isEqualTo(keys.get(1)).contains(event);
            assertThat(db.queryForObject("SELECT status FROM byai.integration_delivery", String.class)).isEqualTo("DELIVERED");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void rejectsTenantRoutingEvenInsideTransaction() {
        transaction.executeWithoutResult(status -> {
            CustomerContextHolder.setCustomerType("tenant-other");
            try {
                assertThatThrownBy(this::publish).isInstanceOf(IllegalStateException.class);
            } finally {
                CustomerContextHolder.clearCustomerType();
            }
        });
    }
}
