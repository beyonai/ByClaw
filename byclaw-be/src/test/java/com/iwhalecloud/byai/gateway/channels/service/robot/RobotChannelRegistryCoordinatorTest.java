package com.iwhalecloud.byai.gateway.channels.service.robot;

import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.DingtalkRobotRegistryService;
import com.iwhalecloud.byai.gateway.channels.service.feishu.FeishuRobotRegistryService;
import com.iwhalecloud.byai.gateway.channels.service.wecom.stream.WecomRobotRegistryService;
import org.junit.jupiter.api.Test;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

class RobotChannelRegistryCoordinatorTest {

    private final DingtalkRobotRegistryService dingtalkRobotRegistryService =
            mock(DingtalkRobotRegistryService.class);
    private final FeishuRobotRegistryService feishuRobotRegistryService =
            mock(FeishuRobotRegistryService.class);
    private final WecomRobotRegistryService wecomRobotRegistryService =
            mock(WecomRobotRegistryService.class);
    private final RobotChannelRegistryCoordinator coordinator = new RobotChannelRegistryCoordinator(
            dingtalkRobotRegistryService,
            feishuRobotRegistryService,
            wecomRobotRegistryService
    );

    @Test
    void registerForResource_registersWecomRobotClients() {
        coordinator.registerForResource(1001L);

        verify(wecomRobotRegistryService).registerRobotClientsForResource(1001L);
    }

    @Test
    void refreshForResource_refreshesWecomRobotClients() {
        coordinator.refreshForResource(1001L);

        verify(wecomRobotRegistryService).refreshRobotClientsForResource(1001L);
    }

    @Test
    void unregisterForResource_unregistersWecomRobotClients() {
        coordinator.unregisterForResource(1001L);

        verify(wecomRobotRegistryService).unregisterRobotClientsForResource(1001L);
    }
}
