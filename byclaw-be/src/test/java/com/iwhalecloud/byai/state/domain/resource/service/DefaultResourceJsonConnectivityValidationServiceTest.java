package com.iwhalecloud.byai.state.domain.resource.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
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

    @Test
    void validate_whenKnowledgeCreateSucceeds_deletesSameTemporaryKnowledgeIdentity() {
        ReflectionTestUtils.setField(service, "failFast", true);
        ResourceCurlRunResult success = new ResourceCurlRunResult();
        success.setSuccess(true);
        when(resourceCurlService.runOpenApiOperation(eq("KG_DOC"), eq(knowledgeJson()),
            org.mockito.ArgumentMatchers.any(JSONObject.class), org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.anySet(), org.mockito.ArgumentMatchers.anyMap(),
            org.mockito.ArgumentMatchers.anyMap())).thenReturn(success);

        assertThatCode(() -> service.validate(context("KG_DOC", "/resource/doc/KG_DOC_1.json", knowledgeJson())))
            .doesNotThrowAnyException();

        ArgumentCaptor<Map<String, Object>> bodyCaptor = ArgumentCaptor.forClass(Map.class);
        verify(resourceCurlService, org.mockito.Mockito.times(2)).runOpenApiOperation(eq("KG_DOC"), eq(knowledgeJson()),
            org.mockito.ArgumentMatchers.any(JSONObject.class), org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.anySet(), bodyCaptor.capture(), org.mockito.ArgumentMatchers.anyMap());
        assertThat(bodyCaptor.getAllValues()).hasSize(2);
        assertThat(bodyCaptor.getAllValues().get(1)).isSameAs(bodyCaptor.getAllValues().get(0));
        assertThat(bodyCaptor.getAllValues().get(0).get("knCode")).isEqualTo(bodyCaptor.getAllValues().get(1)
            .get("knCode"));
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
}
