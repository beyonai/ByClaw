package com.iwhalecloud.byai.manager.interfaces.controller.auth;

import static org.assertj.core.api.Assertions.assertThat;

import com.iwhalecloud.byai.manager.domain.resource.request.ResourceUseAuthQo;
import java.util.List;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.util.ReflectionTestUtils;

class AuthControllerResourceScopeTest {

    @ParameterizedTest
    @ValueSource(strings = {"SKILL", "KG_DOC", "KG_QA", "KG_TERM", "MCP", "TOOLKIT", "AGENT"})
    void availableEnterpriseFilterRetainsUsePermissionScope(String bizType) {
        ResourceUseAuthQo request = request(bizType);
        request.setAvailableOnly(true);
        // 服务端覆盖旧值，避免企业归属筛选绕过 SQL 中的创建人/使用授权条件。
        request.setIncludeAllEnterpriseOwnerType(true);
        ReflectionTestUtils.invokeMethod(new AuthController(), "enrichResourceListScope", request);
        assertThat(request.getOwnerType()).isEqualTo("enterprise");
        assertThat(request.getIncludeAllEnterpriseOwnerType()).isFalse();
    }

    @ParameterizedTest
    @ValueSource(strings = {"SKILL", "KG_DOC", "MCP"})
    void officialEnterpriseScopeRemainsUnchanged(String bizType) {
        ResourceUseAuthQo request = request(bizType);
        ReflectionTestUtils.invokeMethod(new AuthController(), "enrichResourceListScope", request);
        assertThat(request.getIncludeAllEnterpriseOwnerType()).isTrue();
    }

    private ResourceUseAuthQo request(String bizType) {
        ResourceUseAuthQo request = new ResourceUseAuthQo();
        request.setOwnerType("enterprise");
        request.setResourceBizTypeList(List.of(bizType));
        return request;
    }
}
