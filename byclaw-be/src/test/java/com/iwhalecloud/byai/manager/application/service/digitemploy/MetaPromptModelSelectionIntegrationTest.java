package com.iwhalecloud.byai.manager.application.service.digitemploy;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.feign.response.knowledge.ModelDto;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AIService;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AiModelService;
import com.iwhalecloud.byai.manager.domain.resource.service.ResourceAuthApplicationService;
import com.iwhalecloud.byai.manager.dto.digitemploy.MetaPromptGenerateRequest;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import com.sun.net.httpserver.HttpServer;
import java.io.ByteArrayOutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.util.ReflectionTestUtils;

class MetaPromptModelSelectionIntegrationTest {
    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void streamsWithAnExactInstanceOrALegacyModelCode(boolean explicitInstance) throws Exception {
        ObjectMapper json = new ObjectMapper();
        AtomicReference<String> requestBody = new AtomicReference<>();
        AtomicReference<String> authorization = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/selected/chat/completions", exchange -> {
            requestBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            String fields = json.writeValueAsString(Map.of(
                "agentDescription", "Generated description", "corePersonaDefinition", List.of()));
            String chunk = json.writeValueAsString(Map.of("choices", List.of(Map.of("delta", Map.of("content", fields)))));
            byte[] response = ("data: " + chunk + "\n\ndata: [DONE]\n\n").getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "text/event-stream");
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();
        try {
            String base = "http://127.0.0.1:" + server.getAddress().getPort();
            ModelDto other = model("other-id", base + "/anthropic", "wrong-test-token");
            other.setModelProtocol("Anthropic");
            ModelDto selected = model("selected-id", base + "/selected", "selected-test-token");
            AiModelService models = mock(AiModelService.class);
            // Redis hash 遍历顺序不能充当实例选择策略；另一协议的同编码实例排在最前。
            when(models.getModelList()).thenReturn(explicitInstance ? List.of(other, selected) : List.of(selected));
            when(models.getModel("selected-id")).thenReturn(selected);
            AIService ai = new AIService();
            ReflectionTestUtils.setField(ai, "aiModelService", models);
            var service = new MetaPromptService();
            var resources = mock(ResourceAuthApplicationService.class);
            PageInfo page = mock(PageInfo.class);
            when(page.getList()).thenReturn(List.of());
            when(resources.listResourceAuth(any())).thenReturn(page);
            ReflectionTestUtils.setField(service, "resourceAuthApplicationService", resources);
            ReflectionTestUtils.setField(service, "byaiSystemConfigService", mock(ByaiSystemConfigService.class));
            ReflectionTestUtils.setField(service, "aiService", ai);
            MetaPromptGenerateRequest request = new MetaPromptGenerateRequest();
            request.setModelId(explicitInstance ? "selected-id" : null);
            request.setModelCode(explicitInstance ? "Display name" : "shared-code");
            ByteArrayOutputStream output = new ByteArrayOutputStream();

            service.generateV3Stream(request, output);

            assertThat(output.toString(StandardCharsets.UTF_8))
                .contains("Generated description", "event: finalFields", "event: done").doesNotContain("event: error");
            assertThat(json.readTree(requestBody.get()).path("model").asText()).isEqualTo("shared-code");
            assertThat(authorization.get()).isEqualTo("Bearer selected-test-token");
            if (explicitInstance) {
                verify(models, never()).getModelList();
            } else {
                verify(models).getModelList();
                verify(models, never()).getModel(anyString());
            }
            verify(models, never()).getDefaultChatModel();
        } finally {
            server.stop(0);
        }
    }

    private ModelDto model(String id, String url, String token) {
        ModelDto model = new ModelDto();
        model.setInstanceId(id);
        model.setModelCode("shared-code");
        model.setAuthToken(token);
        model.setUrl(url);
        return model;
    }
}
