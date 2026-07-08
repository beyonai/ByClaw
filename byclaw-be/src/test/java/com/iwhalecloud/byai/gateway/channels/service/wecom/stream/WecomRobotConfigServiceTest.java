package com.iwhalecloud.byai.gateway.channels.service.wecom.stream;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.model.WecomRobotChannelConfig;
import com.iwhalecloud.byai.manager.dto.resource.ResourceExtDigEmployeeDto;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class WecomRobotConfigServiceTest {

    @Test
    void buildRobotConfigsParsesContactCredentialsFromMachineChannel() {
        WecomRobotConfigService service = new WecomRobotConfigService(new ObjectMapper());
        ResourceExtDigEmployeeDto digitalEmployee = new ResourceExtDigEmployeeDto();
        digitalEmployee.setResourceId(1001L);
        digitalEmployee.setResourceName("WeCom Agent");
        SsResExtDigEmployee ext = new SsResExtDigEmployee();
        ext.setMachineChannel("""
                [{
                  "channel": "WeCom",
                  "botId": "bot-001",
                  "secret": "robot-secret",
                  "agentId": "1000002",
                  "corpId": "ww-corp",
                  "corpSecret": "contact-secret"
                }]
                """);
        digitalEmployee.setSsResExtDigEmployee(ext);

        List<WecomRobotChannelConfig> configs = service.buildRobotConfigs(digitalEmployee);

        assertThat(configs).hasSize(1);
        assertThat(configs.get(0).getBotId()).isEqualTo("bot-001");
        assertThat(configs.get(0).getAgentId()).isEqualTo("1000002");
        assertThat(configs.get(0).getCorpId()).isEqualTo("ww-corp");
        assertThat(configs.get(0).getCorpSecret()).isEqualTo("contact-secret");
    }
}
