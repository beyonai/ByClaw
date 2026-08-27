package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.model.DingtalkRobotChannelConfig;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.model.RobotConfigParseResult;
import com.iwhalecloud.byai.manager.dto.resource.ResourceExtDigEmployeeDto;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class DingtalkRobotConfigServiceTest {

    private final DingtalkRobotConfigService service = new DingtalkRobotConfigService(new ObjectMapper());

    @Test
    void parseResultDistinguishesNoDingtalkNodeFromMalformedJson() {
        RobotConfigParseResult noDingtalk = service.parseRobotConfigsResult(employee(1L,
                "[{\"channel\":\"Feishu\"}]"));
        RobotConfigParseResult malformed = service.parseRobotConfigsResult(employee(2L, "[{"));

        assertThat(noDingtalk.hasDingtalkNode()).isFalse();
        assertThat(noDingtalk.errors()).isEmpty();
        assertThat(noDingtalk.configs()).isEmpty();
        assertThat(malformed.errors()).extracting(RobotConfigParseResult.ParseError::code)
                .containsExactly("INVALID_JSON");
    }

    @Test
    void strictValidationRejectsMissingCredentialsAndLegacyBuilderStaysLenient() {
        ResourceExtDigEmployeeDto employee = employee(3L, """
                [{"channel":"DingTalk","robotCode":"robot-1","clientId":"client-1"}]
                """);

        assertThat(service.buildRobotConfigs(employee)).isEmpty();
        assertThatThrownBy(() -> service.validateAndBuildRobotConfigs(employee))
                .isInstanceOf(DingtalkRobotConfigValidationException.class)
                .hasMessageContaining("MISSING_CREDENTIALS");
    }

    @Test
    void strictValidationRejectsDuplicateRobotCodeWithinOneResource() {
        ResourceExtDigEmployeeDto employee = employee(4L, """
                [
                  {"channel":"DingTalk","robotCode":"robot-1","clientId":"client-1","clientSecret":"secret-1"},
                  {"channel":"DingTalk","robotCode":"robot-1","clientId":"client-2","clientSecret":"secret-2"}
                ]
                """);

        assertThatThrownBy(() -> service.validateAndBuildRobotConfigs(employee))
                .isInstanceOf(DingtalkRobotConfigValidationException.class)
                .hasMessageContaining("DUPLICATE_ROBOT_CODE");
    }

    @Test
    void publishedSnapshotDefensivelyCopiesInputsAndReads() {
        DingtalkRobotChannelConfig config = service.validateAndBuildRobotConfigs(employee(5L, validConfig())).get(0);
        service.replaceRobotConfigsForResource(5L, List.of(config));

        config.setResourceName("mutated input");
        DingtalkRobotChannelConfig firstRead = service.getRobotConfig("robot-1");
        firstRead.setResourceName("mutated read");

        assertThat(service.getRobotConfig("robot-1").getResourceName()).isEqualTo("Agent 5");
    }

    @Test
    void credentialVersionUsesUnambiguousStableEncoding() {
        DingtalkRobotChannelConfig left = config("ab", "c");
        DingtalkRobotChannelConfig right = config("a", "bc");

        assertThat(service.credentialVersion(left)).isNotEqualTo(service.credentialVersion(right));
        assertThat(service.credentialVersion(left)).isEqualTo(service.credentialVersion(config("ab", "c")));
    }

    @Test
    void desiredFingerprintChangesWhenBehaviorMetadataChanges() {
        DingtalkRobotChannelConfig original = service.validateAndBuildRobotConfigs(employee(6L, validConfig())).get(0);
        DingtalkRobotChannelConfig changed = service.validateAndBuildRobotConfigs(employee(6L, validConfig())).get(0);
        changed.setCardTemplateId("other-card");

        assertThat(service.desiredConfigFingerprint(original))
                .isNotEqualTo(service.desiredConfigFingerprint(changed));
    }

    @Test
    void strictValidationRejectsRobotCodeOwnedByAnotherResource() {
        DingtalkRobotChannelConfig owned = service.validateAndBuildRobotConfigs(employee(7L, validConfig())).get(0);
        service.replaceRobotConfigsForResource(7L, List.of(owned));

        assertThatThrownBy(() -> service.validateAndBuildRobotConfigs(employee(8L, validConfig())))
                .isInstanceOf(DingtalkRobotConfigValidationException.class)
                .hasMessageContaining("ROBOT_CODE_OWNED_BY_ANOTHER_RESOURCE");
        assertThat(service.getRobotConfig("robot-1").getResourceId()).isEqualTo(7L);
    }

    private ResourceExtDigEmployeeDto employee(Long resourceId, String machineChannel) {
        ResourceExtDigEmployeeDto employee = new ResourceExtDigEmployeeDto();
        employee.setResourceId(resourceId);
        employee.setResourceName("Agent " + resourceId);
        SsResExtDigEmployee ext = new SsResExtDigEmployee();
        ext.setMachineChannel(machineChannel);
        employee.setSsResExtDigEmployee(ext);
        return employee;
    }

    private String validConfig() {
        return """
                [{
                  "channel":"DingTalk",
                  "robotCode":"robot-1",
                  "clientId":"client-1",
                  "clientSecret":"secret-1",
                  "appId":"app-1",
                  "AICardId":"card-1"
                }]
                """;
    }

    private DingtalkRobotChannelConfig config(String clientId, String clientSecret) {
        DingtalkRobotChannelConfig config = new DingtalkRobotChannelConfig();
        config.setRobotCode("robot-1");
        config.setClientId(clientId);
        config.setClientSecret(clientSecret);
        return config;
    }
}
