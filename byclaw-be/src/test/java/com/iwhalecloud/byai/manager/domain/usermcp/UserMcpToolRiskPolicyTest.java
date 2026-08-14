package com.iwhalecloud.byai.manager.domain.usermcp;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import com.iwhalecloud.byai.manager.domain.staticdata.service.SystemConfigService;

class UserMcpToolRiskPolicyTest {

    @Test
    void onlyAdministratorExactFingerprintAndToolRuleCanMarkRead() {
        SystemConfigService systemConfigService = mock(SystemConfigService.class);
        when(systemConfigService.getStringParamValueByCode("BYAI_MCP_READ_TOOL_RULES"))
            .thenReturn("fp-a:listItems");
        UserMcpToolRiskPolicy policy = new UserMcpToolRiskPolicy(systemConfigService);

        assertThat(policy.classify("fp-a", "listItems")).isEqualTo("READ");
        assertThat(policy.classify("fp-b", "listItems")).isEqualTo("UNKNOWN");
        assertThat(policy.classify("fp-a", "getItems")).isEqualTo("UNKNOWN");
    }

    @Test
    void readsTheLatestAdministratorRulesForEveryClassification() {
        SystemConfigService systemConfigService = mock(SystemConfigService.class);
        when(systemConfigService.getStringParamValueByCode("BYAI_MCP_READ_TOOL_RULES"))
            .thenReturn("fp-a:listItems", "fp-b:getItems");
        UserMcpToolRiskPolicy policy = new UserMcpToolRiskPolicy(systemConfigService);

        assertThat(policy.classify("fp-a", "listItems")).isEqualTo("READ");
        assertThat(policy.classify("fp-a", "listItems")).isEqualTo("UNKNOWN");
    }
}
