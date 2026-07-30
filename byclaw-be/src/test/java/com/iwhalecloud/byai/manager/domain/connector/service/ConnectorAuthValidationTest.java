package com.iwhalecloud.byai.manager.domain.connector.service;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorAuth;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorAuthMapper;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorInfoMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Date;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ConnectorAuthValidationTest {

    private ConnectorAuthMapper connectorAuthMapper;
    private ConnectorInfoMapper connectorInfoMapper;
    private ConnectorAuthService service;

    @BeforeEach
    void setUp() {
        connectorAuthMapper = mock(ConnectorAuthMapper.class);
        connectorInfoMapper = mock(ConnectorInfoMapper.class);
        service = new ConnectorAuthService();
        ReflectionTestUtils.setField(service, "connectorAuthMapper", connectorAuthMapper);
        ReflectionTestUtils.setField(service, "connectorInfoMapper", connectorInfoMapper);

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(1001L);
        CurrentUserHolder.setLoginInfo(loginInfo);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void save_rejectsUnsupportedAuthMode() {
        ConnectorInfo info = connectorInfo("dingtalk", "OAUTH2");
        when(connectorInfoMapper.selectById(10L)).thenReturn(info);

        ConnectorAuth auth = auth(10L, "PASSWORD", "encrypted");

        assertThatThrownBy(() -> service.save(auth))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("authMode");
    }

    @Test
    void save_rejectsExpiredEnabledCredential() {
        ConnectorInfo info = connectorInfo("dingtalk", "OAUTH2");
        when(connectorInfoMapper.selectById(10L)).thenReturn(info);

        ConnectorAuth auth = auth(10L, "OAUTH2", "encrypted");
        auth.setEnableFlag("Y");
        auth.setExpireTime(new Date(System.currentTimeMillis() - 1000));

        assertThatThrownBy(() -> service.save(auth))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("expireTime");
    }

    @Test
    void save_resolvesAuthModeFromConnectorTemplate() {
        ConnectorInfo info = connectorInfo("dingtalk", "OAUTH2");
        when(connectorInfoMapper.selectById(10L)).thenReturn(info);

        ConnectorAuth auth = auth(10L, null, "encrypted");

        service.save(auth);

        org.mockito.Mockito.verify(connectorAuthMapper).insert(auth);
        org.assertj.core.api.Assertions.assertThat(auth.getAuthMode()).isEqualTo("OAUTH2");
        org.assertj.core.api.Assertions.assertThat(auth.getUserId()).isEqualTo("1001");
    }

    private ConnectorAuth auth(Long connectorId, String authMode, String credential) {
        ConnectorAuth auth = new ConnectorAuth();
        auth.setAuthId(20L);
        auth.setConnectorId(connectorId);
        auth.setAuthMode(authMode);
        auth.setAuthCredential(credential);
        return auth;
    }

    private ConnectorInfo connectorInfo(String code, String authMode) {
        ConnectorInfo info = new ConnectorInfo();
        info.setConnectorId(10L);
        info.setConnectorCode(code);
        info.setConnectorType("SYSTEM");
        info.setStatusCd("00A");
        info.setAuthMode(authMode);
        return info;
    }
}
