package com.iwhalecloud.byai.manager.domain.connector.service;

import com.iwhalecloud.byai.manager.dto.connector.ConnectorAuthorizationDto;
import com.iwhalecloud.byai.manager.dto.connector.StartConnectorAuthorizationRequest;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.domain.devloop.service.DwsAuthService;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorAuthMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ConnectorAuthorizationServiceTest {

    private final ConnectorInfoService connectorInfoService = mock(ConnectorInfoService.class);
    private final DwsAuthService dwsAuthService = mock(DwsAuthService.class);
    private final ConnectorAuthMapper connectorAuthMapper = mock(ConnectorAuthMapper.class);
    private final SequenceService sequenceService = mock(SequenceService.class);
    private final ConnectorAuthorizationService service = new ConnectorAuthorizationService(
        connectorInfoService,
        dwsAuthService,
        connectorAuthMapper,
        sequenceService
    );

    @Test
    void startDingtalkAuthorizationDelegatesToDwsDeviceFlow() {
        ConnectorInfo connector = new ConnectorInfo();
        connector.setConnectorId(1001L);
        connector.setConnectorCode("dingtalk");
        connector.setStatusCd("00A");
        when(connectorInfoService.findById(1001L)).thenReturn(connector);
        when(dwsAuthService.startDeviceAuth()).thenReturn(Map.of(
            "success", true,
            "userCode", "ABC123",
            "verificationUrl", "https://login.dingtalk.com/oauth2/device/verify.htm?user_code=ABC123"
        ));

        StartConnectorAuthorizationRequest request = new StartConnectorAuthorizationRequest();
        request.setConnectorId(1001L);
        request.setRedirectUrl("https://app.example.com/chat");

        ConnectorAuthorizationDto result = service.start(request, "1001");

        assertThat(result.getConnectorId()).isEqualTo(1001L);
        assertThat(result.getStatus()).isEqualTo("pending");
        assertThat(result.getAuthorizationUrl())
            .isEqualTo("https://login.dingtalk.com/oauth2/device/verify.htm?user_code=ABC123");
        assertThat(result.getAuthorizationId()).isNotBlank();
        verify(dwsAuthService).startDeviceAuth();
    }
}
