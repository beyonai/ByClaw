package com.iwhalecloud.byai.state.domain.chat.service;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorAuthService;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ScriptServiceTest {

    private ConnectorAuthService connectorAuthService;
    private ScriptService service;

    @BeforeEach
    void setUp() {
        connectorAuthService = mock(ConnectorAuthService.class);
        service = new ScriptService();
        ReflectionTestUtils.setField(service, "connectorAuthService", connectorAuthService);

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(1001L);
        CurrentUserHolder.setLoginInfo(loginInfo);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void metadataIncludesEnabledConnectorCodesAsY() {
        when(connectorAuthService.findEnabledConnectorCodes(1001L))
            .thenReturn(List.of("dingtalk", "lark"));

        Map<String, Object> metadata = service.getMetadataByassistantChatDto(new AssistantChatDto());

        assertThat(metadata).containsEntry("authConnector", Map.of("dingtalk", "Y", "lark", "Y"));
    }
}
