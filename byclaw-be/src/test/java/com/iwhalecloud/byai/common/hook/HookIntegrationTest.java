package com.iwhalecloud.byai.common.hook;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.AbstractPlatformTransactionManager;
import org.springframework.transaction.support.DefaultTransactionStatus;
import org.springframework.transaction.support.TransactionTemplate;

import static org.assertj.core.api.Assertions.assertThat;

class HookIntegrationTest {
    private HttpServer server;
    private String url;
    private final LinkedBlockingQueue<Received> received = new LinkedBlockingQueue<>();
    private final ApplicationContextRunner runner = new ApplicationContextRunner()
        .withUserConfiguration(HookConfiguration.class, SchemaConfiguration.class);
    private final TransactionTemplate transactions = new TransactionTemplate(new TestTransactions());

    @BeforeEach
    void startReceiver() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/hook", exchange -> {
            received.add(new Received(exchange.getRequestMethod(), exchange.getRequestHeaders().getFirst("X-Origin"),
                exchange.getRequestHeaders().getFirst("Authorization"),
                exchange.getRequestHeaders().getFirst("Idempotency-Key"),
                new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)));
            exchange.sendResponseHeaders(204, -1);
            exchange.close();
        });
        server.start();
        url = "http://127.0.0.1:" + server.getAddress().getPort() + "/hook";
    }

    @AfterEach
    void stopReceiver() { server.stop(0); }

    @Test
    void disabledByDefaultDoesNotResolveSecretsOrCreateWorkers() {
        runner.withPropertyValues("byclaw.hooks.subscriptions.crm.http.url=${UNSET_HOOK_URL}")
            .run(context -> {
                assertThat(context).hasNotFailed().doesNotHaveBean(HookDispatcher.class);
                assertThat(context.containsBean("hookExecutor")).isFalse();
                transactions.executeWithoutResult(status -> context.getBean(HookPublisher.class)
                    .publish("user.registered", 1, Map.of("userId", "42")));
                assertThat(received).isEmpty();
            });
    }

    @Test
    void externalYamlMapsHttpOnlyAfterCommitAndSnapshotsData() throws Exception {
        String yaml = """
            byclaw:
              hooks:
                enabled: true
                subscriptions:
                  crm:
                    event: user.registered
                    event-version: 1
                    http:
                      url: '%s'
                      method: POST
                      headers:
                        X-Origin: test
                      auth:
                        type: bearer
                        token: test-token
                      body:
                        id:
                          from: data.userId
                        name:
                          from: data.displayName
                        eventId:
                          from: event.id
                        count:
                          value: 7
                        active:
                          value: true
            """.formatted(url);
        var sources = new YamlPropertySourceLoader().load("external-hooks",
            new ByteArrayResource(yaml.getBytes(StandardCharsets.UTF_8)));
        runner.withInitializer(context -> sources.forEach(source -> context.getEnvironment()
            .getPropertySources().addFirst(source))).run(context -> {
                assertThat(context).hasNotFailed();
                var data = new java.util.HashMap<String, Object>();
                data.put("userId", "9007199254740993");
                data.put("displayName", "张\"三\n测试");
                transactions.executeWithoutResult(status -> {
                    context.getBean(HookPublisher.class).publish("user.registered", 1, data);
                    assertThat(received).isEmpty();
                    data.put("displayName", "changed");
                });
                Received request = received.poll(5, TimeUnit.SECONDS);
                assertThat(request).isNotNull();
                assertThat(request.method()).isEqualTo("POST");
                assertThat(request.origin()).isEqualTo("test");
                assertThat(request.authorization()).isEqualTo("Bearer test-token");
                var body = new ObjectMapper().readTree(request.body());
                assertThat(body.path("id").asText()).isEqualTo("9007199254740993");
                assertThat(body.path("name").asText()).isEqualTo("张\"三\n测试");
                assertThat(body.path("count").isNumber()).isTrue();
                assertThat(body.path("active").booleanValue()).isTrue();
                assertThat(request.idempotency()).isEqualTo(body.path("eventId").asText() + ":crm");
            });
    }

    @Test
    void rollbackAndMissingTransactionNeverSend() {
        enabled().run(context -> {
            var publisher = context.getBean(HookPublisher.class);
            transactions.executeWithoutResult(status -> {
                publisher.publish("user.registered", 1, Map.of("userId", "42"));
                status.setRollbackOnly();
            });
            publisher.publish("user.registered", 1, Map.of("userId", "42"));
            assertThat(received.poll(200, TimeUnit.MILLISECONDS)).isNull();
        });
    }

    @Test
    void invalidEventAndFieldFailAtStartupWithoutEchoingSecret() {
        enabled().withPropertyValues("byclaw.hooks.subscriptions.crm.event=unknown",
            "byclaw.hooks.subscriptions.crm.http.auth.token=private-value").run(context -> {
                assertThat(context).hasFailed();
                assertThat(context.getStartupFailure()).hasStackTraceContaining("subscriptions.crm.event")
                    .hasStackTraceContaining("unknown event");
                assertThat(context.getStartupFailure().toString()).doesNotContain("private-value");
            });
        enabled().withPropertyValues("byclaw.hooks.subscriptions.crm.http.body.password.from=data.pwd")
            .run(context -> {
                assertThat(context).hasFailed();
                assertThat(context.getStartupFailure()).hasStackTraceContaining("body.password");
            });
    }

    @Test
    void failedReceiverDoesNotPreventAnotherSubscriptionOrChangeCommitResult() {
        server.createContext("/fail", exchange -> {
            exchange.sendResponseHeaders(500, -1);
            exchange.close();
        });
        enabled().withPropertyValues("byclaw.hooks.subscriptions.failing.event=user.registered",
            "byclaw.hooks.subscriptions.failing.http.url=" + url.replace("/hook", "/fail"))
            .run(context -> {
                String result = transactions.execute(status -> {
                    context.getBean(HookPublisher.class).publish("user.registered", 1, Map.of("userId", "42"));
                    return "registered";
                });
                assertThat(result).isEqualTo("registered");
                assertThat(received.poll(5, TimeUnit.SECONDS)).isNotNull();
                var meters = context.getBean(io.micrometer.core.instrument.MeterRegistry.class);
                org.awaitility.Awaitility.await().atMost(java.time.Duration.ofSeconds(5)).untilAsserted(() ->
                    assertThat(meters.get("byclaw.hooks.deliveries").tags("subscription", "failing", "outcome", "http_error")
                        .counter().count()).isEqualTo(1));
            });
    }

    @Test
    void saturatedExecutorDoesNotRunHttpOnTransactionThread() {
        enabled().run(context -> {
            var executor = context.getBean("hookExecutor", org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor.class);
            var release = new java.util.concurrent.CountDownLatch(1);
            try {
                // Fill all workers and the bounded queue without relying on sleeps.
                for (int index = 0; index < 104; index++) {
                    executor.execute(() -> {
                        try { release.await(); } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
                    });
                }
                transactions.executeWithoutResult(status -> context.getBean(HookPublisher.class)
                    .publish("user.registered", 1, Map.of("userId", "42")));
                assertThat(received).isEmpty();
                assertThat(context.getBean(io.micrometer.core.instrument.MeterRegistry.class)
                    .get("byclaw.hooks.deliveries").tags("outcome", "rejected").counter().count()).isEqualTo(1);
            } finally {
                release.countDown();
            }
        });
    }

    @Test
    void redirectIsNotFollowedAndTimeoutIsBounded() {
        server.createContext("/redirect", exchange -> {
            exchange.getResponseHeaders().add("Location", url);
            exchange.sendResponseHeaders(302, -1);
            exchange.close();
        });
        enabled().withPropertyValues("byclaw.hooks.subscriptions.crm.http.url=" + url.replace("/hook", "/redirect"))
            .run(context -> {
                transactions.executeWithoutResult(status -> context.getBean(HookPublisher.class)
                    .publish("user.registered", 1, Map.of("userId", "42")));
                var meters = context.getBean(io.micrometer.core.instrument.MeterRegistry.class);
                org.awaitility.Awaitility.await().atMost(java.time.Duration.ofSeconds(5)).untilAsserted(() ->
                    assertThat(meters.get("byclaw.hooks.deliveries").tags("outcome", "http_error").counter().count()).isEqualTo(1));
                assertThat(received).isEmpty();
            });
        server.createContext("/slow", exchange -> {
            try { Thread.sleep(200); } catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); }
            exchange.close();
        });
        enabled().withPropertyValues("byclaw.hooks.subscriptions.crm.http.url=" + url.replace("/hook", "/slow"),
            "byclaw.hooks.defaults.call-timeout=30ms").run(context -> {
                transactions.executeWithoutResult(status -> context.getBean(HookPublisher.class)
                    .publish("user.registered", 1, Map.of("userId", "42")));
                var meters = context.getBean(io.micrometer.core.instrument.MeterRegistry.class);
                org.awaitility.Awaitility.await().atMost(java.time.Duration.ofSeconds(5)).untilAsserted(() ->
                    assertThat(meters.get("byclaw.hooks.deliveries").tags("outcome", "transport_error").counter().count()).isEqualTo(1));
            });
    }

    @Test
    void disabledSubscriptionAndUnmatchedEventDoNotSend() {
        enabled().withPropertyValues("byclaw.hooks.subscriptions.crm.enabled=false").run(context -> {
            transactions.executeWithoutResult(status -> context.getBean(HookPublisher.class)
                .publish("user.registered", 1, Map.of("userId", "42")));
            assertThat(received.poll(100, TimeUnit.MILLISECONDS)).isNull();
        });
        enabled().run(context -> {
            transactions.executeWithoutResult(status -> context.getBean(HookPublisher.class)
                .publish("other.event", 1, Map.of("userId", "42")));
            assertThat(received.poll(100, TimeUnit.MILLISECONDS)).isNull();
        });
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"POST", "GET"})
    void serviceUnavailableRetryAfterZeroNeverReplaysRequest(String method) {
        var calls = new java.util.concurrent.atomic.AtomicInteger();
        server.createContext("/unavailable", exchange -> {
            calls.incrementAndGet();
            exchange.getResponseHeaders().add("Retry-After", "0");
            exchange.sendResponseHeaders(503, -1);
            exchange.close();
        });
        runner.withPropertyValues("byclaw.hooks.enabled=true",
            "byclaw.hooks.subscriptions.crm.event=user.registered",
            "byclaw.hooks.subscriptions.crm.http.method=" + method,
            "byclaw.hooks.subscriptions.crm.http.url=" + url.replace("/hook", "/unavailable")).run(context -> {
                transactions.executeWithoutResult(status -> context.getBean(HookPublisher.class)
                    .publish("user.registered", 1, Map.of("userId", "42")));
                var meters = context.getBean(io.micrometer.core.instrument.MeterRegistry.class);
                org.awaitility.Awaitility.await().atMost(java.time.Duration.ofSeconds(5)).untilAsserted(() ->
                    assertThat(meters.find("byclaw.hooks.deliveries").counters().stream()
                        .mapToDouble(io.micrometer.core.instrument.Counter::count).sum()).isEqualTo(1));
                assertThat(calls).hasValue(1);
            });
    }

    @Test
    void hookWorkersNeverInheritRegistrationIdentityOrTenantContext() {
        enabled().run(context -> {
            var executor = context.getBean("hookExecutor", org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor.class);
            var login = new com.iwhalecloud.byai.common.login.bean.LoginInfo();
            login.setUserId(42L);
            com.iwhalecloud.byai.common.login.auth.CurrentUserHolder.setLoginInfo(login);
            com.iwhalecloud.byai.common.datasource.config.CustomerContextHolder.setCustomerType("request-tenant");
            try {
                for (int task = 0; task < 4; task++) {
                    assertThat(executor.submit(() -> com.iwhalecloud.byai.common.login.auth.CurrentUserHolder.getLoginInfo())
                        .get(5, TimeUnit.SECONDS)).isNull();
                    assertThat(executor.submit(() -> com.iwhalecloud.byai.common.datasource.config.CustomerContextHolder.getCustomerType())
                        .get(5, TimeUnit.SECONDS)).isNull();
                }
            } finally {
                com.iwhalecloud.byai.common.login.auth.CurrentUserHolder.clearLoginInfo();
                com.iwhalecloud.byai.common.datasource.config.CustomerContextHolder.clearCustomerType();
            }
            assertThat(executor.submit(() -> com.iwhalecloud.byai.common.login.auth.CurrentUserHolder.getLoginInfo())
                .get(5, TimeUnit.SECONDS)).isNull();
        });
    }

    @Test
    void deploymentExampleLoadsThroughSpringAdditionalLocation(@org.junit.jupiter.api.io.TempDir java.nio.file.Path directory)
        throws Exception {
        var config = directory.resolve("hooks.yaml");
        java.nio.file.Files.copy(java.nio.file.Path.of("config/examples/hooks.yaml"), config);
        var external = runner.withInitializer(new org.springframework.boot.test.context.ConfigDataApplicationContextInitializer())
            .withPropertyValues("spring.config.additional-location=" + config.toUri());
        external.run(context -> assertThat(context).hasNotFailed().doesNotHaveBean(HookDispatcher.class));
        external.withPropertyValues("byclaw.hooks.enabled=true", "REGISTRATION_HOOK_URL=" + url,
            "REGISTRATION_HOOK_TOKEN=deployment-test-token").run(context -> {
                assertThat(context).hasNotFailed();
                transactions.executeWithoutResult(status -> context.getBean(HookPublisher.class)
                    .publish("user.registered", 1,
                        Map.of("userId", "42", "displayName", "测试用户", "registrationSource", "phone")));
                var request = received.poll(5, TimeUnit.SECONDS);
                assertThat(request).isNotNull();
                assertThat(request.authorization()).isEqualTo("Bearer deployment-test-token");
                assertThat(new ObjectMapper().readTree(request.body()).path("registrationSource").asText()).isEqualTo("phone");
            });
    }

    @Test
    void invalidHttpConfigurationReportsEachField() {
        enabled().withPropertyValues("byclaw.hooks.defaults.call-timeout=0s",
            "byclaw.hooks.subscriptions.crm.http.url=ftp://invalid.test",
            "byclaw.hooks.subscriptions.crm.http.body.id.value=constant",
            "byclaw.hooks.subscriptions.crm.http.headers.Host=invalid.test").run(context -> {
                assertThat(context).hasFailed();
                assertThat(context.getStartupFailure()).hasStackTraceContaining("defaults.call-timeout")
                    .hasStackTraceContaining("subscriptions.crm.http.url")
                    .hasStackTraceContaining("subscriptions.crm.http.body.id")
                    .hasStackTraceContaining("subscriptions.crm.http.headers");
            });
    }

    private ApplicationContextRunner enabled() {
        return runner.withPropertyValues("byclaw.hooks.enabled=true",
            "byclaw.hooks.subscriptions.crm.event=user.registered",
            "byclaw.hooks.subscriptions.crm.http.url=" + url,
            "byclaw.hooks.subscriptions.crm.http.body.id.from=data.userId");
    }

    record Received(String method, String origin, String authorization, String idempotency, String body) { }

    @Configuration(proxyBeanMethods = false)
    static class SchemaConfiguration {
        @Bean io.micrometer.core.instrument.simple.SimpleMeterRegistry meters() {
            return new io.micrometer.core.instrument.simple.SimpleMeterRegistry();
        }

        @Bean HookEventSchema registrationSchema() {
            return new HookEventSchema("user.registered", 1, Set.of("userId", "displayName", "registrationSource"));
        }
    }

    /** Exercises real synchronization callbacks without an external database. */
    static class TestTransactions extends AbstractPlatformTransactionManager {
        @Override protected Object doGetTransaction() { return new Object(); }
        @Override protected void doBegin(Object transaction, TransactionDefinition definition) { }
        @Override protected void doCommit(DefaultTransactionStatus status) { }
        @Override protected void doRollback(DefaultTransactionStatus status) { }
    }
}
