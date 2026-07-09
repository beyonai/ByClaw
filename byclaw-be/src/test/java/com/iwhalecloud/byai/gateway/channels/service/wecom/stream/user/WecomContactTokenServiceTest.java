package com.iwhalecloud.byai.gateway.channels.service.wecom.stream.user;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.config.WecomStreamProperties;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.model.WecomRobotChannelConfig;
import com.iwhalecloud.byai.gateway.channels.service.wecom.stream.config.WecomRobotConfigService;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class WecomContactTokenServiceTest {

    private HttpServer server;

    @BeforeEach
    void setUp() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.start();
    }

    @AfterEach
    void tearDown() {
        if (server != null) {
            server.stop(0);
        }
    }

    @Test
    void springCanCreateBeanWithProductionConstructor() {
        assertThatCode(() -> {
            try (AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext()) {
                context.getBeanFactory().registerSingleton("objectMapper", new ObjectMapper());
                context.getBeanFactory().registerSingleton("wecomStreamProperties", new WecomStreamProperties());
                context.getBeanFactory().registerSingleton("wecomRobotConfigService", mock(WecomRobotConfigService.class));
                context.registerBean(WecomContactTokenService.class);

                context.refresh();

                assertThat(context.getBean(WecomContactTokenService.class)).isNotNull();
            }
        }).doesNotThrowAnyException();
    }

    @Test
    void getAccessTokenCachesByCorpIdAndAgentIdFor119Minutes() {
        server.createContext("/cgi-bin/gettoken", exchange -> {
            byte[] body = """
                    {
                      "errcode": 0,
                      "errmsg": "ok",
                      "access_token": "contact-token",
                      "expires_in": 7200
                    }
                    """.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });

        WecomStreamProperties properties = new WecomStreamProperties();
        properties.getContact().setTokenUrl("http://127.0.0.1:" + server.getAddress().getPort() + "/cgi-bin/gettoken");
        WecomRobotConfigService robotConfigService = mock(WecomRobotConfigService.class);
        WecomRobotChannelConfig config = new WecomRobotChannelConfig();
        config.setCorpId("ww-corp");
        config.setAgentId("1000002");
        config.setCorpSecret("contact-secret");
        when(robotConfigService.getRobotConfig("bot-001")).thenReturn(config);

        CapturingTokenCache cache = new CapturingTokenCache();
        WecomContactTokenService service = new WecomContactTokenService(
                new ObjectMapper(), properties, robotConfigService, cache);

        String token = service.getAccessToken("bot-001");

        assertThat(token).isEqualTo("contact-token");
        assertThat(cache.getKey).isEqualTo("wecom:contact:access_token:ww-corp:1000002");
        assertThat(cache.setKey).isEqualTo("wecom:contact:access_token:ww-corp:1000002");
        assertThat(cache.value).isEqualTo("contact-token");
        assertThat(cache.timeout).isEqualTo(119L);
        assertThat(cache.unit).isEqualTo(TimeUnit.MINUTES);
    }

    private static class CapturingTokenCache implements WecomContactTokenService.TokenCache {
        private String getKey;
        private String setKey;
        private String value;
        private long timeout;
        private TimeUnit unit;

        @Override
        public String get(String key) {
            this.getKey = key;
            return null;
        }

        @Override
        public void set(String key, String value, long timeout, TimeUnit unit) {
            this.setKey = key;
            this.value = value;
            this.timeout = timeout;
            this.unit = unit;
        }
    }
}
