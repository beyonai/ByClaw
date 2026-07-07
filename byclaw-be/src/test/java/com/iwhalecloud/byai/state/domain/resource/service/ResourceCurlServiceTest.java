package com.iwhalecloud.byai.state.domain.resource.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

class ResourceCurlServiceTest {

    private final ResourceCurlService service = new ResourceCurlService();

    @AfterEach
    void tearDown() {
        RequestContextHolder.resetRequestAttributes();
        ReflectionTestUtils.setField(service, "host", "");
    }

    @Test
    void tryBuildConnectivityValidationCurlByRule_whenToolkitUsesSimpleResourceService_buildsCurl() {
        String curl = ReflectionTestUtils.invokeMethod(service, "tryBuildConnectivityValidationCurlByRule",
            simpleToolkitJson());

        assertThat(curl)
            .contains("curl -X POST 'http://10.10.168.203:8080/byaiService/open/api/v1/queryDigEmployeeList'")
            .contains("-H 'Content-Type: application/json'")
            .contains("-d '{\"agentType\":\"\",\"resourceName\":\"\"}'");
    }

    @Test
    void tryBuildConnectivityValidationCurlByRule_whenSimpleResourceServiceHasWriteFirst_prefersReadOnlyService() {
        String curl = ReflectionTestUtils.invokeMethod(service, "tryBuildConnectivityValidationCurlByRule",
            toolkitJsonWithWriteFirst());

        assertThat(curl)
            .contains("curl -X POST 'http://example.com/api/listResources'")
            .doesNotContain("/api/deleteResource");
    }

    @Test
    void tryBuildConnectivityValidationCurlByRule_whenToolkitUsesPluginMachineInfo_readsOpenApi() {
        String curl = ReflectionTestUtils.invokeMethod(service, "tryBuildConnectivityValidationCurlByRule",
            pluginMachineToolkitJsonWithReadOperation());

        assertThat(curl)
            .contains("curl -X GET 'http://example.com/api/by/customer/list'")
            .doesNotContain("/api/by/customer/add");
    }

    @Test
    void tryBuildConnectivityValidationCurlByRule_whenToolkitOnlyHasWriteOperation_doesNotBuildUnsafeCurl() {
        String curl = ReflectionTestUtils.invokeMethod(service, "tryBuildConnectivityValidationCurlByRule",
            pluginMachineToolkitJsonWithOnlyWriteOperation());

        assertThat(curl).isNull();
    }

    @Test
    void resolveTemplatePlaceholders_whenEnvHostExists_usesEnvHostWithoutPort() {
        ReflectionTestUtils.setField(service, "host", "10.10.168.203:8080");

        String curl = ReflectionTestUtils.invokeMethod(service, "resolveTemplatePlaceholders",
            "curl -X GET 'http://${HOST}:8999/api/by/customer/list'");

        assertThat(curl).contains("http://10.10.168.203:8999/api/by/customer/list");
    }

    @Test
    void resolveTemplatePlaceholders_whenNoConfiguredHost_usesForwardedHostWithoutPort() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("X-Forwarded-Host", "10.10.168.204:8080");
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));

        String curl = ReflectionTestUtils.invokeMethod(service, "resolveTemplatePlaceholders",
            "curl -X GET 'http://${HOST}:8999/api/by/customer/list'");

        assertThat(curl).contains("http://10.10.168.204:8999/api/by/customer/list");
    }

    private String simpleToolkitJson() {
        return """
            {
              "systemCode": "BYAI",
              "resourceCode": "dig_employee_toolkit_max",
              "resourceName": "查询数字员工（平台级）y",
              "resourceDesc": "用于查询数字员工",
              "resourceBizType": "TOOLKIT",
              "version": "1.0.0",
              "implType": "API",
              "domainName": "查询数字员工",
              "domainURL": "http://10.10.168.203:8080",
              "resourceService": [
                {
                  "serviceCode": "query_dig_employee",
                  "serviceName": "查询 Dig 员工列表",
                  "serviceDesc": "POST 接口，用于根据 agentType 查询员工信息。",
                  "method": "POST",
                  "path": "/byaiService/open/api/v1/queryDigEmployeeList",
                  "headers": [
                    {
                      "name": "Content-Type",
                      "value": "application/json",
                      "required": true
                    }
                  ],
                  "queryParams": [],
                  "bodyParams": [
                    {
                      "name": "agentType",
                      "type": "string",
                      "required": true,
                      "description": "代理类型代码"
                    },
                    {
                      "name": "resourceName",
                      "type": "string",
                      "required": true,
                      "description": "资源名称"
                    }
                  ]
                }
              ]
            }
            """;
    }

    private String toolkitJsonWithWriteFirst() {
        return """
            {
              "resourceBizType": "TOOLKIT",
              "domainURL": "http://example.com",
              "resourceService": [
                {
                  "serviceCode": "delete_resource",
                  "serviceName": "删除资源",
                  "method": "POST",
                  "path": "/api/deleteResource"
                },
                {
                  "serviceCode": "list_resources",
                  "serviceName": "查询资源列表",
                  "method": "POST",
                  "path": "/api/listResources"
                }
              ]
            }
            """;
    }

    private String pluginMachineToolkitJsonWithReadOperation() {
        return """
            {
              "resourceBizType": "TOOLKIT",
              "pluginMachineInfo": [
                {
                  "pluginMachineOpenAPI": {
                    "servers": [
                      {
                        "url": "http://example.com"
                      }
                    ],
                    "paths": {
                      "/api/by/customer/add": {
                        "post": {
                          "operationId": "customer_add",
                          "summary": "新增客户"
                        }
                      },
                      "/api/by/customer/list": {
                        "get": {
                          "operationId": "customer_list",
                          "summary": "查询客户列表"
                        }
                      }
                    }
                  }
                }
              ]
            }
            """;
    }

    private String pluginMachineToolkitJsonWithOnlyWriteOperation() {
        return """
            {
              "resourceBizType": "TOOLKIT",
              "pluginMachineInfo": [
                {
                  "pluginMachineOpenAPI": {
                    "servers": [
                      {
                        "url": "http://${HOST}:8999"
                      }
                    ],
                    "paths": {
                      "/api/by/customer/add": {
                        "post": {
                          "operationId": "BY_API_CUSTOMER_ADD_50C7E",
                          "summary": "新增客户",
                          "description": "新增一条客户记录"
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
