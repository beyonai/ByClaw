package com.iwhalecloud.byai.state.domain.resource.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class ResourceCurlServiceTest {

    private final ResourceCurlService service = new ResourceCurlService();

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
}
