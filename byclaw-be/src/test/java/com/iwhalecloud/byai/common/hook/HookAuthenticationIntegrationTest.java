package com.iwhalecloud.byai.common.hook;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.domain.tenant.hook.TenantHookConfiguration;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.hook.WorkgroupHooks;
import com.sun.net.httpserver.HttpServer;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.FileSystemResource;
import org.springframework.transaction.support.TransactionTemplate;

/** 验证外置配置经过实际事件发布、事务提交和 HTTP 投递，验证通用认证配置。 */
class HookAuthenticationIntegrationTest {
    private static final String SECRET = "local-contract-test-signing-secret-32chars";
    private static final String PREFIX = "/callbacks";
    private final ObjectMapper json = new ObjectMapper();
    private final LinkedBlockingQueue<Delivery> deliveries = new LinkedBlockingQueue<>();
    private final AtomicBoolean enterpriseReady = new AtomicBoolean();
    private final TransactionTemplate transactions = new TransactionTemplate(new HookIntegrationTest.TestTransactions());
    private HttpServer server;
    private String baseUrl;

    /** 使用独立回环 HTTP 接收端，服务状态可由测试确定地推进。 */
    @BeforeEach
    void startReceiver() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext(PREFIX, exchange -> {
            byte[] body = exchange.getRequestBody().readAllBytes();
            Map<String, String> headers = new HashMap<>();
            exchange.getRequestHeaders().forEach((name, values) -> headers.put(name.toLowerCase(java.util.Locale.ROOT), values.getFirst()));
            boolean tenant = exchange.getRequestURI().getPath().endsWith("/tenants");
            if (tenant) {
                enterpriseReady.set(true);
            }
            int status = enterpriseReady.get() ? 202 : 409;
            deliveries.add(new Delivery(exchange.getRequestMethod(), exchange.getRequestURI().toASCIIString(), headers, body, status));
            exchange.sendResponseHeaders(status, -1);
            exchange.close();
        });
        server.start();
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
    }

    @AfterEach
    void stopReceiver() {
        server.stop(0);
    }

    /** 工作组先到时可重试，事件 ID 和正文保持不变，每次 HTTP 尝试重新签名。 */
    @Test
    void mergedYamlMapsEventsAndRetriesWithFreshSignatures() throws Exception {
        configured().run(context -> {
            assertThat(context).hasNotFailed();
            var publisher = context.getBean(HookPublisher.class);
            transactions.executeWithoutResult(status -> {
                publisher.publish("workgroup.created", 1, Map.of("enterpriseId", "9007199254740993", "groupId", "9007199254740995", "groupName", "工作组", "projectId", "p1", "createdBy", "u1"));
                assertThat(deliveries).isEmpty();
            });
            Delivery first = deliveries.poll(5, TimeUnit.SECONDS);
            assertThat(first).isNotNull();
            assertThat(first.status()).isEqualTo(409);
            assertValidSignature(first);
            JsonNode workgroup = json.readTree(first.body());
            assertThat(workgroup.path("enterpriseId").asText()).isEqualTo("9007199254740993");
            assertThat(workgroup.path("workgroupId").asText()).isEqualTo("9007199254740995");
            assertThat(workgroup.path("occurredAt").isIntegralNumber()).isTrue();
            assertThat(workgroup.path("eventId").asText()).isNotBlank();
            assertThat(workgroup.fieldNames()).toIterable().containsExactlyInAnyOrder("enterpriseId", "workgroupId", "eventId", "occurredAt", "groupName", "projectId", "createdBy");
            transactions.executeWithoutResult(status -> publisher.publish("tenant.created", 1, Map.of("enterpriseId", "9007199254740993", "enterpriseName", "企业", "packageId", "p1", "packageName", "套餐", "createdBy", "u1", "requestId", "r1", "provisionState", "RESERVED")));
            Delivery tenant = null;
            Delivery recovered = null;
            for (int index = 0; index < 10 && (tenant == null || recovered == null); index++) {
                Delivery item = deliveries.poll(5, TimeUnit.SECONDS);
                assertThat(item).isNotNull();
                if (item.path().endsWith("/tenants")) {
                    assertThat(item.headers()).doesNotContainKey("authorization");
                    tenant = item;
                } else {
                    assertValidSignature(item);
                    if (item.status() == 202) {
                        recovered = item;
                    }
                }
            }
            assertThat(tenant).isNotNull();
            assertThat(recovered).isNotNull();
            assertThat(recovered.body()).isEqualTo(first.body());
            assertThat(recovered.headers().get("x-webhook-nonce")).isNotEqualTo(first.headers().get("x-webhook-nonce"));
            assertThat(recovered.headers().get("x-webhook-signature")).isNotEqualTo(first.headers().get("x-webhook-signature"));
            assertThat(recovered.headers().get("idempotency-key")).isEqualTo(first.headers().get("idempotency-key"));
            var enterprise = json.readTree(tenant.body());
            assertThat(enterprise.fieldNames()).toIterable().containsExactlyInAnyOrder("enterpriseId", "eventId", "occurredAt", "enterpriseName", "packageId", "packageName", "createdBy", "requestId", "provisionState");
            assertThat(enterprise.path("eventId").asText()).isNotEqualTo(workgroup.path("eventId").asText());
            assertThat(enterprise.path("occurredAt").asLong()).isBetween(Instant.now().getEpochSecond() - 30, Instant.now().getEpochSecond());
        });
    }

    /** 个人工作组无企业归属，应在投递前过滤，而不是向接收方发送无效企业。 */
    @Test
    void mergedYamlFiltersPersonalWorkgroups() throws Exception {
        configured().run(context -> {
            assertThat(context).hasNotFailed();
            var data = new HashMap<String, Object>();
            data.put("enterpriseId", null);
            data.put("groupId", "personal-group");
            transactions.executeWithoutResult(status -> context.getBean(HookPublisher.class).publish("workgroup.created", 1, data));
            assertThat(context.getBean(SimpleMeterRegistry.class).get("byclaw.hooks.deliveries").tags("subscription", "workgroup-sync", "outcome", "filtered").counter().count()).isEqualTo(1);
            assertThat(deliveries).isEmpty();
        });
    }

    /** 签名配置错误分别指出字段，不回显密钥；禁止静态覆盖认证头。 */
    @Test
    void invalidSigningConfigurationFailsClosedWithoutLeakingSecrets() throws Exception {
        configured().withPropertyValues(
            "byclaw.hooks.subscriptions.workgroup-sync.http.auth.client-id=invalid client",
            "byclaw.hooks.subscriptions.workgroup-sync.http.auth.secret=short-secret",
            "byclaw.hooks.subscriptions.workgroup-sync.http.headers.X-Webhook-Signature=static-signature",
            "byclaw.hooks.subscriptions.workgroup-sync.http.url=http://remote.invalid/hook",
            "byclaw.hooks.subscriptions.workgroup-sync.retry.max-attempts=0")
            .run(context -> {
                assertThat(context).hasFailed();
                String errors = context.getStartupFailure().toString();
                assertThat(context.getStartupFailure()).hasStackTraceContaining("auth.client-id")
                    .hasStackTraceContaining("auth.secret").hasStackTraceContaining("auth.headers.X-Webhook-Signature")
                    .hasStackTraceContaining("retry.max-attempts");
                assertThat(errors).doesNotContain("short-secret", "static-signature", "remote.invalid");
            });
    }

    /** Remote HTTP endpoints are valid without the legacy loopback opt-in. */
    @Test
    void remoteHttpSigningConfigurationIsAccepted() throws Exception {
        configured().withPropertyValues(
            "byclaw.hooks.subscriptions.workgroup-sync.http.url=http://remote.invalid/hook",
            "byclaw.hooks.subscriptions.workgroup-sync.http.auth.allow-loopback-http=false")
            .run(context -> {
                assertThat(context).hasNotFailed();
                assertThat(context).hasSingleBean(HookDispatcher.class);
            });
    }

    /** 只有显式允许的失败状态才重试，终止后不再投递。 */
    @Test
    void retryStopsAtConfiguredAttemptLimit() throws Exception {
        configured().withPropertyValues("byclaw.hooks.subscriptions.workgroup-sync.retry.max-attempts=2")
            .run(context -> {
                assertThat(context).hasNotFailed();
                transactions.executeWithoutResult(status -> context.getBean(HookPublisher.class)
                    .publish("workgroup.created", 1, Map.of("enterpriseId", "42", "groupId", "g42", "groupName", "工作组", "projectId", "p1", "createdBy", "u1")));
                var first = deliveries.poll(5, TimeUnit.SECONDS);
                var second = deliveries.poll(5, TimeUnit.SECONDS);
                assertThat(first).isNotNull();
                assertThat(second).isNotNull();
                org.awaitility.Awaitility.await().atMost(java.time.Duration.ofSeconds(5)).untilAsserted(() ->
                    assertThat(context.getBean(SimpleMeterRegistry.class).get("byclaw.hooks.deliveries")
                        .tags("subscription", "workgroup-sync", "outcome", "http_error").counter().count()).isEqualTo(1));
                assertThat(deliveries).isEmpty();
            });
    }

    /** 另一接收方只改签名配置即可使用通用认证，不依赖固定头名或协议字段。 */
    @Test
    void anotherWebhookProtocolUsesOnlyConfiguredFieldsAndHeaders() throws Exception {
        enterpriseReady.set(true);
        new ApplicationContextRunner().withUserConfiguration(HookConfiguration.class, TenantHookConfiguration.class)
            .withPropertyValues("byclaw.hooks.enabled=true",
                "byclaw.hooks.subscriptions.other.event=tenant.created",
                "byclaw.hooks.subscriptions.other.http.url=" + baseUrl + PREFIX + "/tenants",
                "byclaw.hooks.subscriptions.other.http.auth.type=hmac-sha256",
                "byclaw.hooks.subscriptions.other.http.auth.secret=" + SECRET,
                "byclaw.hooks.subscriptions.other.http.auth.allow-loopback-http=true",
                "byclaw.hooks.subscriptions.other.http.auth.canonical-fields[0].value=custom-protocol",
                "byclaw.hooks.subscriptions.other.http.auth.canonical-fields[1].from=request.bodySha256",
                "byclaw.hooks.subscriptions.other.http.auth.headers.X-Custom-Signature.from=signature",
                "byclaw.hooks.subscriptions.other.http.auth.headers.X-Custom-Nonce.from=request.nonce")
            .run(context -> {
                assertThat(context).hasNotFailed();
                transactions.executeWithoutResult(status -> context.getBean(HookPublisher.class)
                    .publish("tenant.created", 1, Map.of("enterpriseId", "42")));
                Delivery delivery = deliveries.poll(5, TimeUnit.SECONDS);
                assertThat(delivery).isNotNull();
                assertThat(delivery.headers()).doesNotContainKeys("x-webhook-client", "x-webhook-signature", "x-webhook-nonce", "x-webhook-timestamp");
                String canonical = "custom-protocol\n" + HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(delivery.body()));
                Mac hmac = Mac.getInstance("HmacSHA256");
                hmac.init(new SecretKeySpec(SECRET.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
                assertThat(delivery.headers().get("x-custom-signature")).isEqualTo(HexFormat.of().formatHex(hmac.doFinal(canonical.getBytes(StandardCharsets.UTF_8))));
                assertThat(delivery.headers().get("x-custom-nonce")).isNotBlank();
            });
        configured().withPropertyValues("byclaw.hooks.subscriptions.workgroup-sync.http.auth.headers.Leak.from=auth.secret")
            .run(context -> {
                assertThat(context).hasFailed();
                assertThat(context.getStartupFailure()).hasStackTraceContaining("auth.headers.Leak");
            });
    }

    /** 按真实协议独立计算 HMAC，覆盖方法、编码后的路径/查询、幂等头和原始请求体。 */
    private void assertValidSignature(Delivery delivery) throws Exception {
        var headers = delivery.headers();
        assertThat(headers.get("x-webhook-client")).isEqualTo("byclaw-service");
        assertThat(headers).doesNotContainKey("authorization");
        assertThat(headers.values()).doesNotContain(SECRET);
        String[] target = delivery.path().split("\\?", 2);
        String canonical = String.join("\n", "hook-request-v1", "byclaw-service", delivery.method(), target[0],
            target.length == 2 ? target[1] : "", headers.get("x-webhook-timestamp"), headers.get("x-webhook-nonce"),
            headers.getOrDefault("idempotency-key", ""), HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(delivery.body())));
        Mac hmac = Mac.getInstance("HmacSHA256");
        hmac.init(new SecretKeySpec(SECRET.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        assertThat(headers.get("x-webhook-signature")).isEqualTo(HexFormat.of().formatHex(hmac.doFinal(canonical.getBytes(StandardCharsets.UTF_8))));
        assertThat(headers.get("x-webhook-nonce")).matches("[a-zA-Z0-9_-]{16,128}");
        assertThat(Long.parseLong(headers.get("x-webhook-timestamp"))).isBetween(Instant.now().getEpochSecond() - 30, Instant.now().getEpochSecond());
    }

    /** 加载待交付的同一份外置 YAML，只覆盖环境专用 URL、密钥与测试重试间隔。 */
    private ApplicationContextRunner configured() throws Exception {
        var sources = new YamlPropertySourceLoader().load("generic-hooks", new FileSystemResource("config/examples/hooks.yaml"));
        return new ApplicationContextRunner().withUserConfiguration(HookConfiguration.class, TenantHookConfiguration.class, WorkgroupHooks.class, Metrics.class)
            .withInitializer(context -> sources.forEach(source -> context.getEnvironment().getPropertySources().addLast(source)))
            .withPropertyValues("BYCLAW_HOOKS_ENABLED=true",
                "byclaw.hooks.subscriptions.registration-crm.enabled=false",
                "byclaw.hooks.subscriptions.tenant-sync.enabled=true",
                "byclaw.hooks.subscriptions.workgroup-sync.enabled=true",
                "TENANT_CREATED_HOOK_URL=" + baseUrl + PREFIX + "/tenants",
                "WORKGROUP_CREATED_HOOK_URL=" + baseUrl + PREFIX + "/workgroups",
                "WORKGROUP_HOOK_SIGNING_SECRET=" + SECRET, "WORKGROUP_HOOK_ALLOW_LOOPBACK_HTTP=true",
                "byclaw.hooks.subscriptions.workgroup-sync.retry.statuses=409,429,500,502,503,504",
                "byclaw.hooks.subscriptions.workgroup-sync.retry.max-attempts=10",
                "byclaw.hooks.subscriptions.workgroup-sync.retry.delay=100ms");
    }

    record Delivery(String method, String path, Map<String, String> headers, byte[] body, int status) { }

    @Configuration(proxyBeanMethods = false)
    static class Metrics {
        @Bean SimpleMeterRegistry meters() { return new SimpleMeterRegistry(); }
    }
}
