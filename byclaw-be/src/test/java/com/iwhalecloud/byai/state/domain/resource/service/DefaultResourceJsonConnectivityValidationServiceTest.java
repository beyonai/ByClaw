package com.iwhalecloud.byai.state.domain.resource.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.storage.validation.ResourceJsonPath;
import com.iwhalecloud.byai.common.storage.validation.ResourceJsonValidationContext;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtMcpService;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceCurlRunResult;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.mockito.ArgumentCaptor;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.context.MessageSource;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.context.support.StaticMessageSource;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Locale;
import java.util.Map;

class DefaultResourceJsonConnectivityValidationServiceTest {

    private ResourceCurlService resourceCurlService;

    private SsResExtMcpService ssResExtMcpService;

    private DefaultResourceJsonConnectivityValidationService service;

    private MessageSource originalMessageSource;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @BeforeEach
    void setUp() {
        originalMessageSource = (MessageSource) ReflectionTestUtils.getField(I18nUtil.class, "messageSource");
        StaticMessageSource messageSource = new StaticMessageSource();
        addMessage(messageSource, "resource.json.connectivity.validation.prefix", "资源元数据json写minio校验：");
        addMessage(messageSource, "resource.json.connectivity.validation.failed.path", "资源JSON连通性校验失败: {0}");
        addMessage(messageSource, "resource.json.connectivity.validation.failed.allowed",
            "资源JSON连通性校验失败，已按配置放行");
        addMessage(messageSource, "resource.json.connectivity.validation.unknown", "未知错误");
        addMessage(messageSource, "resource.json.connectivity.validation.toolkit.interface", "Toolkit工具接口");
        addMessage(messageSource, "resource.json.connectivity.validation.knowledge.create.interface", "知识库创建接口");
        addMessage(messageSource, "resource.json.connectivity.validation.knowledge.delete.interface", "知识库删除接口");
        addMessage(messageSource, "resource.json.connectivity.validation.knowledge.operation.notfound", "未找到知识库校验接口: {0}");
        addMessage(messageSource, "resource.json.connectivity.validation.interface.failed", "{0}失败: {1}");
        addMessage(messageSource, "resource.json.connectivity.validation.http.status", "HTTP状态: {0}");
        addMessage(messageSource, "resource.json.connectivity.validation.result.empty", "没有返回校验结果");
        addMessage(messageSource, "resource.json.connectivity.validation.knowledge.resource.service.missing", "缺少resourceService");
        addMessage(messageSource, "resource.json.connectivity.validation.knowledge.openapi.paths.missing", "接口{0}缺少paths");
        addMessage(messageSource, "resource.json.connectivity.validation.knowledge.operations.missing", "缺少有效的知识接口");
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messageSource);
        LocaleContextHolder.setLocale(Locale.SIMPLIFIED_CHINESE);

