package com.iwhalecloud.byai.manager.domain.usermcp;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URI;

import org.junit.jupiter.api.Test;
import com.iwhalecloud.byai.manager.domain.staticdata.service.SystemConfigService;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class McpEndpointPolicyTest {

    @Test
    void canonicalizesValidatedHttpsEndpoint() {
        McpEndpointPolicy policy = new McpEndpointPolicy("mcp.example.com");

        URI endpoint = policy.validate("https://mcp.example.com/", "/api/../mcp");

        assertThat(endpoint.toString()).isEqualTo("https://mcp.example.com/mcp");
    }

    @Test
    void rejectsHttpCustomPortsCrossOriginAndProtocolRelativeEndpoints() {
        McpEndpointPolicy policy = new McpEndpointPolicy("mcp.example.com");

        assertThatThrownBy(() -> policy.validate("http://mcp.example.com", "/mcp"))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> policy.validate("https://mcp.example.com:8443", "/mcp"))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> policy.validate("https://mcp.example.com", "https://evil.example/mcp"))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> policy.validate("https://mcp.example.com", "//evil.example/mcp"))
            .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void productionPolicyAcceptsExactAllowlistedDomainAndTrustedInternalHosts() {
        SystemConfigService systemConfigService = mock(SystemConfigService.class);
        when(systemConfigService.getStringParamValueByCode("BYAI_MCP_ALLOWED_ADDRESSES"))
            .thenReturn("mcp.deepwiki.com,127.0.0.1,localhost,10.10.2.15");
        McpEndpointPolicy policy = new McpEndpointPolicy(systemConfigService);

        assertThat(policy.validate("https://mcp.deepwiki.com", "/mcp")).isNotNull();
        assertThat(policy.validate("https://127.0.0.1", "/mcp")).isNotNull();
        assertThat(policy.validate("https://localhost", "/mcp")).isNotNull();
        assertThat(policy.validate("https://10.10.2.15", "/mcp")).isNotNull();
    }

    @Test
    void productionPolicyRejectsUnlistedSubdomainAndWildcardEntry() {
        SystemConfigService systemConfigService = mock(SystemConfigService.class);
        when(systemConfigService.getStringParamValueByCode("BYAI_MCP_ALLOWED_ADDRESSES"))
            .thenReturn("mcp.deepwiki.com,*.example.com");
        McpEndpointPolicy policy = new McpEndpointPolicy(systemConfigService);

        assertThatThrownBy(() -> policy.validate("https://api.mcp.deepwiki.com", "/mcp"))
            .hasMessageContaining("not approved");
        assertThatThrownBy(() -> policy.validate("https://api.example.com", "/mcp"))
            .hasMessageContaining("not approved");
    }

    @Test
    void productionPolicyReadsTheLatestAdministratorAllowlist() {
        SystemConfigService systemConfigService = mock(SystemConfigService.class);
        when(systemConfigService.getStringParamValueByCode("BYAI_MCP_ALLOWED_ADDRESSES"))
            .thenReturn("8.8.8.8", "1.1.1.1", "1.1.1.1");
        McpEndpointPolicy policy = new McpEndpointPolicy(systemConfigService);

        assertThat(policy.validate("https://8.8.8.8", "/mcp")).isNotNull();
        assertThatThrownBy(() -> policy.validate("https://8.8.8.8", "/mcp"))
            .hasMessageContaining("not approved");
        assertThat(policy.validate("https://1.1.1.1", "/mcp")).isNotNull();
    }
}
