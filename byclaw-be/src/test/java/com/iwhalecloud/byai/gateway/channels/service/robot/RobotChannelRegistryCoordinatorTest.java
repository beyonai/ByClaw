package com.iwhalecloud.byai.gateway.channels.service.robot;

import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.DingtalkRobotConfigValidationException;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.DingtalkRobotRegistryService;
import com.iwhalecloud.byai.gateway.channels.service.feishu.FeishuRobotRegistryService;
import com.iwhalecloud.byai.gateway.channels.service.wecom.stream.lifecycle.WecomRobotRegistryService;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

class RobotChannelRegistryCoordinatorTest {

    private final DingtalkRobotRegistryService dingtalk = mock(DingtalkRobotRegistryService.class);
    private final FeishuRobotRegistryService feishu = mock(FeishuRobotRegistryService.class);
    private final WecomRobotRegistryService wecom = mock(WecomRobotRegistryService.class);
    private final RobotChannelRegistryCoordinator coordinator =
            new RobotChannelRegistryCoordinator(dingtalk, feishu, wecom);

    @Test
    void validationFailurePropagatesInsteadOfBeingLoggedAndIgnored() {
        doThrow(new DingtalkRobotConfigValidationException("duplicate robotCode"))
                .when(dingtalk).registerRobotClientsForResource(1001L);

        assertThatThrownBy(() -> coordinator.registerForResource(1001L))
                .isInstanceOf(DingtalkRobotConfigValidationException.class)
                .hasMessageContaining("duplicate robotCode");
        verifyNoInteractions(feishu, wecom);
    }

    @Test
    void ordinaryRuntimeFailureRemainsIsolatedFromOtherChannels() {
        doThrow(new IllegalStateException("runtime unavailable"))
                .when(dingtalk).registerRobotClientsForResource(1001L);

        coordinator.registerForResource(1001L);

        verify(feishu).registerRobotClientsForResource(1001L);
        verify(wecom).registerRobotClientsForResource(1001L);
    }
}
