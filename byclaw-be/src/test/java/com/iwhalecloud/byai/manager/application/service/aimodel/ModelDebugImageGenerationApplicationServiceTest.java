package com.iwhalecloud.byai.manager.application.service.aimodel;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.web.ApplicationContextUtil;
import com.iwhalecloud.byai.manager.interfaces.controller.aimodel.ModelManagementController;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.context.support.StaticApplicationContext;
import org.springframework.context.support.StaticMessageSource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.bind.annotation.PostMapping;

class ModelDebugImageGenerationApplicationServiceTest {

    private static final String TEST_TOKEN = "test-token-not-a-secret";

    private final ObjectMapper objectMapper = new ObjectMapper();

    private final AtomicReference<String> requestMethod = new AtomicReference<>();

    private final AtomicReference<String> requestPath = new AtomicReference<>();

    private final AtomicReference<String> authorization = new AtomicReference<>();

    private final AtomicReference<String> requestBody = new AtomicReference<>();

    private HttpServer server;

    private int responseStatus;

    private String responseBody;

    private ModelDebugImageGenerationApplicationService service;

    private StaticApplicationContext applicationContext;

    @BeforeEach
    void setUp() throws IOException {
        LocaleContextHolder.setLocale(Locale.ENGLISH);
        applicationContext = new StaticApplicationContext();
        StaticMessageSource messageSource = applicationContext.getStaticMessageSource();
        messageSource.addMessage("aimodel.debug.rerank.input.required", Locale.ENGLISH, "Debug input is required");
        messageSource.addMessage("aimodel.debug.rerank.url.required", Locale.ENGLISH, "Request URL is required");
        messageSource.addMessage("aimodel.debug.upstream.error", Locale.ENGLISH, "Upstream API returned error");
        ReflectionTestUtils.setField(ApplicationContextUtil.class, "applicationContext", applicationContext);
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messageSource);
        responseStatus = 200;
        responseBody = successUrlResponse();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/image_generation", this::handleRequest);
        server.start();
        service = new ModelDebugImageGenerationApplicationService(objectMapper);
        ReflectionTestUtils.setField(service, "connectTimeoutMs", 1_000L);
        ReflectionTestUtils.setField(service, "readTimeoutMs", 1_000L);
    }

    @AfterEach
    void tearDown() {
        server.stop(0);
        LocaleContextHolder.resetLocaleContext();
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", null);
        ReflectionTestUtils.setField(ApplicationContextUtil.class, "applicationContext", null);
        applicationContext.close();
    }

    @Test
    void postsExactMiniMaxPayloadAndParsesUrlResponse() throws Exception {
        JsonNode result = service.startImageGenerationDebug(debugBody("url"));

        assertThat(requestMethod.get()).isEqualTo("POST");
        assertThat(requestPath.get()).isEqualTo("/v1/image_generation");
        assertThat(authorization.get()).isEqualTo("Bearer " + TEST_TOKEN);
        assertThat(objectMapper.readTree(requestBody.get())).isEqualTo(objectMapper.readTree("""
            {"model":"image-01","prompt":"draw a blue whale","aspect_ratio":"1:1","response_format":"url","n":1}
            """));
        assertThat(result.path("base_resp").path("status_code").asInt()).isZero();
        assertThat(result.path("data").path("image_urls").get(0).asText())
            .isEqualTo("https://example.test/a.png");
        assertThat(result.toString()).doesNotContain(TEST_TOKEN).doesNotContain("X-Upstream-Credential");
    }

    @Test
    void parsesBase64Response() {
        responseBody = """
            {"base_resp":{"status_code":0},"data":{"image_base64":["dGVzdC1pbWFnZQ=="]}}
            """;

        JsonNode result = service.startImageGenerationDebug(debugBody("base64"));

        assertThat(result.path("data").path("image_base64").get(0).asText()).isEqualTo("dGVzdC1pbWFnZQ==");
    }

    @Test
    void rejectsHttpUnauthorizedWithoutExposingBearerToken() {
        responseStatus = 401;
        responseBody = "{\"error\":\"invalid token\"}";

        assertThatThrownBy(() -> service.startImageGenerationDebug(debugBody("url")))
            .isInstanceOf(BaseException.class)
            .hasMessageNotContaining(TEST_TOKEN)
            .hasMessageNotContaining("Authorization");
    }

    @Test
    void rejectsMiniMaxBusinessErrorWithoutExposingBearerToken() {
        responseBody = """
            {"base_resp":{"status_code":1008,"status_msg":"invalid api key"},"data":{}}
            """;

        assertThatThrownBy(() -> service.startImageGenerationDebug(debugBody("url")))
            .isInstanceOf(BaseException.class)
            .hasMessageNotContaining(TEST_TOKEN)
            .hasMessageNotContaining("invalid api key");
    }

    @Test
    void rejectsUnsupportedProviderAndProtocolBeforeCallingUpstream() {
        Map<String, Object> input = validInput("url");
        input.put("providerName", "OTHER");
        input.put("modelProtocol", "OTHER_IMAGE");

        assertThatThrownBy(() -> service.startImageGenerationDebug(wrapInput(input)))
            .isInstanceOf(BaseException.class)
            .hasMessageNotContaining(TEST_TOKEN);
        assertThat(requestMethod.get()).isNull();
    }

    @Test
    void controllerRouteReturnsParsedResponseAndMarksModelEnabled() throws Exception {
        ModelManagementApplicationService managementService = mock(ModelManagementApplicationService.class);
        ModelDebugImageGenerationApplicationService debugService =
            mock(ModelDebugImageGenerationApplicationService.class);
        ModelManagementController controller = controller(managementService, debugService);
        Map<String, Object> body = Map.of("id", "42", "input", "{}");
        JsonNode upstream = objectMapper.readTree(successUrlResponse());
        when(managementService.parseModelIdFromBody(body)).thenReturn(42L);
        when(debugService.startImageGenerationDebug(body)).thenReturn(upstream);

        ResponseUtil<Object> response = controller.debugModelImageGeneration(body);

        PostMapping mapping = ModelManagementController.class
            .getDeclaredMethod("debugModelImageGeneration", Map.class).getAnnotation(PostMapping.class);
        assertThat(mapping.value()).containsExactly("/debugModelImageGeneration");
        assertThat(response.getData()).isSameAs(upstream);
        verify(managementService).updateModelStatusAfterDebug(42L, true);
    }

    @Test
    void controllerFailureReportsFailureToStatusHook() {
        ModelManagementApplicationService managementService = mock(ModelManagementApplicationService.class);
        ModelDebugImageGenerationApplicationService debugService =
            mock(ModelDebugImageGenerationApplicationService.class);
        ModelManagementController controller = controller(managementService, debugService);
        Map<String, Object> body = Map.of("id", "43", "input", "{}");
        BaseException failure = new BaseException(50010, "aimodel.debug.upstream.error");
        when(managementService.parseModelIdFromBody(body)).thenReturn(43L);
        when(debugService.startImageGenerationDebug(body)).thenThrow(failure);

        assertThatThrownBy(() -> controller.debugModelImageGeneration(body)).isSameAs(failure);
        verify(managementService).updateModelStatusAfterDebug(43L, false);
    }

    private ModelManagementController controller(ModelManagementApplicationService managementService,
        ModelDebugImageGenerationApplicationService debugService) {
        ModelManagementController controller = new ModelManagementController();
        ReflectionTestUtils.setField(controller, "modelManagementApplicationService", managementService);
        ReflectionTestUtils.setField(controller, "modelDebugImageGenerationApplicationService", debugService);
        return controller;
    }

    private Map<String, Object> debugBody(String responseFormat) {
        return wrapInput(validInput(responseFormat));
    }

    private Map<String, Object> wrapInput(Map<String, Object> input) {
        try {
            return Map.of("input", objectMapper.writeValueAsString(input));
        }
        catch (Exception e) {
            throw new AssertionError(e);
        }
    }

    private Map<String, Object> validInput(String responseFormat) {
        Map<String, Object> param = new LinkedHashMap<>();
        param.put("model", "image-01");
        param.put("prompt", "draw a blue whale");
        param.put("aspect_ratio", "1:1");
        param.put("response_format", responseFormat);
        param.put("n", 1);

        Map<String, Object> input = new LinkedHashMap<>();
        input.put("providerName", "MINIMAX");
        input.put("modelProtocol", "MINIMAX_IMAGE");
        input.put("url", "http://127.0.0.1:" + server.getAddress().getPort() + "/v1/image_generation");
        input.put("headers", Map.of("Authorization", "Bearer " + TEST_TOKEN));
        input.put("param", param);
        return input;
    }

    private void handleRequest(HttpExchange exchange) throws IOException {
        requestMethod.set(exchange.getRequestMethod());
        requestPath.set(exchange.getRequestURI().getPath());
        authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
        requestBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
        byte[] bytes = responseBody.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.getResponseHeaders().set("X-Upstream-Credential", "Bearer " + TEST_TOKEN);
        exchange.sendResponseHeaders(responseStatus, bytes.length);
        try (OutputStream outputStream = exchange.getResponseBody()) {
            outputStream.write(bytes);
        }
    }

    private String successUrlResponse() {
        return """
            {"base_resp":{"status_code":0},"data":{"image_urls":["https://example.test/a.png"]}}
            """;
    }

}
