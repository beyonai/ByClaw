package com.iwhalecloud.byai.gateway.channels.service.wecom.stream;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.config.WecomStreamProperties;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class WecomContactUserServiceTest {

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
    void getUserDetailMapsAliasTelephoneDepartmentAndUsesBizMailFallback() {
        server.createContext("/cgi-bin/user/get", exchange -> {
            byte[] body = """
                    {
                      "errcode": 0,
                      "errmsg": "ok",
                      "userid": "zhangsan",
                      "name": "张三",
                      "department": [1, 2],
                      "telephone": "15920550664",
                      "alias": "谢逊飞",
                      "biz_mail": "zhangsan@example.com"
                    }
                    """.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });

        WecomStreamProperties properties = new WecomStreamProperties();
        properties.getContact().setUserGetUrl("http://127.0.0.1:" + server.getAddress().getPort() + "/cgi-bin/user/get");
        WecomContactTokenService tokenService = mock(WecomContactTokenService.class);
        when(tokenService.getAccessToken("bot-001")).thenReturn("token");
        WecomContactUserService service = new WecomContactUserService(new ObjectMapper(), properties, tokenService);

        WecomUserDetail detail = service.getUserDetail("bot-001", "zhangsan");

        assertThat(detail.getUserid()).isEqualTo("zhangsan");
        assertThat(detail.getName()).isEqualTo("谢逊飞");
        assertThat(detail.getMobile()).isEqualTo("15920550664");
        assertThat(detail.getDepartment()).isEqualTo(List.of(1L, 2L));
        assertThat(detail.getEmail()).isEqualTo("zhangsan@example.com");
    }

    @Test
    void getUserDetailFallsBackNameToMobileWhenAliasIsMissing() {
        server.createContext("/cgi-bin/user/get", exchange -> {
            byte[] body = """
                    {
                      "errcode": 0,
                      "errmsg": "ok",
                      "userid": "zhangsan",
                      "name": "张三",
                      "mobile": "13800000000",
                      "telephone": "15920550664"
                    }
                    """.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });

        WecomStreamProperties properties = new WecomStreamProperties();
        properties.getContact().setUserGetUrl("http://127.0.0.1:" + server.getAddress().getPort() + "/cgi-bin/user/get");
        WecomContactTokenService tokenService = mock(WecomContactTokenService.class);
        when(tokenService.getAccessToken("bot-001")).thenReturn("token");
        WecomContactUserService service = new WecomContactUserService(new ObjectMapper(), properties, tokenService);

        WecomUserDetail detail = service.getUserDetail("bot-001", "zhangsan");

        assertThat(detail.getName()).isEqualTo("13800000000");
        assertThat(detail.getMobile()).isEqualTo("13800000000");
    }
}
