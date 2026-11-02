package com.iwhalecloud.byai.manager.interfaces.controller.operations;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.domain.operations.OperationsAuthentication;
import com.iwhalecloud.byai.manager.domain.operations.PlatformOperationsService;
import com.iwhalecloud.byai.state.infrastructure.filter.AccessTokenVerifyInterceptor;
import com.iwhalecloud.byai.state.infrastructure.filter.WebMvcConfiguration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.mockito.ArgumentCaptor;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 使用生产消息转换器和服务认证复现资源桥 JsonNode 反序列化失败。
 * @author Codex
 * @since 2026-10-30
 */
class PlatformOperationsControllerTest {
    private static final String TEST_TOKEN = "test-only-resource-bridge-token-32-characters";

    private PlatformOperationsService platformOperationsService;

    private MockMvc mockMvc;

    /** 保留实际转换器顺序和认证入口，隔离资源服务及真实成员变更。 */
    @BeforeEach
    void prepare() {
        platformOperationsService = mock(PlatformOperationsService.class);
        PlatformOperationsController platformOperationsController = new PlatformOperationsController();
        OperationsAuthentication operationsAuthentication = new OperationsAuthentication();
        ReflectionTestUtils.setField(operationsAuthentication, "token", TEST_TOKEN);
        ReflectionTestUtils.setField(platformOperationsController, "authentication", operationsAuthentication);
        ReflectionTestUtils.setField(platformOperationsController, "service", platformOperationsService);
        AccessTokenVerifyInterceptor accessTokenVerifyInterceptor = new AccessTokenVerifyInterceptor();
        ReflectionTestUtils.setField(accessTokenVerifyInterceptor, "operationsAuthentication", operationsAuthentication);
        List<HttpMessageConverter<?>> messageConverters = new ArrayList<>();
        new WebMvcConfiguration().extendMessageConverters(messageConverters);
        mockMvc = MockMvcBuilders.standaloneSetup(platformOperationsController)
            .setMessageConverters(messageConverters.toArray(HttpMessageConverter<?>[]::new))
            .addInterceptors(accessTokenVerifyInterceptor)
            .build();
    }

