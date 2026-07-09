package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream;

import com.dingtalk.open.app.api.OpenDingTalkClient;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.common.util.concurrent.MoreExecutors;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.config.DingtalkStreamProperties;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.listener.DingtalkBotListener;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.dto.resource.ResourceExtDigEmployeeDto;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import org.junit.jupiter.api.Test;

import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class DingtalkRobotRegistryServiceTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void forceRegisterRobotClientsForResource_allowsRetryAfterStartFailure() throws Exception {
        DingtalkStreamProperties properties = new DingtalkStreamProperties();
        properties.setEnabled(true);
        DingtalkBotListener botListener = mock(DingtalkBotListener.class);
        SsResExtDigEmployeeService employeeService = mock(SsResExtDigEmployeeService.class);
        DingtalkRobotConfigService configService = new DingtalkRobotConfigService(objectMapper);
        DingtalkTokenService tokenService = mock(DingtalkTokenService.class);
        ResourceExtDigEmployeeDto digitalEmployee = buildDigitalEmployee();
        when(employeeService.findExtDigEmployeeById(1001L)).thenReturn(digitalEmployee);

        AtomicInteger startAttempts = new AtomicInteger();
        DingtalkRobotRegistryService service = new DingtalkRobotRegistryService(
                properties,
                botListener,
                employeeService,
                configService,
                tokenService,
                robotConfig -> new OpenDingTalkClient() {
                    @Override
                    public void start() throws Exception {
                        if (startAttempts.incrementAndGet() == 1) {
                            throw new IllegalStateException("stream start failed");
                        }
                    }

                    @Override
                    public void stop() {
                    }
                },
                MoreExecutors.newDirectExecutorService()
        );

        service.forceRegisterRobotClientsForResource(1001L);
        service.forceRegisterRobotClientsForResource(1001L);

        assertThat(startAttempts.get()).isEqualTo(2);
    }

    private ResourceExtDigEmployeeDto buildDigitalEmployee() {
        ResourceExtDigEmployeeDto digitalEmployee = new ResourceExtDigEmployeeDto();
        digitalEmployee.setResourceId(1001L);
        digitalEmployee.setResourceName("DingTalk Agent");

        SsResExtDigEmployee ext = new SsResExtDigEmployee();
        ext.setMachineChannel("""
                [{
                  "channel": "DingTalk",
                  "robotCode": "robot-001",
                  "clientId": "client-001",
                  "clientSecret": "secret-001",
                  "appId": "app-001",
                  "AICardId": "card-001.schema"
                }]
                """);
        digitalEmployee.setSsResExtDigEmployee(ext);
        return digitalEmployee;
    }
}
