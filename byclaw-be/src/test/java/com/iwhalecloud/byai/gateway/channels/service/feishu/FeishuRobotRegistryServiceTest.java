package com.iwhalecloud.byai.gateway.channels.service.feishu;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.channels.service.feishu.config.FeishuStreamProperties;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import org.junit.jupiter.api.Test;

class FeishuRobotRegistryServiceTest {

    @Test
    void registerAndRefresh_skipResourceLookupWhenStreamDisabled() {
        FeishuStreamProperties properties = new FeishuStreamProperties();
        properties.setEnabled(false);
        SsResExtDigEmployeeService employeeService = mock(SsResExtDigEmployeeService.class);
        FeishuRobotRegistryService registryService = new FeishuRobotRegistryService(
                properties,
                employeeService,
                new FeishuRobotConfigService(new ObjectMapper()),
                mock(FeishuTokenService.class)
        );

        registryService.registerRobotClientsForResource(1001L);
        registryService.refreshRobotClientsForResource(1001L);

        verify(employeeService, never()).findExtDigEmployeeById(1001L);
    }
}