    /** 请求中的 Jackson 树必须可解析，响应保留数值、布尔、字符串及数组协议。 */
    @Test
    void previewUsesJacksonForBothRequestAndResponse() throws Exception {
        ObjectMapper objectMapper = new ObjectMapper();
        JsonNode plan = objectMapper.readTree("{\"revision\":\"" + "a".repeat(64)
            + "\",\"groupCount\":0,\"transfers\":[],\"completed\":false}");
        when(platformOperationsService.execute(any(JsonNode.class))).thenReturn(plan);
        mockMvc.perform(post(OperationsAuthentication.PATH)
            .servletPath(OperationsAuthentication.PATH)
            .header(OperationsAuthentication.HEADER, TEST_TOKEN)
            .contentType("application/json")
            .content(previewBody()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.code").value(0))
            .andExpect(jsonPath("$.code").isNumber())
            .andExpect(jsonPath("$.data.groupCount").isNumber())
            .andExpect(jsonPath("$.data.completed").isBoolean())
            .andExpect(jsonPath("$.data.transfers").isArray());
        ArgumentCaptor<JsonNode> requestBody = ArgumentCaptor.forClass(JsonNode.class);
        verify(platformOperationsService).execute(requestBody.capture());
        assertThat(requestBody.getValue().path("payload").path("enterpriseId").asText()).isEqualTo("42");
        assertThat(requestBody.getValue().path("operation").asText()).isEqualTo("preview");
    }

    /** 运营页面共用资源桥；使用生产转换器验证请求可读及数组、分页响应不被改写。 */
    @ParameterizedTest
    @MethodSource("resourceReadOperations")
    void resourceReadsPreserveJsonContract(String resource, String operation, String payload, String result)
            throws Exception {
        ObjectMapper objectMapper = new ObjectMapper();
        JsonNode expectedResult = objectMapper.readTree(result);
        when(platformOperationsService.execute(any(JsonNode.class))).thenReturn(expectedResult);
        JsonNode bridgeBody = objectMapper.createObjectNode()
            .put("resource", resource)
            .put("operation", operation)
            .put("actor", "7")
            .put("requestId", "resource-read-contract")
            .set("payload", objectMapper.readTree(payload));

        String responseBody = mockMvc.perform(post(OperationsAuthentication.PATH)
            .servletPath(OperationsAuthentication.PATH)
            .header(OperationsAuthentication.HEADER, TEST_TOKEN)
            .contentType("application/json")
            .content(bridgeBody.toString()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.code").isNumber())
            .andExpect(jsonPath("$.code").value(0))
            .andReturn().getResponse().getContentAsString();

        // 对完整树比较，防止大整数 ID、null、布尔或分页数字被转换器悄悄改写。
        assertThat(objectMapper.readTree(responseBody).path("data")).isEqualTo(expectedResult);
        ArgumentCaptor<JsonNode> requestBody = ArgumentCaptor.forClass(JsonNode.class);
        verify(platformOperationsService).execute(requestBody.capture());
        assertThat(requestBody.getValue()).isEqualTo(bridgeBody);
    }

    /** @return 租户、数据源、工作组及沙箱读取的真实 JSON 形状，不触及数据库或 Node */
    private static Stream<Arguments> resourceReadOperations() {
        String datasourcePayload = "{\"enterpriseId\":\"9007199254740993\",\"schema\":\"public\","
            + "\"table\":\"users\",\"page\":1}";
        String queryResult = "{\"columns\":[{\"name\":\"id\",\"type\":\"int8\"}],"
            + "\"rows\":[[\"9007199254740993\"],[null]],\"affectedRows\":0,\"page\":1,"
            + "\"pageSize\":100,\"hasNextPage\":false,\"truncated\":false}";
        return Stream.of(
            Arguments.of("tenant-admin", "list", "{\"sortField\":\"createdAt\",\"sortOrder\":\"desc\"}",
                "[{\"enterpriseId\":\"9007199254740993\",\"provisionState\":\"READY\",\"failureReason\":null}]"),
            Arguments.of("tenant-admin", "packages", "{}",
                "[{\"id\":\"9007199254740993\",\"packageName\":\"Standard\"}]"),
            Arguments.of("tenant-datasource", "tables", "{\"enterpriseId\":\"9007199254740993\"}",
                "[{\"schema\":\"public\",\"name\":\"users\",\"type\":\"TABLE\"}]"),
            Arguments.of("tenant-datasource", "browse", datasourcePayload, queryResult),
            Arguments.of("tenant-datasource", "execute",
                "{\"enterpriseId\":\"9007199254740993\",\"sql\":\"SELECT id FROM users\",\"page\":1,\"confirmed\":false}",
                queryResult),
            Arguments.of("groups", "list", "{\"enterpriseId\":\"11393304\",\"pageNum\":1,\"pageSize\":20}",
                "{\"list\":[{\"id\":\"9007199254740993\",\"enterpriseId\":\"11393304\","
                    + "\"memberCount\":2,\"agentCount\":0,\"projectId\":null}],"
                    + "\"total\":1,\"pageNum\":1,\"pageSize\":20,\"totalPages\":1}"),
            Arguments.of("sandboxes", "list", "{\"pageNum\":1,\"pageSize\":20,\"enterpriseId\":null}",
                "{\"list\":[{\"id\":\"9007199254740993\",\"enterpriseId\":null,\"ownerScope\":\"USER\","
                    + "\"status\":\"RUNNING\",\"runtimeStatus\":\"UNKNOWN\",\"canStart\":false,\"canRelease\":true}],"
                    + "\"total\":1,\"pageNum\":1,\"pageSize\":20,\"totalPages\":1}"));
    }

    /** 选择 Jackson 只改变序列化，不能让浏览器绕过资源桥独立令牌。 */
    @Test
    void missingServiceTokenRemainsUnauthorized() throws Exception {
        mockMvc.perform(post(OperationsAuthentication.PATH)
            .servletPath(OperationsAuthentication.PATH)
            .contentType("application/json")
            .content(previewBody()))
            .andExpect(status().isUnauthorized());
        verifyNoInteractions(platformOperationsService);
    }

    /** @return 不含真实账号或令牌的只读预检请求 */
    private String previewBody() {
        return "{\"resource\":\"member-removal\",\"operation\":\"preview\",\"actor\":\"7\","
            + "\"requestId\":\"test-preview\",\"payload\":{\"enterpriseId\":\"42\",\"userId\":\"9\"}}";
    }
}
