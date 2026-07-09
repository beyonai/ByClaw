package com.iwhalecloud.byai.gateway.channels.service.feishu;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.iwhalecloud.byai.gateway.channels.service.feishu.config.FeishuStreamProperties;
import org.junit.jupiter.api.Test;

class FeishuRobotLifecycleTest {

    @Test
    void init_skipsRobotConfigInitializationWhenStreamDisabled() {
        FeishuStreamProperties properties = new FeishuStreamProperties();
        properties.setEnabled(false);
        FeishuRobotRegistryService registryService = mock(FeishuRobotRegistryService.class);

        FeishuRobotLifecycle lifecycle = new FeishuRobotLifecycle(properties, registryService);

        lifecycle.init();

        verify(registryService, never()).initializeRobotConfigs();
    }
}
