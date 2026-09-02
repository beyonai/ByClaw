package com.iwhalecloud.byai.manager.application.service.devloop;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Map;
import java.util.List;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.domain.devloop.service.DwsAuthService;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorManifestCommandResolver;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ManifestCommandCatalog;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorInfoService;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;

class DevloopApplicationServiceDwsStatusTest {

    private DwsAuthService dwsAuthService;
    private DevloopApplicationService service;

    @BeforeEach
    void setUp() {
        dwsAuthService = mock(DwsAuthService.class);
        service = new DevloopApplicationService();
        ReflectionTestUtils.setField(service, "dwsAuthService", dwsAuthService);
        ConnectorInfoService connectorInfoService = mock(ConnectorInfoService.class);
        ConnectorManifestCommandResolver resolver = mock(ConnectorManifestCommandResolver.class);
        ConnectorInfo connector = new ConnectorInfo();
        ManifestCommandCatalog catalog = new ManifestCommandCatalog(
            Map.of("status", List.of(List.of("dws", "auth", "status", "--format", "json"))),
            "test-digest",
            Map.of()
        );
        when(connectorInfoService.findByCode("dingtalk")).thenReturn(connector);
        when(resolver.resolve(connector)).thenReturn(catalog);
        ReflectionTestUtils.setField(service, "connectorInfoService", connectorInfoService);
        ReflectionTestUtils.setField(service, "connectorManifestCommandResolver", resolver);

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(1001L);
        CurrentUserHolder.setLoginInfo(loginInfo);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void currentUserStatusReusesOneDwsRuntimeSnapshot() {
        List<String> statusCommand = List.of("dws", "auth", "status", "--format", "json");
        when(dwsAuthService.getAuthStatus(1001L, statusCommand)).thenReturn(Map.of(
            "authenticated", true,
            "tokenValid", true,
            "refreshTokenValid", true
        ));
        ResponseUtil<Map<String, Object>> response = service.checkDwsAuthStatus();

        assertThat(response.isSuccess()).isTrue();
        assertThat(response.getData())
            .containsEntry("runtimeAuthenticated", true)
            .containsEntry("hasToken", true)
            .containsEntry("savedAt", "");
        verify(dwsAuthService).getAuthStatus(1001L, statusCommand);
    }
}