        resourceCurlService = mock(ResourceCurlService.class);
        ssResExtMcpService = mock(SsResExtMcpService.class);
        service = new DefaultResourceJsonConnectivityValidationService(resourceCurlService, ssResExtMcpService);
        ReflectionTestUtils.setField(service, "enabled", true);
    }

    @AfterEach
    void tearDown() {
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", originalMessageSource);
        LocaleContextHolder.resetLocaleContext();
    }

    @Test
    void validate_whenFailFastEnabled_rethrowsValidationFailure() {
        ReflectionTestUtils.setField(service, "failFast", true);
        doThrow(new IllegalArgumentException("toolkit unavailable"))
            .when(resourceCurlService).runValidationToolkitTool("{}");

        assertThatThrownBy(() -> service.validate(context("TOOLKIT", "/resource/toolkit/TOOLKIT_1.json")))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("资源元数据json写minio校验：toolkit unavailable");
    }

    @Test
    void validate_whenFailFastDisabled_logsAndAllowsWrite() {
        ReflectionTestUtils.setField(service, "failFast", false);
        doThrow(new IllegalArgumentException("toolkit unavailable"))
            .when(resourceCurlService).runValidationToolkitTool("{}");

        assertThatCode(() -> service.validate(context("TOOLKIT", "/resource/toolkit/TOOLKIT_1.json")))
            .doesNotThrowAnyException();
    }

    @ParameterizedTest
    @CsvSource({"false, false", "true, false", "true, true"})
    void validate_whenKnowledgeCreateSucceeds_deletesSameTemporaryKnowledgeIdentity(boolean separateServices, boolean pathOnly) {
        ReflectionTestUtils.setField(service, "failFast", true);
        JSONObject root = JSONObject.parseObject(knowledgeJson());
        var services = root.getJSONArray("resourceService");
        JSONObject paths = services.getJSONObject(0).getJSONObject("openapiSchema").getJSONObject("paths");
        if (pathOnly) paths.values().forEach(item -> ((JSONObject) item).getJSONObject("post").remove("operationId"));
        if (separateServices) {
            JSONObject deleteSchema = new JSONObject();
            deleteSchema.put("paths", Map.of("/knowledge-bases/delete", paths.remove("/knowledge-bases/delete")));
            services.add(Map.of("openapiSchema", deleteSchema));
        }
        String json = root.toJSONString();
        ResourceCurlRunResult success = new ResourceCurlRunResult();
        success.setSuccess(true);
        when(resourceCurlService.runOpenApiOperation(eq("KG_DOC"), eq(json),
            org.mockito.ArgumentMatchers.any(JSONObject.class), org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.anySet(), org.mockito.ArgumentMatchers.anyMap(),
            org.mockito.ArgumentMatchers.anyMap())).thenReturn(success);

        assertThatCode(() -> service.validate(context("KG_DOC", "/resource/doc/KG_DOC_1.json", json)))
            .doesNotThrowAnyException();

        ArgumentCaptor<Map<String, Object>> bodyCaptor = ArgumentCaptor.forClass(Map.class);
        verify(resourceCurlService, org.mockito.Mockito.times(2)).runOpenApiOperation(eq("KG_DOC"), eq(json),
            org.mockito.ArgumentMatchers.any(JSONObject.class), org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.anySet(), bodyCaptor.capture(), org.mockito.ArgumentMatchers.anyMap());
        assertThat(bodyCaptor.getAllValues()).hasSize(2);
        assertThat(bodyCaptor.getAllValues().get(1)).isSameAs(bodyCaptor.getAllValues().get(0));
        assertThat(bodyCaptor.getAllValues().get(0).get("knCode")).isEqualTo(bodyCaptor.getAllValues().get(1)
            .get("knCode"));
    }

    @Test
    void validate_whenLegacyLifecycleSucceeds_deletesSameTemporaryKnowledgeIdentity() {
        ReflectionTestUtils.setField(service, "failFast", true);
        String json = knowledgeJson(true, true, true);
        ResourceCurlRunResult success = new ResourceCurlRunResult();
        success.setSuccess(true);
        when(resourceCurlService.runSimpleJsonOperation(eq("KG_DOC"), eq(json), eq("POST"),
            org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyMap(),
            org.mockito.ArgumentMatchers.anyMap())).thenReturn(success);

        service.validate(context("KG_DOC", "/resource/doc/KG_DOC_1.json", json));

        ArgumentCaptor<String> urlCaptor = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Map<String, Object>> bodyCaptor = ArgumentCaptor.forClass(Map.class);
        verify(resourceCurlService, org.mockito.Mockito.times(2)).runSimpleJsonOperation(eq("KG_DOC"), eq(json),
            eq("POST"), urlCaptor.capture(), bodyCaptor.capture(), org.mockito.ArgumentMatchers.anyMap());
        assertThat(urlCaptor.getAllValues()).containsExactly("http://example.com/create_kb", "http://example.com/delete_kb");
        assertThat(bodyCaptor.getAllValues().get(1)).isSameAs(bodyCaptor.getAllValues().get(0));
        assertThat((String) bodyCaptor.getValue().get("knCode")).startsWith("VALIDATE_1_");
    }

    @ParameterizedTest
    @CsvSource({"KG_DOC, false", "KG_DB, false", "KG_QA, false", "KG_TERM, false",
        "KG_DOC, true", "KG_DB, true", "KG_QA, true", "KG_TERM, true"})
    void validate_whenExternalKnowledgeHasNoLifecycle_allowsSchemasWithoutCallingAnyEndpoint(String type, boolean legacy) {
        ReflectionTestUtils.setField(service, "failFast", true);
        JSONObject root = JSONObject.parseObject(knowledgeJson(false, false, legacy));
        root.put("resourceBizType", type);

        assertThatCode(() -> service.validate(context(type, "/resource/doc/" + type + "_1.json", root.toJSONString())))
            .doesNotThrowAnyException();

        verifyNoInteractions(resourceCurlService, ssResExtMcpService);
    }

    @ParameterizedTest
    @CsvSource({"true, false, false, delete_kb", "false, true, false, create_kb",
        "true, false, true, delete_kb", "false, true, true, create_kb"})
    void validate_whenLifecycleIsIncomplete_failsBeforeAnyExternalCall(boolean create, boolean delete, boolean legacy,
        String missingOperation) {
        ReflectionTestUtils.setField(service, "failFast", true);
        String json = knowledgeJson(create, delete, legacy);

        assertThatThrownBy(() -> service.validate(context("KG_DOC", "/resource/doc/KG_DOC_1.json", json)))
            .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("未找到知识库校验接口: " + missingOperation);

        verifyNoInteractions(resourceCurlService, ssResExtMcpService);
    }

    @Test
    void validate_whenLifecycleIsIncompleteAndFailFastDisabled_allowsWriteWithoutExternalCalls() {
        ReflectionTestUtils.setField(service, "failFast", false);
        String json = knowledgeJson(true, false, false);

        assertThatCode(() -> service.validate(context("KG_DOC", "/resource/doc/KG_DOC_1.json", json)))
            .doesNotThrowAnyException();

        verifyNoInteractions(resourceCurlService, ssResExtMcpService);
    }

    @ParameterizedTest
    @ValueSource(strings = {"{}", "{\"resourceService\":[]}", "{\"resourceService\":[null]}",
        "{\"resourceService\":[{}]}", "{\"resourceService\":[{\"openapiSchema\":{}}]}",
        "{\"resourceService\":[{\"openapiSchema\":{\"paths\":{}}}]}",
        "{\"resourceService\":[{\"openapiSchema\":{\"paths\":{\"/search\":{}}}}]}",
        "{\"resourceService\":[{\"openapiSchema\":{\"paths\":{\"/search\":{\"post\":null}}}}]}",
        "{\"resourceService\":[{\"path\":\"/search\",\"method\":\"UNKNOWN\"}]}"})
    void validate_whenNoLifecycleDoesNotMeanValidMetadata_rejectsInvalidSchemas(String json) {
        ReflectionTestUtils.setField(service, "failFast", true);

        assertThatThrownBy(() -> service.validate(context("KG_DOC", "/resource/doc/KG_DOC_1.json", json)))
            .isInstanceOf(IllegalArgumentException.class);

        verifyNoInteractions(resourceCurlService, ssResExtMcpService);
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void validate_whenDeclaredLifecycleFails_doesNotFallBackToSchemaOnly(boolean creationFails) {
        ReflectionTestUtils.setField(service, "failFast", true);
        String json = knowledgeJson();
        ResourceCurlRunResult success = new ResourceCurlRunResult();
        success.setSuccess(true);
        ResourceCurlRunResult failure = new ResourceCurlRunResult();
        failure.setSuccess(false);
        failure.setErrorMessage("lifecycle unavailable");
        when(resourceCurlService.runOpenApiOperation(eq("KG_DOC"), eq(json),
            org.mockito.ArgumentMatchers.any(JSONObject.class), org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.anySet(), org.mockito.ArgumentMatchers.anyMap(),
            org.mockito.ArgumentMatchers.anyMap())).thenReturn(creationFails ? failure : success, failure);

        assertThatThrownBy(() -> service.validate(context("KG_DOC", "/resource/doc/KG_DOC_1.json", json)))
            .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("lifecycle unavailable");

        ArgumentCaptor<String> operationCaptor = ArgumentCaptor.forClass(String.class);
        verify(resourceCurlService, org.mockito.Mockito.times(creationFails ? 1 : 2)).runOpenApiOperation(eq("KG_DOC"),
            eq(json), org.mockito.ArgumentMatchers.any(JSONObject.class), operationCaptor.capture(),
            org.mockito.ArgumentMatchers.anySet(), org.mockito.ArgumentMatchers.anyMap(), org.mockito.ArgumentMatchers.anyMap());
        assertThat(operationCaptor.getAllValues()).containsExactly(creationFails
            ? new String[] {"create_kb"} : new String[] {"create_kb", "delete_kb"});
    }

    @Test
    void validate_whenInternalDatasetHasNoKnowledgeLifecycleOperations_skipsConnectivityValidation() {
        ReflectionTestUtils.setField(service, "failFast", true);

        String json = """
            {
              "systemCode": "dataset",
              "resourceBizType": "KG_DOC",
              "resourceService": [
                {
                  "openapiSchema": {
                    "paths": {
                      "/api/v1/listDir": {
                        "post": {
                          "operationId": "listDir"
                        }
                      }
                    }
                  }
                }
              ]
            }
            """;

        assertThatCode(() -> service.validate(context("KG_DOC", "/resource/doc/KG_DOC_2.json", json)))
            .doesNotThrowAnyException();

        verify(resourceCurlService, org.mockito.Mockito.never()).runOpenApiOperation(
            org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.any(JSONObject.class), org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.anySet(), org.mockito.ArgumentMatchers.anyMap(),
            org.mockito.ArgumentMatchers.anyMap());
    }

    @Test
    void validate_whenByclawCodeAgent_skipsAgentHealthValidation() throws Exception {
        ReflectionTestUtils.setField(service, "failFast", true);
        String json = """
            {
              "resourceBizType": "AGENT",
              "systemCode": "BYCLAW_CODE"
            }
            """;

        assertThatCode(() -> service.validate(context("AGENT", "/resource/agent/AGENT_1.json", json)))
            .doesNotThrowAnyException();

        verify(resourceCurlService, org.mockito.Mockito.never()).runAgentHealth(org.mockito.ArgumentMatchers.anyString());
    }

    private ResourceJsonValidationContext context(String resourceBizType, String targetPath) {
        return context(resourceBizType, targetPath, "{}");
    }

    private ResourceJsonValidationContext context(String resourceBizType, String targetPath, String json) {
        ResourceJsonPath path = new ResourceJsonPath(targetPath, resourceBizType.toLowerCase(), resourceBizType, 1L);
        try {
            return new ResourceJsonValidationContext(path, json, objectMapper.readTree(json));
        }
        catch (Exception e) {
            throw new IllegalArgumentException(e);
        }
    }

    private void addMessage(StaticMessageSource messageSource, String key, String message) {
        messageSource.addMessage(key, Locale.SIMPLIFIED_CHINESE, message);
    }

    private String knowledgeJson() {
        return """
            {
              "resourceBizType": "KG_DOC",
              "domainURL": "http://example.com",
              "resourceService": [
                {
                  "openapiSchema": {
                    "paths": {
                      "/knowledge-bases/create": {
                        "post": {
                          "operationId": "create_kb",
                          "requestBody": {
                            "content": {
                              "application/json": {
                                "schema": {
                                  "type": "object",
                                  "properties": {
                                    "knCode": { "type": "string" },
                                    "knName": { "type": "string" }
                                  }
                                }
                              }
                            }
                          }
                        }
                      },
                      "/knowledge-bases/delete": {
                        "post": {
                          "operationId": "delete_kb",
                          "requestBody": {
                            "content": {
                              "application/json": {
                                "schema": {
                                  "type": "object",
                                  "properties": {
                                    "knCode": { "type": "string" }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              ]
            }
            """;
    }

    private String knowledgeJson(boolean create, boolean delete, boolean legacy) {
        JSONObject root = JSONObject.parseObject(knowledgeJson());
        root.put("systemCode", "WHALE");
        var services = root.getJSONArray("resourceService");
        if (legacy) {
            services.clear();
            services.add(JSONObject.parseObject("{\"method\":\"POST\",\"path\":\"/search\",\"action\":\"search\"}"));
            for (String operation : new String[] {"create_kb", "delete_kb"}) {
                if (operation.equals("create_kb") ? create : delete) {
                    JSONObject service = new JSONObject();
                    service.put("method", "POST");
                    service.put("path", "/" + operation);
                    service.put("action", operation);
                    services.add(service);
                }
            }
        }
        else {
            JSONObject paths = services.getJSONObject(0).getJSONObject("openapiSchema").getJSONObject("paths");
            paths.put("/search", JSONObject.parseObject("{\"post\":{\"operationId\":\"search\"}}"));
            if (!create) paths.remove("/knowledge-bases/create");
            if (!delete) paths.remove("/knowledge-bases/delete");
        }
        return root.toJSONString();
    }
}
