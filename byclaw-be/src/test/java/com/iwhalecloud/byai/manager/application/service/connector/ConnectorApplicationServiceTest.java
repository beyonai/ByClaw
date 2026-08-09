package com.iwhalecloud.byai.manager.application.service.connector;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorInfoService;
import com.iwhalecloud.byai.manager.qo.connector.ConnectorQo;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

class ConnectorApplicationServiceTest {

    private ConnectorInfoService connectorInfoService;
    private ConnectorApplicationService service;

    @BeforeEach
    void setUp() {
        connectorInfoService = mock(ConnectorInfoService.class);
        service = new ConnectorApplicationService();
        ReflectionTestUtils.setField(service, "connectorInfoService", connectorInfoService);

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(1001L);
        CurrentUserHolder.setLoginInfo(loginInfo);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void listAll_acceptsEmptyRequestAndPassesUserIdOutsideQueryObject() {
        service.listAll(null);

        verify(connectorInfoService).listAll(any(ConnectorQo.class), eq("1001"));
    }

    @Test
    void queryObjectDoesNotExposeUserIdFromTheRequestBoundary() {
        assertThat(ConnectorQo.class.getDeclaredFields())
            .noneMatch(field -> field.getName().equals("userId"));
    }
}
