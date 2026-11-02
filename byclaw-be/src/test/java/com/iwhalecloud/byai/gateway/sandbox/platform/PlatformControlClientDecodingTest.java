package com.iwhalecloud.byai.gateway.sandbox.platform;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.iwhalecloud.byai.common.feign.config.FeignConfiguration;
import com.iwhalecloud.byai.common.feign.config.FeignSensitiveConfig;
import com.iwhalecloud.byai.common.i18n.I18nTestSupport;
import com.sun.net.httpserver.HttpServer;
import feign.FeignException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.http.HttpMessageConverters;
import org.springframework.boot.autoconfigure.jackson.JacksonAutoConfiguration;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.cloud.openfeign.EnableFeignClients;
import org.springframework.cloud.openfeign.FeignAutoConfiguration;
import org.springframework.context.annotation.Configuration;

/** Platform metrics use Prometheus text while control operations use JSON envelopes. */
class PlatformControlClientDecodingTest extends I18nTestSupport {
    private HttpServer server;
    private int status;
    private String contentType;
    private String body;

    @BeforeEach
    void startServer() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/internal/platform/", exchange -> {
            exchange.getRequestBody().readAllBytes();
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", contentType);
            exchange.sendResponseHeaders(status, bytes.length);
            try (var output = exchange.getResponseBody()) {
                output.write(bytes);
            }
        });
        server.start();
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    @Test
    void metricsBypassTheParentJsonOnlyDecoder() {
        status = 200;
        contentType = "text/plain; version=0.0.4; charset=utf-8";
        body = "# TYPE byclaw_sandbox_boundary_blacklist gauge\n"
            + "byclaw_sandbox_boundary_blacklist{direction=\"up\"} 1\n";
        context().run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context.getBean(PlatformControlClient.class).metrics()).isEqualTo(body);
        });
    }

    @Test
    void emptyMetricsResponsesRemainEmpty() {
        status = 200;
        contentType = "text/plain";
        body = "";
        context().run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context.getBean(PlatformControlClient.class).metrics()).isEmpty();
        });
    }

    @Test
    void controlOperationsStillDecodeJsonEnvelopes() {
        status = 200;
        contentType = "application/json";
        body = "{\"code\":0,\"msg\":\"success\",\"data\":{\"ready\":true}}";
        context().run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context.getBean(PlatformControlClient.class).call("sandbox", "status", Map.of()))
                .containsEntry("code", 0).containsEntry("data", Map.of("ready", true));
        });
    }

    @Test
    void nonSuccessMetricsResponsesStillFail() {
        status = 503;
        contentType = "text/plain";
        body = "temporarily unavailable";
        context().run(context -> {
            assertThat(context).hasNotFailed();
            assertThatThrownBy(() -> context.getBean(PlatformControlClient.class).metrics())
                .isInstanceOfSatisfying(FeignException.class, failure -> assertThat(failure.status()).isEqualTo(503));
        });
    }

    @Test
    void invalidJsonControlResponsesAreNotAcceptedAsSuccess() {
        status = 200;
        contentType = "text/html";
        body = "<html>upstream login page</html>";
        context().run(context -> {
            assertThat(context).hasNotFailed();
            assertThatThrownBy(() -> context.getBean(PlatformControlClient.class).call("sandbox", "status", Map.of()))
                .isInstanceOf(FeignException.class);
        });
    }

    private ApplicationContextRunner context() {
        return new ApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(JacksonAutoConfiguration.class, FeignAutoConfiguration.class))
            .withUserConfiguration(Clients.class, FeignConfiguration.class)
            .withBean(HttpMessageConverters.class, HttpMessageConverters::new)
            .withBean(FeignSensitiveConfig.class, FeignSensitiveConfig::new)
            .withBean(PlatformBridgeTokens.class,
                () -> new PlatformBridgeTokens("fixture-platform-service-key-at-least-32-bytes", 1))
            .withPropertyValues("byclaw.platform.execution-mode=remote",
                "byclaw.platform.base-url=http://127.0.0.1:" + server.getAddress().getPort());
    }

    @Configuration(proxyBeanMethods = false)
    @EnableFeignClients(clients = PlatformControlClient.class)
    static class Clients {
    }
}
